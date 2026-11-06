-- Run only after all migrations on a disposable local Supabase/PostgreSQL DB.
-- The transaction is rolled back; this test covers RPC grants, workspace
-- isolation, owner permissions, email verification, and invitation acceptance.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      '61111111-1111-4111-8111-111111111101',
      '61111111-1111-4111-8111-111111111102',
      '61111111-1111-4111-8111-111111111103'
    )
  ) THEN
    RAISE EXCEPTION 'Onboarding test UUID collision; reset the disposable database';
  END IF;
  IF has_function_privilege('anon', 'public.create_workspace_for_current_user(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.create_workspace_for_current_user(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Workspace creation RPC must be authenticated-only';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('61111111-1111-4111-8111-111111111101', 'authenticated', 'authenticated', 'owner@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('61111111-1111-4111-8111-111111111102', 'authenticated', 'authenticated', 'invitee@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('61111111-1111-4111-8111-111111111103', 'authenticated', 'authenticated', 'unverified@example.invalid', '', NULL, '{}', '{}', now(), now());

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_main_workspace UUID := public.main_workspace_id();
  v_workspace_id UUID;
  v_repeat_workspace_id UUID;
  v_invitation_id UUID;
  v_accepted_workspace_id UUID;
  v_count BIGINT;
  v_rejected BOOLEAN;
  v_permission TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '61111111-1111-4111-8111-111111111101', TRUE);

  v_workspace_id := public.create_workspace_for_current_user('Independent buyer workspace');
  v_repeat_workspace_id := public.create_workspace_for_current_user('Ignored retry name');
  IF v_workspace_id IS DISTINCT FROM v_repeat_workspace_id THEN
    RAISE EXCEPTION 'Repeated workspace creation returned a duplicate workspace';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = v_workspace_id
      AND w.created_by_user_id = auth.uid()
      AND w.name = 'Independent buyer workspace'
      AND w.slug <> 'main'
  ) THEN
    RAISE EXCEPTION 'New workspace owner/name/slug was not persisted correctly';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = v_workspace_id AND m.user_id = auth.uid()
      AND m.role = 'admin' AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Workspace creator must be an active workspace Admin';
  END IF;

  FOREACH v_permission IN ARRAY ARRAY[
    'workspace.read', 'members.read', 'members.invite',
    'members.manage_roles', 'members.assign_admin',
    'products.read', 'products.manage', 'products.cost.read',
    'offers.read', 'offers.manage', 'leads.read', 'leads.create',
    'leads.update', 'leads.assign', 'leads.assign_team', 'leads.assign_offer',
    'teams.read', 'teams.manage', 'orders.read', 'orders.manage',
    'landing_pages.read', 'landing_pages.manage', 'shipping.manage', 'audit.read'
  ] LOOP
    IF NOT public.has_workspace_permission(v_workspace_id, v_permission, NULL, NULL, NULL) THEN
      RAISE EXCEPTION 'Workspace creator is missing required workspace permission %', v_permission;
    END IF;
  END LOOP;
  IF public.has_workspace_permission(v_workspace_id, 'permissions.manage', NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Workspace creator must not receive permission override management';
  END IF;
  IF public.has_workspace_permission(v_main_workspace, 'workspace.read', NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Independent workspace creator received access to main';
  END IF;
  SELECT count(*) INTO v_count FROM public.workspaces;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Workspace RLS exposed % workspaces instead of the creator workspace', v_count;
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspaces (name, slug) VALUES ('Browser insert', 'browser-insert');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Authenticated client can directly insert a workspace';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
    VALUES (v_workspace_id, '61111111-1111-4111-8111-111111111102', 'admin');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Authenticated client can bypass the invitation RPC to add a member';
  END IF;

  v_invitation_id := public.create_workspace_invitation(
    v_workspace_id, 'invitee@example.invalid', 'viewer', repeat('b', 64)
  );
  IF v_invitation_id IS NULL THEN
    RAISE EXCEPTION 'Workspace owner could not create an invitation';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '61111111-1111-4111-8111-111111111103', TRUE);
  v_rejected := FALSE;
  BEGIN
    PERFORM public.accept_workspace_invitation(repeat('b', 64));
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Invitation was accepted by an account with a different email';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.create_workspace_for_current_user('Unverified account');
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Unverified account created a workspace';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', '61111111-1111-4111-8111-111111111102', TRUE);
  v_accepted_workspace_id := public.accept_workspace_invitation(repeat('b', 64));
  IF v_accepted_workspace_id IS DISTINCT FROM v_workspace_id THEN
    RAISE EXCEPTION 'Invitation acceptance added the user to the wrong workspace';
  END IF;
  IF public.has_workspace_permission(v_main_workspace, 'workspace.read', NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Invited user received access to main';
  END IF;
  SELECT count(*) INTO v_count FROM public.workspaces;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Invited user can see % workspaces instead of only the invited workspace', v_count;
  END IF;

END;
$$;

ROLLBACK;
