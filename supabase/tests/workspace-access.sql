-- Manual SQL integration test. Run only against a disposable local Supabase DB
-- after migrations; this file wraps all fixtures in a transaction and rolls back.
-- Execute as the local database owner with psql -v ON_ERROR_STOP=1 -f this-file.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      'a1111111-1111-4111-8111-111111111101',
      'a1111111-1111-4111-8111-111111111102',
      'a1111111-1111-4111-8111-111111111103',
      'a1111111-1111-4111-8111-111111111104',
      'a1111111-1111-4111-8111-111111111105',
      'a1111111-1111-4111-8111-111111111106',
      'a1111111-1111-4111-8111-111111111107',
      'a1111111-1111-4111-8111-111111111108',
      'a1111111-1111-4111-8111-111111111109',
      'a1111111-1111-4111-8111-111111111110',
      'a1111111-1111-4111-8111-111111111111',
      'a1111111-1111-4111-8111-111111111112',
      'a1111111-1111-4111-8111-111111111113'
    )
  ) THEN
    RAISE EXCEPTION 'RBAC test UUID collision; reset the disposable test database';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('a1111111-1111-4111-8111-111111111101', 'authenticated', 'authenticated', 'rbac-sa@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111102', 'authenticated', 'authenticated', 'rbac-admin@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111103', 'authenticated', 'authenticated', 'rbac-op-a@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111104', 'authenticated', 'authenticated', 'rbac-op-b@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111105', 'authenticated', 'authenticated', 'rbac-viewer-own@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111106', 'authenticated', 'authenticated', 'rbac-viewer-team@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111107', 'authenticated', 'authenticated', 'rbac-viewer-operator@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111108', 'authenticated', 'authenticated', 'rbac-viewer-offer@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111109', 'authenticated', 'authenticated', 'rbac-viewer-denied@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111110', 'authenticated', 'authenticated', 'rbac-admin-no-manage@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111111', 'authenticated', 'authenticated', 'rbac-other-workspace@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111112', 'authenticated', 'authenticated', 'rbac-recovery@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a1111111-1111-4111-8111-111111111113', 'authenticated', 'authenticated', 'rbac-delegation-target@example.invalid', '', now(), '{}', '{}', now(), now());

DO $$
DECLARE
  v_main_workspace UUID := public.main_workspace_id();
  v_workspace_b UUID := 'e1111111-1111-4111-8111-111111111101';
  v_rejected BOOLEAN;
BEGIN
  IF v_main_workspace IS NULL THEN
    RAISE EXCEPTION 'main workspace is missing';
  END IF;

  IF has_function_privilege('authenticated', 'lumen_private.bootstrap_first_super_admin(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'lumen_private.bootstrap_first_super_admin(uuid,text)', 'EXECUTE')
     OR has_schema_privilege('authenticated', 'lumen_private', 'USAGE') THEN
    RAISE EXCEPTION 'bootstrap function or schema is publicly reachable';
  END IF;

  PERFORM lumen_private.bootstrap_first_super_admin(
    'a1111111-1111-4111-8111-111111111101', 'rbac-sa@example.invalid'
  );

  v_rejected := FALSE;
  BEGIN
    PERFORM lumen_private.bootstrap_first_super_admin(
      'a1111111-1111-4111-8111-111111111112', 'rbac-recovery@example.invalid'
    );
  EXCEPTION WHEN SQLSTATE '23505' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'a second first-run bootstrap was not rejected';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM lumen_private.bootstrap_first_super_admin(
      'a1111111-1111-4111-8111-111111111102', 'wrong-email@example.invalid'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'bootstrap accepted a UUID/email mismatch';
  END IF;

  INSERT INTO public.workspaces (id, name, slug)
  VALUES (v_workspace_b, 'RBAC test workspace B', 'rbac-test-workspace-b');

  INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111102', 'admin'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111103', 'operator'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111104', 'operator'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111105', 'viewer'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111106', 'viewer'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111107', 'viewer'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111108', 'viewer'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111109', 'viewer'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111110', 'admin'),
    (v_workspace_b, 'a1111111-1111-4111-8111-111111111111', 'viewer'),
    (v_main_workspace, 'a1111111-1111-4111-8111-111111111113', 'viewer');

  INSERT INTO public.workspace_teams (id, workspace_id, name) VALUES
    ('b1111111-1111-4111-8111-111111111101', v_main_workspace, 'RBAC test team A'),
    ('b1111111-1111-4111-8111-111111111102', v_main_workspace, 'RBAC test team B');
  INSERT INTO public.workspace_offers (id, workspace_id, name) VALUES
    ('c1111111-1111-4111-8111-111111111101', v_main_workspace, 'RBAC test offer A'),
    ('c1111111-1111-4111-8111-111111111102', v_main_workspace, 'RBAC test offer B');

  INSERT INTO public.leads (
    id, user_id, name, email, lead_status, workspace_id, operator_id, team_id, offer_id
  ) VALUES
    ('d1111111-1111-4111-8111-111111111101', 'a1111111-1111-4111-8111-111111111103', 'RBAC lead A', 'lead-a@example.invalid', 'New', v_main_workspace, 'a1111111-1111-4111-8111-111111111103', 'b1111111-1111-4111-8111-111111111101', 'c1111111-1111-4111-8111-111111111101'),
    ('d1111111-1111-4111-8111-111111111102', 'a1111111-1111-4111-8111-111111111104', 'RBAC lead B', 'lead-b@example.invalid', 'New', v_main_workspace, 'a1111111-1111-4111-8111-111111111104', 'b1111111-1111-4111-8111-111111111102', 'c1111111-1111-4111-8111-111111111102'),
    ('d1111111-1111-4111-8111-111111111103', 'a1111111-1111-4111-8111-111111111105', 'RBAC viewer lead', 'lead-viewer@example.invalid', 'New', v_main_workspace, 'a1111111-1111-4111-8111-111111111105', NULL, NULL),
    ('d1111111-1111-4111-8111-111111111104', 'a1111111-1111-4111-8111-111111111111', 'RBAC foreign lead', 'lead-foreign@example.invalid', 'New', v_workspace_b, 'a1111111-1111-4111-8111-111111111111', NULL, NULL);

  INSERT INTO public.workspace_member_permissions (
    membership_id, workspace_id, permission_key, allowed, scope_type, scope_id,
    delegable, authority, granted_by
  )
  SELECT m.id, m.workspace_id, x.permission_key, x.allowed, x.scope_type, x.scope_id,
         x.delegable, 'super_admin', 'a1111111-1111-4111-8111-111111111101'
  FROM public.workspace_memberships m
  JOIN (VALUES
    ('a1111111-1111-4111-8111-111111111102'::UUID, 'permissions.manage', TRUE, 'workspace'::public.workspace_scope_type, NULL::UUID, FALSE),
    ('a1111111-1111-4111-8111-111111111102'::UUID, 'leads.read', TRUE, 'workspace'::public.workspace_scope_type, NULL::UUID, TRUE),
    ('a1111111-1111-4111-8111-111111111110'::UUID, 'leads.read', TRUE, 'workspace'::public.workspace_scope_type, NULL::UUID, TRUE),
    ('a1111111-1111-4111-8111-111111111106'::UUID, 'leads.read', TRUE, 'team'::public.workspace_scope_type, 'b1111111-1111-4111-8111-111111111101'::UUID, FALSE),
    ('a1111111-1111-4111-8111-111111111107'::UUID, 'leads.read', TRUE, 'operator'::public.workspace_scope_type, 'a1111111-1111-4111-8111-111111111104'::UUID, FALSE),
    ('a1111111-1111-4111-8111-111111111108'::UUID, 'leads.read', TRUE, 'offer'::public.workspace_scope_type, 'c1111111-1111-4111-8111-111111111101'::UUID, FALSE),
    ('a1111111-1111-4111-8111-111111111109'::UUID, 'leads.read', FALSE, 'workspace'::public.workspace_scope_type, NULL::UUID, FALSE)
  ) AS x(user_id, permission_key, allowed, scope_type, scope_id, delegable)
    ON m.user_id = x.user_id AND m.workspace_id = v_main_workspace;

  RAISE NOTICE 'RBAC fixtures created; running role, scope, audit, and RLS assertions';
END;
$$;

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_main_workspace UUID := public.main_workspace_id();
  v_count BIGINT;
  v_rejected BOOLEAN;
  v_updated BIGINT;
  v_new_lead_id UUID;
  v_audit JSONB;
  v_actor UUID;
BEGIN
  -- Bootstrap audit and immutable Super Admin permission audit payload.
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111101', TRUE);
  PERFORM public.set_workspace_member_permission(
    v_main_workspace, 'a1111111-1111-4111-8111-111111111105',
    'leads.assign', FALSE, 'workspace', NULL, FALSE
  );
  PERFORM public.set_workspace_member_permission(
    v_main_workspace, 'a1111111-1111-4111-8111-111111111105',
    'leads.assign', TRUE, 'workspace', NULL, TRUE
  );
  SELECT a.details, a.actor_id INTO v_audit, v_actor
  FROM public.workspace_access_audit a
  WHERE a.subject_user_id = 'a1111111-1111-4111-8111-111111111105'
    AND a.action = 'permission.changed'
  ORDER BY a.created_at DESC, a.id DESC LIMIT 1;
  IF v_actor IS DISTINCT FROM 'a1111111-1111-4111-8111-111111111101'::UUID
     OR v_audit #>> '{old,allowed}' <> 'false'
     OR v_audit #>> '{old,delegable}' <> 'false'
     OR v_audit #>> '{old,scope_type}' <> 'workspace'
     OR v_audit #> '{old,scope_id}' IS DISTINCT FROM 'null'::JSONB
     OR v_audit #>> '{old,granted_by}' <> 'a1111111-1111-4111-8111-111111111101'
     OR v_audit #>> '{old,authority}' <> 'super_admin'
     OR v_audit #>> '{new,allowed}' <> 'true'
     OR v_audit #>> '{new,delegable}' <> 'true'
     OR v_audit #>> '{new,scope_type}' <> 'workspace'
     OR v_audit #> '{new,scope_id}' IS DISTINCT FROM 'null'::JSONB
     OR v_audit #>> '{new,granted_by}' <> 'a1111111-1111-4111-8111-111111111101'
     OR v_audit #>> '{new,authority}' <> 'super_admin'
     OR v_audit #>> '{actor_id}' <> 'a1111111-1111-4111-8111-111111111101'
     OR v_audit #>> '{actor_db_role}' IS NULL THEN
    RAISE EXCEPTION 'permission audit did not preserve old/new provenance and actor';
  END IF;

  -- Super Admin can read across workspaces and is protected from public bootstrap.
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 4 THEN RAISE EXCEPTION 'Super Admin should see all 4 fixture leads; saw %', v_count; END IF;

  -- Admin sees its delegated workspace scope, not another workspace.
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111102', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 3 THEN RAISE EXCEPTION 'Admin should see 3 main-workspace leads; saw %', v_count; END IF;

  -- An Admin cannot replace or delete a Super Admin's personal deny by RPC.
  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111109',
      'leads.read', TRUE, 'workspace', NULL, FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Admin overwrote Super Admin workspace deny'; END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111109',
      'leads.read', NULL, 'workspace', NULL, FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Admin revoked Super Admin workspace deny'; END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111109',
      'leads.read', TRUE, 'team', 'b1111111-1111-4111-8111-111111111101', FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Admin bypassed broad Super Admin deny with a narrow allow'; END IF;

  -- A caller without permissions.manage, exact delegation, or the Admin role
  -- gets the same generic authorization failure through direct RPC calls.
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111110', TRUE);
  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111105',
      'leads.read', TRUE, 'workspace', NULL, FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Admin without permissions.manage delegated a permission'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111102', TRUE);
  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111102',
      'leads.read', TRUE, 'workspace', NULL, FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Admin self-granted a permission'; END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111113',
      'leads.read', TRUE, 'team', 'b1111111-1111-4111-8111-111111111101', TRUE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Admin made its delegated grant delegable'; END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111113',
      'leads.delete', TRUE, 'workspace', NULL, FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Admin delegated a right not explicitly granted to it'; END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_permission(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111105',
      'permissions.not_in_catalog', TRUE, 'workspace', NULL, FALSE
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Unauthorized permission-key probe did not get generic denial'; END IF;

  -- Role defaults and scope grants: operator, viewer, team, operator, and offer.
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111103', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111101') THEN
    RAISE EXCEPTION 'Operator did not see only its own lead';
  END IF;
  UPDATE public.leads SET notes = 'operator update allowed'
  WHERE id = 'd1111111-1111-4111-8111-111111111101';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN RAISE EXCEPTION 'Operator could not update its own lead'; END IF;
  INSERT INTO public.leads (
    user_id, created_by_user_id, created_via, name, phone, phone_normalized,
    workspace_id, operator_id
  )
  VALUES (
    'a1111111-1111-4111-8111-111111111103',
    'a1111111-1111-4111-8111-111111111103', 'manual', 'Operator create test',
    '067 123 45 67', '+380671234567', v_main_workspace,
    'a1111111-1111-4111-8111-111111111103'
  ) RETURNING id INTO v_new_lead_id;

  v_rejected := FALSE;
  BEGIN
    UPDATE public.leads SET created_by_user_id = 'a1111111-1111-4111-8111-111111111102'
    WHERE id = v_new_lead_id;
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Authenticated user reassigned an immutable lead author'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111105', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111103') THEN
    RAISE EXCEPTION 'Viewer did not see only its own lead';
  END IF;
  UPDATE public.leads SET notes = 'viewer must not update' WHERE id = 'd1111111-1111-4111-8111-111111111103';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN RAISE EXCEPTION 'Viewer updated a lead without leads.update'; END IF;
  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.leads (user_id, name, email, workspace_id, operator_id)
    VALUES (
      'a1111111-1111-4111-8111-111111111105', 'Viewer create test',
      'viewer-create@example.invalid', v_main_workspace,
      'a1111111-1111-4111-8111-111111111105'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Viewer created a lead without leads.create'; END IF;
  DELETE FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111103';
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 0 THEN RAISE EXCEPTION 'Viewer deleted a lead without leads.delete'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111106', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111101') THEN
    RAISE EXCEPTION 'Team-scoped viewer escaped or missed its team scope';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111107', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111102') THEN
    RAISE EXCEPTION 'Operator-scoped viewer escaped or missed its operator scope';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111108', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111101') THEN
    RAISE EXCEPTION 'Offer-scoped viewer escaped or missed its offer scope';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111109', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 0 THEN RAISE EXCEPTION 'Super Admin deny did not override the Viewer role'; END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111104') THEN
    RAISE EXCEPTION 'Workspace B member saw another workspace or missed its lead';
  END IF;

  -- Direct table writes and operator role-escalation attempts are denied.
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111103', TRUE);
  v_rejected := FALSE;
  BEGIN
    UPDATE public.workspace_member_permissions
    SET allowed = TRUE
    WHERE permission_key = 'leads.read';
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Authenticated user directly modified permission rows'; END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.set_workspace_member_role(
      v_main_workspace, 'a1111111-1111-4111-8111-111111111103', 'admin'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Operator promoted itself to Admin through direct RPC'; END IF;

  -- Non-members get false for both an existing other workspace and a missing
  -- workspace, rather than a permission-check information oracle.
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111111', TRUE);
  IF public.has_workspace_permission(
       public.main_workspace_id(), 'leads.read', NULL, NULL, NULL
     ) THEN
    RAISE EXCEPTION 'Cross-workspace permission check unexpectedly succeeded';
  END IF;
  IF public.has_workspace_permission(
       'e1111111-1111-4111-8111-111111111199', 'leads.read', NULL, NULL, NULL
     ) THEN
    RAISE EXCEPTION 'Missing-workspace permission check unexpectedly succeeded';
  END IF;

  -- Positive Admin delegation remains limited to the explicitly delegated
  -- right and scope, and the resulting grant retains its provenance.
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111102', TRUE);
  PERFORM public.set_workspace_member_permission(
    v_main_workspace, 'a1111111-1111-4111-8111-111111111113',
    'leads.read', TRUE, 'team', 'b1111111-1111-4111-8111-111111111101', FALSE
  );

  -- The Admin fixture has permissions.manage but not permissions.read. RLS
  -- must hide the grant row from this actor; inspect its persisted provenance
  -- as the Super Admin, who is authorized to read it.
  IF EXISTS (
    SELECT 1 FROM public.workspace_member_permissions mp
    JOIN public.workspace_memberships m ON m.id = mp.membership_id
    WHERE m.user_id = 'a1111111-1111-4111-8111-111111111113'
      AND mp.permission_key = 'leads.read'
      AND mp.scope_type = 'team'
      AND mp.scope_id = 'b1111111-1111-4111-8111-111111111101'
  ) THEN
    RAISE EXCEPTION 'Admin without permissions.read unexpectedly read permission provenance';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111101', TRUE);
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_member_permissions mp
    JOIN public.workspace_memberships m ON m.id = mp.membership_id
    WHERE m.user_id = 'a1111111-1111-4111-8111-111111111113'
      AND mp.permission_key = 'leads.read'
      AND mp.scope_type = 'team' AND mp.scope_id = 'b1111111-1111-4111-8111-111111111101'
      AND mp.allowed AND NOT mp.delegable
      AND mp.authority = 'admin'
      AND mp.granted_by = 'a1111111-1111-4111-8111-111111111102'
  ) THEN
    RAISE EXCEPTION 'Admin delegation is missing expected scope/provenance';
  END IF;
  PERFORM set_config('request.jwt.claim.sub', 'a1111111-1111-4111-8111-111111111113', TRUE);
  SELECT count(*) INTO v_count FROM public.leads;
  IF v_count <> 1 OR NOT EXISTS (SELECT 1 FROM public.leads WHERE id = 'd1111111-1111-4111-8111-111111111101') THEN
    RAISE EXCEPTION 'Delegated Admin scope did not remain restricted to its team';
  END IF;

  RAISE NOTICE 'RBAC role, scope, direct-RPC, audit, and RLS assertions passed';
END;
$$;

RESET ROLE;

DO $$
BEGIN
  PERFORM lumen_private.restore_super_admin_access(
    'a1111111-1111-4111-8111-111111111112', 'rbac-recovery@example.invalid'
  );
  IF NOT public.is_super_admin('a1111111-1111-4111-8111-111111111112') THEN
    RAISE EXCEPTION 'Owner-only recovery did not restore the requested account';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_memberships m
    WHERE m.workspace_id = public.main_workspace_id()
      AND m.user_id = 'a1111111-1111-4111-8111-111111111112'
      AND m.role = 'admin' AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Owner-only recovery did not restore active main workspace membership';
  END IF;
END;
$$;

ROLLBACK;
