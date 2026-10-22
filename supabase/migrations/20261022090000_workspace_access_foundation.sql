-- Multi-user workspace and access-control foundation.
-- This migration preserves existing auth users and leads. It creates one main
-- workspace and moves existing leads into it without creating memberships.
-- No Super Admin is created by this migration.

-- Abort before changing data if the existing leads table has policies beyond
-- the legacy policy this migration is designed to replace. PostgreSQL combines
-- permissive policies with OR, so silently keeping an unknown policy could
-- widen access after the new workspace policies are installed.
DO $$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'leads'
  LOOP
    IF v_policy.policyname <> 'Users manage own leads' THEN
      RAISE EXCEPTION
        'Unexpected existing RLS policy on public.leads: %. Review it before applying this migration.',
        v_policy.policyname;
    END IF;
  END LOOP;
END;
$$;

CREATE TYPE public.workspace_member_role AS ENUM ('admin', 'operator', 'viewer');
CREATE TYPE public.workspace_scope_type AS ENUM ('workspace', 'team', 'operator', 'offer');
CREATE TYPE public.workspace_permission_authority AS ENUM ('super_admin', 'admin');

CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.workspaces (name, slug)
VALUES ('Main workspace', 'main')
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE public.system_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  role TEXT NOT NULL DEFAULT 'super_admin' CHECK (role = 'super_admin'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.workspace_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  role public.workspace_member_role NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id),
  UNIQUE (id, workspace_id)
);

CREATE TABLE public.workspace_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name),
  UNIQUE (workspace_id, id)
);

CREATE TABLE public.workspace_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name),
  UNIQUE (workspace_id, id)
);

CREATE TABLE public.workspace_permission_catalog (
  permission_key TEXT PRIMARY KEY,
  description TEXT NOT NULL
);

INSERT INTO public.workspace_permission_catalog (permission_key, description) VALUES
  ('workspace.read', 'View workspace details'),
  ('members.read', 'View workspace members and invitations'),
  ('members.invite', 'Invite users to the workspace'),
  ('members.manage_roles', 'Change roles of workspace members'),
  ('members.assign_admin', 'Assign the Admin workspace role'),
  ('permissions.read', 'View individual permission grants'),
  ('permissions.manage', 'Manage overrides for rights explicitly delegated to this Admin'),
  ('leads.read', 'View leads in the granted data scope'),
  ('leads.create', 'Create leads in the granted data scope'),
  ('leads.update', 'Update leads in the granted data scope'),
  ('leads.delete', 'Delete leads in the granted data scope'),
  ('leads.assign', 'Assign leads to another operator'),
  ('leads.assign_team', 'Assign leads to a team'),
  ('leads.assign_offer', 'Assign leads to an offer'),
  ('teams.read', 'View teams in the granted data scope'),
  ('teams.manage', 'Create and update workspace teams'),
  ('offers.read', 'View offers in the granted data scope'),
  ('offers.manage', 'Create and update workspace offers'),
  ('audit.read', 'View workspace access audit events')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE public.workspace_role_permissions (
  role public.workspace_member_role NOT NULL,
  permission_key TEXT NOT NULL REFERENCES public.workspace_permission_catalog(permission_key),
  scope_type public.workspace_scope_type NOT NULL,
  PRIMARY KEY (role, permission_key)
);

-- Admin receives only low-risk read access by default. Elevated actions are
-- granted individually by a Super Admin. Operators and Viewers start scoped
-- to leads assigned to their own user id.
INSERT INTO public.workspace_role_permissions (role, permission_key, scope_type) VALUES
  ('admin', 'workspace.read', 'workspace'),
  ('admin', 'members.read', 'workspace'),
  ('operator', 'workspace.read', 'workspace'),
  ('operator', 'leads.read', 'operator'),
  ('operator', 'leads.create', 'operator'),
  ('operator', 'leads.update', 'operator'),
  ('viewer', 'workspace.read', 'workspace'),
  ('viewer', 'leads.read', 'operator');

CREATE TABLE public.workspace_member_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL,
  workspace_id UUID NOT NULL,
  permission_key TEXT NOT NULL REFERENCES public.workspace_permission_catalog(permission_key),
  allowed BOOLEAN NOT NULL,
  scope_type public.workspace_scope_type NOT NULL,
  scope_id UUID,
  delegable BOOLEAN NOT NULL DEFAULT FALSE,
  authority public.workspace_permission_authority NOT NULL,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (membership_id, workspace_id)
    REFERENCES public.workspace_memberships(id, workspace_id) ON DELETE CASCADE,
  CHECK (
    (scope_type = 'workspace' AND scope_id IS NULL)
    OR (scope_type <> 'workspace' AND scope_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX workspace_member_permissions_scope_uidx
  ON public.workspace_member_permissions (
    membership_id,
    permission_key,
    scope_type,
    COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::UUID)
  );

CREATE TABLE public.workspace_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  email TEXT NOT NULL,
  role public.workspace_member_role NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX workspace_invitations_pending_email_uidx
  ON public.workspace_invitations (workspace_id, lower(email))
  WHERE status = 'pending';

CREATE TABLE public.workspace_access_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX workspace_memberships_user_idx ON public.workspace_memberships(user_id, workspace_id);
CREATE INDEX workspace_member_permissions_lookup_idx
  ON public.workspace_member_permissions(membership_id, permission_key, allowed);
CREATE INDEX workspace_audit_workspace_created_idx
  ON public.workspace_access_audit(workspace_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.main_workspace_id()
RETURNS UUID
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM public.workspaces WHERE slug = 'main' LIMIT 1;
$$;

ALTER TABLE public.leads
  ADD COLUMN workspace_id UUID,
  ADD COLUMN team_id UUID,
  ADD COLUMN operator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN offer_id UUID;

-- The legacy updated_at trigger would otherwise rewrite every lead timestamp
-- during this one-time backfill. Preserve all pre-existing lead fields exactly.
ALTER TABLE public.leads DISABLE TRIGGER update_leads_updated_at;
UPDATE public.leads
SET workspace_id = public.main_workspace_id(),
    operator_id = user_id
WHERE workspace_id IS NULL OR operator_id IS NULL;
ALTER TABLE public.leads ENABLE TRIGGER update_leads_updated_at;

ALTER TABLE public.leads
  ALTER COLUMN workspace_id SET DEFAULT public.main_workspace_id(),
  ALTER COLUMN workspace_id SET NOT NULL,
  ALTER COLUMN operator_id SET DEFAULT auth.uid(),
  ADD CONSTRAINT leads_workspace_id_fkey
    FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  ADD CONSTRAINT leads_workspace_team_fkey
    FOREIGN KEY (workspace_id, team_id) REFERENCES public.workspace_teams(workspace_id, id),
  ADD CONSTRAINT leads_workspace_offer_fkey
    FOREIGN KEY (workspace_id, offer_id) REFERENCES public.workspace_offers(workspace_id, id);

CREATE INDEX leads_workspace_created_idx ON public.leads(workspace_id, created_at DESC);
CREATE INDEX leads_workspace_team_idx ON public.leads(workspace_id, team_id);
CREATE INDEX leads_workspace_operator_idx ON public.leads(workspace_id, operator_id);
CREATE INDEX leads_workspace_offer_idx ON public.leads(workspace_id, offer_id);

CREATE OR REPLACE FUNCTION public.is_super_admin(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.system_admins sa WHERE sa.user_id = p_user_id);
$$;

-- Manual owner-only bootstrap and recovery operations. Neither function is
-- executable by PUBLIC, anon, or authenticated, and neither is exposed through
-- a public API. A transaction-scoped advisory lock serializes bootstrap runs.
CREATE SCHEMA IF NOT EXISTS lumen_private;
REVOKE ALL ON SCHEMA lumen_private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION lumen_private.bootstrap_first_super_admin(
  p_user_id UUID,
  p_expected_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actual_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_workspace_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(20261022, 90000);

  IF p_user_id IS NULL OR NULLIF(btrim(p_expected_email), '') IS NULL THEN
    RAISE EXCEPTION 'A verified account UUID and email are required' USING ERRCODE = '22023';
  END IF;

  SELECT lower(u.email), u.email_confirmed_at
  INTO v_actual_email, v_email_confirmed_at
  FROM auth.users u
  WHERE u.id = p_user_id;

  IF v_actual_email IS NULL OR v_actual_email <> lower(btrim(p_expected_email)) THEN
    RAISE EXCEPTION 'UUID/email verification failed; no role was assigned' USING ERRCODE = '22023';
  END IF;
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirm this account email before assigning Super Admin' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.system_admins) THEN
    RAISE EXCEPTION 'A Super Admin is already configured; bootstrap is first-run only' USING ERRCODE = '23505';
  END IF;

  SELECT w.id INTO v_workspace_id
  FROM public.workspaces w
  WHERE w.slug = 'main';
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Main workspace is missing; apply the workspace migration first' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.system_admins (user_id, role)
  VALUES (p_user_id, 'super_admin');

  INSERT INTO public.workspace_memberships (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, p_user_id, 'admin', 'active')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = 'admin', status = 'active', updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION lumen_private.restore_super_admin_access(
  p_user_id UUID,
  p_expected_email TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_actual_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_workspace_id UUID;
BEGIN
  PERFORM pg_advisory_xact_lock(20261022, 90000);

  IF p_user_id IS NULL OR NULLIF(btrim(p_expected_email), '') IS NULL THEN
    RAISE EXCEPTION 'A verified account UUID and email are required' USING ERRCODE = '22023';
  END IF;

  SELECT lower(u.email), u.email_confirmed_at
  INTO v_actual_email, v_email_confirmed_at
  FROM auth.users u
  WHERE u.id = p_user_id;
  IF v_actual_email IS NULL OR v_actual_email <> lower(btrim(p_expected_email)) THEN
    RAISE EXCEPTION 'UUID/email verification failed; no role was assigned' USING ERRCODE = '22023';
  END IF;
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirm this account email before restoring access' USING ERRCODE = '22023';
  END IF;

  SELECT w.id INTO v_workspace_id
  FROM public.workspaces w
  WHERE w.slug = 'main';
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Main workspace is missing; apply the workspace migration first' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.system_admins (user_id, role)
  VALUES (p_user_id, 'super_admin')
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.workspace_memberships (workspace_id, user_id, role, status)
  VALUES (v_workspace_id, p_user_id, 'admin', 'active')
  ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = 'admin', status = 'active', updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION lumen_private.bootstrap_first_super_admin(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lumen_private.restore_super_admin_access(UUID, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.permission_scope_matches(
  p_scope_type public.workspace_scope_type,
  p_scope_id UUID,
  p_workspace_id UUID,
  p_team_id UUID,
  p_operator_id UUID,
  p_offer_id UUID,
  p_actor_id UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_scope_type
    WHEN 'workspace' THEN p_scope_id IS NULL
    WHEN 'team' THEN p_scope_id = p_team_id
    WHEN 'operator' THEN p_operator_id IS NOT NULL
      AND (p_scope_id = p_operator_id OR (p_scope_id IS NULL AND p_operator_id = p_actor_id))
    WHEN 'offer' THEN p_scope_id = p_offer_id
    ELSE FALSE
  END;
$$;

CREATE OR REPLACE FUNCTION public.has_workspace_permission(
  p_workspace_id UUID,
  p_permission_key TEXT,
  p_team_id UUID,
  p_operator_id UUID,
  p_offer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_membership_id UUID;
  v_role public.workspace_member_role;
BEGIN
  IF v_actor_id IS NULL OR p_workspace_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p_workspace_id) THEN
    RETURN FALSE;
  END IF;

  IF public.is_super_admin(v_actor_id) THEN
    RETURN TRUE;
  END IF;

  SELECT m.id, m.role INTO v_membership_id, v_role
  FROM public.workspace_memberships m
  WHERE m.workspace_id = p_workspace_id
    AND m.user_id = v_actor_id
    AND m.status = 'active';

  IF v_membership_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- A Super Admin's explicit deny is an absolute veto, even when an Admin
  -- later adds a narrower allow or a role default would otherwise grant access.
  IF EXISTS (
    SELECT 1
    FROM public.workspace_member_permissions mp
    WHERE mp.membership_id = v_membership_id
      AND mp.permission_key = p_permission_key
      AND mp.allowed = FALSE
      AND mp.authority = 'super_admin'
      AND public.permission_scope_matches(
        mp.scope_type, mp.scope_id, p_workspace_id, p_team_id,
        p_operator_id, p_offer_id, v_actor_id
      )
  ) THEN
    RETURN FALSE;
  END IF;

  -- Explicit Super Admin grants take precedence over Admin-level restrictions.
  IF EXISTS (
    SELECT 1
    FROM public.workspace_member_permissions mp
    WHERE mp.membership_id = v_membership_id
      AND mp.permission_key = p_permission_key
      AND mp.allowed = TRUE
      AND mp.authority = 'super_admin'
      AND public.permission_scope_matches(
        mp.scope_type, mp.scope_id, p_workspace_id, p_team_id,
        p_operator_id, p_offer_id, v_actor_id
      )
  ) THEN
    RETURN TRUE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_member_permissions mp
    WHERE mp.membership_id = v_membership_id
      AND mp.permission_key = p_permission_key
      AND mp.allowed = FALSE
      AND mp.authority = 'admin'
      AND public.permission_scope_matches(
        mp.scope_type, mp.scope_id, p_workspace_id, p_team_id,
        p_operator_id, p_offer_id, v_actor_id
      )
  ) THEN
    RETURN FALSE;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_role_permissions rp
    WHERE rp.role = v_role
      AND rp.permission_key = p_permission_key
      AND public.permission_scope_matches(
        rp.scope_type, NULL, p_workspace_id, p_team_id,
        p_operator_id, p_offer_id, v_actor_id
      )
  ) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.workspace_member_permissions mp
    WHERE mp.membership_id = v_membership_id
      AND mp.permission_key = p_permission_key
      AND mp.allowed = TRUE
      AND mp.authority = 'admin'
      AND public.permission_scope_matches(
        mp.scope_type, mp.scope_id, p_workspace_id, p_team_id,
        p_operator_id, p_offer_id, v_actor_id
      )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_workspace_access_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace_id UUID;
  v_subject_user_id UUID;
  v_action TEXT;
  v_details JSONB := '{}'::JSONB;
BEGIN
  IF TG_TABLE_NAME = 'workspace_memberships' THEN
    v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
    v_subject_user_id := COALESCE(NEW.user_id, OLD.user_id);
    v_action := CASE TG_OP
      WHEN 'INSERT' THEN 'member.added'
      WHEN 'DELETE' THEN 'member.removed'
      ELSE 'member.updated'
    END;
    v_details := jsonb_build_object(
      'old_role', CASE WHEN TG_OP <> 'INSERT' THEN OLD.role::TEXT END,
      'new_role', CASE WHEN TG_OP <> 'DELETE' THEN NEW.role::TEXT END,
      'old_status', CASE WHEN TG_OP <> 'INSERT' THEN OLD.status END,
      'new_status', CASE WHEN TG_OP <> 'DELETE' THEN NEW.status END
    );
  ELSIF TG_TABLE_NAME = 'workspace_member_permissions' THEN
    v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
    SELECT user_id INTO v_subject_user_id
    FROM public.workspace_memberships
    WHERE id = COALESCE(NEW.membership_id, OLD.membership_id);
    v_action := CASE TG_OP
      WHEN 'INSERT' THEN 'permission.granted'
      WHEN 'DELETE' THEN 'permission.revoked'
      ELSE 'permission.changed'
    END;
    v_details := jsonb_build_object(
      'permission', COALESCE(NEW.permission_key, OLD.permission_key),
      'old', CASE WHEN TG_OP <> 'INSERT' THEN jsonb_build_object(
        'allowed', OLD.allowed,
        'delegable', OLD.delegable,
        'scope_type', OLD.scope_type::TEXT,
        'scope_id', OLD.scope_id,
        'granted_by', OLD.granted_by,
        'authority', OLD.authority::TEXT
      ) ELSE NULL END,
      'new', CASE WHEN TG_OP <> 'DELETE' THEN jsonb_build_object(
        'allowed', NEW.allowed,
        'delegable', NEW.delegable,
        'scope_type', NEW.scope_type::TEXT,
        'scope_id', NEW.scope_id,
        'granted_by', NEW.granted_by,
        'authority', NEW.authority::TEXT
      ) ELSE NULL END,
      'actor_id', auth.uid(),
      'actor_db_role', session_user
    );
  ELSIF TG_TABLE_NAME = 'workspace_invitations' THEN
    v_workspace_id := COALESCE(NEW.workspace_id, OLD.workspace_id);
    v_subject_user_id := COALESCE(NEW.accepted_by, OLD.accepted_by);
    v_action := CASE
      WHEN TG_OP = 'INSERT' THEN 'invitation.created'
      WHEN TG_OP = 'DELETE' THEN 'invitation.deleted'
      WHEN OLD.status = 'pending' AND NEW.status = 'accepted' THEN 'invitation.accepted'
      ELSE 'invitation.updated'
    END;
    v_details := jsonb_build_object(
      'email', COALESCE(NEW.email, OLD.email),
      'role', COALESCE(NEW.role, OLD.role)::TEXT,
      'status', CASE WHEN TG_OP <> 'DELETE' THEN NEW.status ELSE OLD.status END
    );
  ELSIF TG_TABLE_NAME = 'system_admins' THEN
    v_workspace_id := public.main_workspace_id();
    v_subject_user_id := COALESCE(NEW.user_id, OLD.user_id);
    v_action := CASE TG_OP
      WHEN 'INSERT' THEN 'system.super_admin.granted'
      WHEN 'DELETE' THEN 'system.super_admin.revoked'
      ELSE 'system.super_admin.changed'
    END;
    v_details := jsonb_build_object('role', 'super_admin');
  END IF;

  v_details := v_details || jsonb_build_object(
    'actor_id', auth.uid(),
    'actor_db_role', session_user
  );

  INSERT INTO public.workspace_access_audit (
    workspace_id, actor_id, subject_user_id, action, details
  ) VALUES (
    v_workspace_id, auth.uid(), v_subject_user_id, v_action, v_details
  );

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_memberships_access_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_memberships
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_access_change();
CREATE TRIGGER workspace_member_permissions_access_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_member_permissions
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_access_change();
CREATE TRIGGER workspace_invitations_access_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.workspace_invitations
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_access_change();
CREATE TRIGGER system_admins_access_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.system_admins
  FOR EACH ROW EXECUTE FUNCTION public.audit_workspace_access_change();

CREATE OR REPLACE FUNCTION public.prevent_lead_creator_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Lead creator cannot be changed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_creator_immutable
  BEFORE UPDATE OF user_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.prevent_lead_creator_change();

CREATE OR REPLACE FUNCTION public.prevent_lead_scope_change_without_permission()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     AND (
       NOT public.has_workspace_permission(
         OLD.workspace_id, 'leads.assign', OLD.team_id, OLD.operator_id, OLD.offer_id
       )
       OR NOT public.has_workspace_permission(
         NEW.workspace_id, 'leads.assign', NEW.team_id, NEW.operator_id, NEW.offer_id
       )
     ) THEN
    RAISE EXCEPTION 'Changing lead workspace requires leads.assign permission' USING ERRCODE = '42501';
  END IF;
  IF NEW.operator_id IS DISTINCT FROM OLD.operator_id
     AND NOT public.has_workspace_permission(
       NEW.workspace_id, 'leads.assign', NEW.team_id, NEW.operator_id, NEW.offer_id
     ) THEN
    RAISE EXCEPTION 'Changing lead operator requires leads.assign permission' USING ERRCODE = '42501';
  END IF;
  IF NEW.team_id IS DISTINCT FROM OLD.team_id
     AND NOT public.has_workspace_permission(
       NEW.workspace_id, 'leads.assign_team', NEW.team_id, NEW.operator_id, NEW.offer_id
     ) THEN
    RAISE EXCEPTION 'Changing lead team requires leads.assign_team permission' USING ERRCODE = '42501';
  END IF;
  IF NEW.offer_id IS DISTINCT FROM OLD.offer_id
     AND NOT public.has_workspace_permission(
       NEW.workspace_id, 'leads.assign_offer', NEW.team_id, NEW.operator_id, NEW.offer_id
     ) THEN
    RAISE EXCEPTION 'Changing lead offer requires leads.assign_offer permission' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER leads_scope_change_authorized
  BEFORE UPDATE OF workspace_id, team_id, operator_id, offer_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.prevent_lead_scope_change_without_permission();

CREATE OR REPLACE FUNCTION public.my_workspaces()
RETURNS TABLE (id UUID, name TEXT, slug TEXT, role TEXT, is_super_admin BOOLEAN)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT w.id, w.name, w.slug,
    CASE WHEN public.is_super_admin(auth.uid()) THEN 'super_admin' ELSE m.role::TEXT END,
    public.is_super_admin(auth.uid())
  FROM public.workspaces w
  LEFT JOIN public.workspace_memberships m
    ON m.workspace_id = w.id AND m.user_id = auth.uid() AND m.status = 'active'
  WHERE public.is_super_admin(auth.uid()) OR m.id IS NOT NULL
  ORDER BY w.created_at, w.name;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_members(p_workspace_id UUID)
RETURNS TABLE (
  user_id UUID,
  email TEXT,
  role TEXT,
  status TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'members.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT m.user_id, u.email::TEXT, m.role::TEXT, m.status, m.created_at
  FROM public.workspace_memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.workspace_id = p_workspace_id
  ORDER BY m.created_at, u.email;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_member_permissions(
  p_workspace_id UUID,
  p_user_id UUID
)
RETURNS TABLE (
  permission_key TEXT,
  allowed BOOLEAN,
  delegable BOOLEAN,
  scope_type TEXT,
  scope_id UUID
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin(auth.uid()) AND NOT public.has_workspace_permission(
    p_workspace_id, 'permissions.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT mp.permission_key, mp.allowed, mp.delegable, mp.scope_type::TEXT, mp.scope_id
  FROM public.workspace_member_permissions mp
  JOIN public.workspace_memberships m ON m.id = mp.membership_id
  WHERE mp.workspace_id = p_workspace_id AND m.user_id = p_user_id
  ORDER BY mp.permission_key, mp.scope_type, mp.scope_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_invitations(p_workspace_id UUID)
RETURNS TABLE (
  id UUID,
  email TEXT,
  role TEXT,
  status TEXT,
  invited_by UUID,
  created_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'members.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT i.id, i.email, i.role::TEXT, i.status, i.invited_by, i.created_at, i.expires_at
  FROM public.workspace_invitations i
  WHERE i.workspace_id = p_workspace_id
  ORDER BY i.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_teams(p_workspace_id UUID)
RETURNS TABLE (id UUID, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.name, t.created_at
  FROM public.workspace_teams t
  WHERE t.workspace_id = p_workspace_id
    AND public.has_workspace_permission(
      p_workspace_id, 'teams.read', t.id, NULL, NULL
    )
  ORDER BY t.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace_team(
  p_workspace_id UUID,
  p_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 OR length(trim(p_name)) > 120 THEN
    RAISE EXCEPTION 'Team name must contain 1 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'teams.manage', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.workspace_teams (workspace_id, name)
  VALUES (p_workspace_id, trim(p_name))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_offers(p_workspace_id UUID)
RETURNS TABLE (id UUID, name TEXT, created_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.name, o.created_at
  FROM public.workspace_offers o
  WHERE o.workspace_id = p_workspace_id
    AND public.has_workspace_permission(
      p_workspace_id, 'offers.read', NULL, NULL, o.id
    )
  ORDER BY o.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace_offer(
  p_workspace_id UUID,
  p_name TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_name IS NULL OR length(trim(p_name)) = 0 OR length(trim(p_name)) > 120 THEN
    RAISE EXCEPTION 'Offer name must contain 1 to 120 characters' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.workspace_offers (workspace_id, name)
  VALUES (p_workspace_id, trim(p_name))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_workspace_access_audit(
  p_workspace_id UUID,
  p_limit INTEGER
)
RETURNS TABLE (
  id BIGINT,
  actor_id UUID,
  subject_user_id UUID,
  action TEXT,
  details JSONB,
  created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 500 THEN
    RAISE EXCEPTION 'Audit page size must be between 1 and 500' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_super_admin(auth.uid()) AND NOT public.has_workspace_permission(
    p_workspace_id, 'audit.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.id, a.actor_id, a.subject_user_id, a.action, a.details, a.created_at
  FROM public.workspace_access_audit a
  WHERE a.workspace_id = p_workspace_id
  ORDER BY a.created_at DESC
  LIMIT p_limit;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_member_role(
  p_workspace_id UUID,
  p_user_id UUID,
  p_role TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_role public.workspace_member_role;
BEGIN
  IF NOT public.is_super_admin(v_actor_id) THEN
    IF v_actor_id IS NULL OR v_actor_id = p_user_id THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
    IF NOT public.has_workspace_permission(
      p_workspace_id, 'members.manage_roles', NULL, NULL, NULL
    ) THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_role NOT IN ('admin', 'operator', 'viewer') THEN
    RAISE EXCEPTION 'Invalid workspace role' USING ERRCODE = '22023';
  END IF;
  v_role := p_role::public.workspace_member_role;

  IF NOT public.is_super_admin(v_actor_id) THEN
    IF v_role = 'admin' AND NOT public.has_workspace_permission(
      p_workspace_id, 'members.assign_admin', NULL, NULL, NULL
    ) THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
    IF public.is_super_admin(p_user_id) THEN
      RAISE EXCEPTION 'Workspace member not found' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  UPDATE public.workspace_memberships
  SET role = v_role, updated_at = now()
  WHERE workspace_id = p_workspace_id AND user_id = p_user_id AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Workspace member not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_workspace_member_permission(
  p_workspace_id UUID,
  p_user_id UUID,
  p_permission_key TEXT,
  p_allowed BOOLEAN,
  p_scope_type TEXT,
  p_scope_id UUID,
  p_delegable BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_actor_membership_id UUID;
  v_actor_role public.workspace_member_role;
  v_target_membership_id UUID;
  v_scope_type public.workspace_scope_type;
  v_is_super_admin BOOLEAN;
  v_requested_team_id UUID;
  v_requested_operator_id UUID;
  v_requested_offer_id UUID;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  v_is_super_admin := public.is_super_admin(v_actor_id);
  IF NOT v_is_super_admin THEN
    SELECT m.id, m.role INTO v_actor_membership_id, v_actor_role
    FROM public.workspace_memberships m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = v_actor_id AND m.status = 'active';

    IF v_actor_membership_id IS NULL OR v_actor_role <> 'admin'
       OR NOT public.has_workspace_permission(
         p_workspace_id, 'permissions.manage', NULL, NULL, NULL
       ) THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
    IF p_user_id = v_actor_id THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
    IF p_delegable IS TRUE THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_scope_type IS NULL OR p_scope_type NOT IN ('workspace', 'team', 'operator', 'offer') THEN
    IF NOT v_is_super_admin THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Invalid permission scope' USING ERRCODE = '22023';
  END IF;
  v_scope_type := p_scope_type::public.workspace_scope_type;
  IF (v_scope_type = 'workspace' AND p_scope_id IS NOT NULL)
     OR (v_scope_type <> 'workspace' AND p_scope_id IS NULL) THEN
    RAISE EXCEPTION 'Invalid permission scope id' USING ERRCODE = '22023';
  END IF;

  IF v_scope_type = 'team' THEN
    v_requested_team_id := p_scope_id;
  ELSIF v_scope_type = 'operator' THEN
    v_requested_operator_id := p_scope_id;
  ELSIF v_scope_type = 'offer' THEN
    v_requested_offer_id := p_scope_id;
  END IF;

  -- Authorize an Admin's exact delegation before looking up target membership,
  -- permission catalog entries, or scoped objects. Unauthorized RPC probes all
  -- receive the same error regardless of which resource or permission exists.
  IF NOT v_is_super_admin THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.workspace_member_permissions source
      WHERE source.membership_id = v_actor_membership_id
        AND source.permission_key = p_permission_key
        AND source.allowed = TRUE
        AND source.delegable = TRUE
        AND source.authority = 'super_admin'
        AND (
          source.scope_type = 'workspace'
          OR (source.scope_type = v_scope_type AND source.scope_id = p_scope_id)
        )
    ) OR NOT public.has_workspace_permission(
      p_workspace_id,
      p_permission_key,
      v_requested_team_id,
      v_requested_operator_id,
      v_requested_offer_id
    ) THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_permission_catalog pc
    WHERE pc.permission_key = p_permission_key
  ) THEN
    IF NOT v_is_super_admin THEN
      RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'Unknown permission' USING ERRCODE = '22023';
  END IF;

  IF v_scope_type = 'team' AND NOT EXISTS (
    SELECT 1 FROM public.workspace_teams t
    WHERE t.id = p_scope_id AND t.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Team scope is outside this workspace' USING ERRCODE = '22023';
  END IF;
  IF v_scope_type = 'offer' AND NOT EXISTS (
    SELECT 1 FROM public.workspace_offers o
    WHERE o.id = p_scope_id AND o.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Offer scope is outside this workspace' USING ERRCODE = '22023';
  END IF;
  IF v_scope_type = 'operator' AND NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = p_workspace_id
      AND m.user_id = p_scope_id
      AND m.role = 'operator'
      AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Operator scope is outside this workspace' USING ERRCODE = '22023';
  END IF;

  SELECT m.id INTO v_target_membership_id
  FROM public.workspace_memberships m
  WHERE m.workspace_id = p_workspace_id AND m.user_id = p_user_id AND m.status = 'active';
  IF v_target_membership_id IS NULL THEN
    RAISE EXCEPTION 'Workspace member not found' USING ERRCODE = 'P0002';
  END IF;

  -- Match the missing-member response so this permission RPC does not reveal
  -- whether a requested account is a protected system administrator.
  IF NOT v_is_super_admin AND public.is_super_admin(p_user_id) THEN
    RAISE EXCEPTION 'Workspace member not found' USING ERRCODE = 'P0002';
  END IF;

  -- Serialize writes to the same member/permission/scope tuple. This closes
  -- the check-then-upsert race where an Admin RPC could overwrite a concurrent
  -- Super Admin deny despite the provenance check below.
  PERFORM pg_advisory_xact_lock(hashtextextended(
    p_workspace_id::TEXT || ':' || p_user_id::TEXT || ':' || p_permission_key || ':' ||
    v_scope_type::TEXT || ':' || COALESCE(p_scope_id::TEXT, 'workspace'),
    0
  ));

  IF NOT v_is_super_admin AND EXISTS (
    SELECT 1 FROM public.workspace_member_permissions current_grant
    WHERE current_grant.membership_id = v_target_membership_id
      AND current_grant.permission_key = p_permission_key
      AND current_grant.scope_type = v_scope_type
      AND current_grant.scope_id IS NOT DISTINCT FROM p_scope_id
      AND current_grant.authority = 'super_admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_super_admin AND p_allowed IS TRUE AND EXISTS (
    SELECT 1 FROM public.workspace_member_permissions absolute_deny
    WHERE absolute_deny.membership_id = v_target_membership_id
      AND absolute_deny.permission_key = p_permission_key
      AND absolute_deny.allowed = FALSE
      AND absolute_deny.authority = 'super_admin'
      AND public.permission_scope_matches(
        absolute_deny.scope_type, absolute_deny.scope_id, p_workspace_id,
        v_requested_team_id, v_requested_operator_id, v_requested_offer_id, p_user_id
      )
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_allowed IS NULL THEN
    DELETE FROM public.workspace_member_permissions
    WHERE membership_id = v_target_membership_id
      AND permission_key = p_permission_key
      AND scope_type = v_scope_type
      AND scope_id IS NOT DISTINCT FROM p_scope_id;
  ELSE
    INSERT INTO public.workspace_member_permissions (
      membership_id, workspace_id, permission_key, allowed,
      scope_type, scope_id, delegable, authority, granted_by
    ) VALUES (
      v_target_membership_id, p_workspace_id, p_permission_key, p_allowed,
      v_scope_type, p_scope_id, COALESCE(p_delegable, FALSE),
      CASE WHEN v_is_super_admin THEN 'super_admin'::public.workspace_permission_authority
           ELSE 'admin'::public.workspace_permission_authority END,
      v_actor_id
    )
    ON CONFLICT (membership_id, permission_key, scope_type, (COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'::UUID)))
    DO UPDATE SET
      allowed = EXCLUDED.allowed,
      delegable = EXCLUDED.delegable,
      authority = EXCLUDED.authority,
      granted_by = EXCLUDED.granted_by,
      updated_at = now();
  END IF;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
  p_workspace_id UUID,
  p_email TEXT,
  p_role TEXT,
  p_token_hash TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
  v_role public.workspace_member_role;
  v_invitation_id UUID;
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'members.invite', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_role = 'admin' AND NOT public.has_workspace_permission(
    p_workspace_id, 'members.assign_admin', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_email IS NULL OR length(trim(p_email)) > 255 OR p_email !~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invalid email address' USING ERRCODE = '22023';
  END IF;
  IF p_role NOT IN ('admin', 'operator', 'viewer') THEN
    RAISE EXCEPTION 'Invalid workspace role' USING ERRCODE = '22023';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid invitation token' USING ERRCODE = '22023';
  END IF;
  v_role := p_role::public.workspace_member_role;
  IF EXISTS (
    SELECT 1 FROM auth.users u
    JOIN public.workspace_memberships m ON m.user_id = u.id
    WHERE m.workspace_id = p_workspace_id AND m.status = 'active'
      AND lower(u.email) = lower(trim(p_email))
  ) THEN
    RAISE EXCEPTION 'User is already a workspace member' USING ERRCODE = '23505';
  END IF;

  UPDATE public.workspace_invitations
  SET status = 'revoked'
  WHERE workspace_id = p_workspace_id
    AND lower(email) = lower(trim(p_email)) AND status = 'pending';

  INSERT INTO public.workspace_invitations (
    workspace_id, email, role, token_hash, invited_by
  ) VALUES (
    p_workspace_id, lower(trim(p_email)), v_role, p_token_hash, v_actor_id
  ) RETURNING id INTO v_invitation_id;
  RETURN v_invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.validate_workspace_invitation(p_token_hash TEXT)
RETURNS TABLE (email TEXT, role TEXT, workspace_name TEXT, expires_at TIMESTAMPTZ)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.email, i.role::TEXT, w.name, i.expires_at
  FROM public.workspace_invitations i
  JOIN public.workspaces w ON w.id = i.workspace_id
  WHERE i.token_hash = p_token_hash
    AND i.status = 'pending'
    AND i.expires_at > now()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.accept_workspace_invitation(p_token_hash TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_invitation public.workspace_invitations%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT lower(u.email), u.email_confirmed_at
  INTO v_email, v_email_confirmed_at
  FROM auth.users u WHERE u.id = v_user_id;
  SELECT * INTO v_invitation
  FROM public.workspace_invitations i
  WHERE i.token_hash = p_token_hash AND i.status = 'pending'
    AND i.expires_at > now()
  FOR UPDATE;
  IF v_invitation.id IS NULL THEN
    RAISE EXCEPTION 'Invitation is invalid, expired, or already used' USING ERRCODE = 'P0002';
  END IF;
  IF v_email IS NULL OR v_email <> lower(v_invitation.email) THEN
    RAISE EXCEPTION 'Invitation email does not match the signed-in account' USING ERRCODE = '42501';
  END IF;
  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'Confirm the invited email address before accepting' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = v_invitation.workspace_id AND m.user_id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Account already has workspace membership' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.workspace_memberships (
    workspace_id, user_id, role, invited_by
  ) VALUES (
    v_invitation.workspace_id, v_user_id, v_invitation.role, v_invitation.invited_by
  );
  UPDATE public.workspace_invitations
  SET status = 'accepted', accepted_by = v_user_id, accepted_at = now()
  WHERE id = v_invitation.id;
  RETURN v_invitation.workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_workspace_invitation(
  p_workspace_id UUID,
  p_invitation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_id UUID := auth.uid();
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'members.invite', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  UPDATE public.workspace_invitations
  SET status = 'revoked'
  WHERE id = p_invitation_id
    AND workspace_id = p_workspace_id
    AND status = 'pending'
    AND (public.is_super_admin(v_actor_id) OR invited_by = v_actor_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found or cannot be revoked' USING ERRCODE = 'P0002';
  END IF;
  RETURN TRUE;
END;
$$;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_permission_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_member_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_access_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own leads" ON public.leads;

CREATE POLICY workspaces_read_member
  ON public.workspaces FOR SELECT TO authenticated
  USING (public.has_workspace_permission(id, 'workspace.read', NULL, NULL, NULL));

CREATE POLICY memberships_read_self_or_authorized
  ON public.workspace_memberships FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.has_workspace_permission(workspace_id, 'members.read', NULL, NULL, NULL)
  );

CREATE POLICY teams_read_authorized
  ON public.workspace_teams FOR SELECT TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'teams.read', id, NULL, NULL));

CREATE POLICY offers_read_authorized
  ON public.workspace_offers FOR SELECT TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'offers.read', NULL, NULL, id));

CREATE POLICY teams_insert_authorized
  ON public.workspace_teams FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_permission(workspace_id, 'teams.manage', NULL, NULL, NULL));

CREATE POLICY teams_update_authorized
  ON public.workspace_teams FOR UPDATE TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'teams.manage', id, NULL, NULL))
  WITH CHECK (public.has_workspace_permission(workspace_id, 'teams.manage', id, NULL, NULL));

CREATE POLICY teams_delete_authorized
  ON public.workspace_teams FOR DELETE TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'teams.manage', id, NULL, NULL));

CREATE POLICY offers_insert_authorized
  ON public.workspace_offers FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_permission(workspace_id, 'offers.manage', NULL, NULL, NULL));

CREATE POLICY offers_update_authorized
  ON public.workspace_offers FOR UPDATE TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'offers.manage', NULL, NULL, id))
  WITH CHECK (public.has_workspace_permission(workspace_id, 'offers.manage', NULL, NULL, id));

CREATE POLICY offers_delete_authorized
  ON public.workspace_offers FOR DELETE TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'offers.manage', NULL, NULL, id));

CREATE POLICY member_permissions_read_authorized
  ON public.workspace_member_permissions FOR SELECT TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'permissions.read', NULL, NULL, NULL));

CREATE POLICY invitations_read_authorized
  ON public.workspace_invitations FOR SELECT TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'members.read', NULL, NULL, NULL));

CREATE POLICY audit_read_authorized
  ON public.workspace_access_audit FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND public.has_workspace_permission(
    workspace_id, 'audit.read', NULL, NULL, NULL
  ));

CREATE POLICY leads_read_authorized
  ON public.leads FOR SELECT TO authenticated
  USING (public.has_workspace_permission(
    workspace_id, 'leads.read', team_id, operator_id, offer_id
  ));

CREATE POLICY leads_insert_authorized
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND public.has_workspace_permission(
      workspace_id, 'leads.create', team_id, operator_id, offer_id
    )
    AND (
      operator_id = auth.uid()
      OR public.has_workspace_permission(
        workspace_id, 'leads.assign', team_id, operator_id, offer_id
      )
    )
    AND (
      team_id IS NULL
      OR public.has_workspace_permission(
        workspace_id, 'leads.assign_team', team_id, operator_id, offer_id
      )
    )
    AND (
      offer_id IS NULL
      OR public.has_workspace_permission(
        workspace_id, 'leads.assign_offer', team_id, operator_id, offer_id
      )
    )
  );

CREATE POLICY leads_update_authorized
  ON public.leads FOR UPDATE TO authenticated
  USING (public.has_workspace_permission(
    workspace_id, 'leads.update', team_id, operator_id, offer_id
  ))
  WITH CHECK (public.has_workspace_permission(
    workspace_id, 'leads.update', team_id, operator_id, offer_id
  ));

CREATE POLICY leads_delete_authorized
  ON public.leads FOR DELETE TO authenticated
  USING (public.has_workspace_permission(
    workspace_id, 'leads.delete', team_id, operator_id, offer_id
  ));

REVOKE ALL ON public.system_admins, public.workspace_permission_catalog,
  public.workspace_role_permissions FROM anon, authenticated;
REVOKE ALL ON public.workspaces, public.workspace_memberships,
  public.workspace_teams, public.workspace_offers,
  public.workspace_member_permissions, public.workspace_invitations,
  public.workspace_access_audit FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_teams,
  public.workspace_offers TO authenticated;
GRANT SELECT ON public.workspaces, public.workspace_memberships,
  public.workspace_teams, public.workspace_offers,
  public.workspace_member_permissions, public.workspace_invitations,
  public.workspace_access_audit TO authenticated;

REVOKE ALL ON FUNCTION public.main_workspace_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_super_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.permission_scope_matches(public.workspace_scope_type, UUID, UUID, UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_workspace_permission(UUID, TEXT, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_workspaces() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_members(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_member_permissions(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_invitations(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_teams(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_workspace_team(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_offers(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_workspace_offer(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_workspace_access_audit(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_lead_scope_change_without_permission() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_workspace_member_role(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_workspace_member_permission(UUID, UUID, TEXT, BOOLEAN, TEXT, UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_workspace_invitation(UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.validate_workspace_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_workspace_invitation(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_workspace_invitation(UUID, UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.main_workspace_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.permission_scope_matches(public.workspace_scope_type, UUID, UUID, UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_workspace_permission(UUID, TEXT, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.my_workspaces() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_members(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_member_permissions(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_invitations(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_teams(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_team(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_offers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_offer(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_access_audit(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_member_role(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_member_permission(UUID, UUID, TEXT, BOOLEAN, TEXT, UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_workspace_invitation(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invitation(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_workspace_invitation(UUID, UUID) TO authenticated;
