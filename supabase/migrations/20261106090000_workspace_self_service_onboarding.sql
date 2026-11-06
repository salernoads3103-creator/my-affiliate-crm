-- Allow a verified account to bootstrap one isolated workspace without an
-- invitation or manual owner SQL. The creator receives workspace-scoped
-- grants; this never adds them to system_admins.

ALTER TABLE public.workspaces
  ADD COLUMN created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX workspaces_created_by_user_uidx
  ON public.workspaces(created_by_user_id)
  WHERE created_by_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.create_workspace_for_current_user(p_name TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email_confirmed_at TIMESTAMPTZ;
  v_workspace_id UUID;
  v_membership_id UUID;
  v_name TEXT := btrim(p_name);
  v_slug TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF v_name IS NULL OR char_length(v_name) < 2 OR char_length(v_name) > 100
     OR v_name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Workspace name must be between 2 and 100 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT u.email_confirmed_at
  INTO v_email_confirmed_at
  FROM auth.users u
  WHERE u.id = v_user_id;
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirm your email before creating a workspace'
      USING ERRCODE = '42501';
  END IF;

  -- Serialize first-workspace creation per account. The unique index below is
  -- the final guard against duplicate workspaces from concurrent requests.
  PERFORM pg_advisory_xact_lock(hashtextextended('workspace-create:' || v_user_id::TEXT, 0));

  SELECT w.id, m.id INTO v_workspace_id, v_membership_id
  FROM public.workspaces w
  LEFT JOIN public.workspace_memberships m
    ON m.workspace_id = w.id AND m.user_id = v_user_id AND m.status = 'active'
  WHERE w.created_by_user_id = v_user_id;
  IF v_workspace_id IS NOT NULL THEN
    IF v_membership_id IS NULL THEN
      RAISE EXCEPTION 'Workspace access is unavailable' USING ERRCODE = '42501';
    END IF;
    RETURN v_workspace_id;
  END IF;

  v_workspace_id := gen_random_uuid();
  v_slug := 'workspace-' || replace(v_workspace_id::TEXT, '-', '');

  INSERT INTO public.workspaces (id, name, slug, created_by_user_id)
  VALUES (v_workspace_id, v_name, v_slug, v_user_id);

  INSERT INTO public.workspace_memberships (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, v_user_id, 'admin', 'active')
  RETURNING id INTO v_membership_id;

  -- The first admin owns this workspace and needs the current CRM modules.
  -- Custom permission overrides remain reserved for a later explicit design;
  -- no global Super Admin or workspace-level bypass is created here.
  INSERT INTO public.workspace_member_permissions (
    membership_id, workspace_id, permission_key, allowed, scope_type, scope_id,
    delegable, authority, granted_by
  )
  SELECT v_membership_id, v_workspace_id, pc.permission_key, TRUE,
         'workspace', NULL, FALSE, 'admin', v_user_id
  FROM public.workspace_permission_catalog pc
  WHERE pc.permission_key <> 'permissions.manage'
  ON CONFLICT DO NOTHING;

  RETURN v_workspace_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace_for_current_user(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_for_current_user(TEXT)
  TO authenticated;
