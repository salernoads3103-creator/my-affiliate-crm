-- Run only against a disposable database after 20261025160000 is applied.
BEGIN;

DO $$
DECLARE
  v_begin_oid OID := to_regprocedure(
    'public.begin_workspace_offer_launch(uuid,uuid,text,text,text,uuid,text,bigint,uuid,uuid,uuid,text,text,text)'
  );
  v_change_host_oid OID := to_regprocedure(
    'public.change_workspace_offer_launch_host(uuid,uuid,uuid)'
  );
  v_claim_oid OID := to_regprocedure(
    'public.claim_workspace_offer_launch(uuid,uuid,uuid)'
  );
  v_renew_oid OID := to_regprocedure(
    'public.renew_workspace_offer_launch_claim(uuid,uuid,uuid)'
  );
  v_release_oid OID := to_regprocedure(
    'public.release_workspace_offer_launch_claim(uuid,uuid,uuid)'
  );
BEGIN
  IF to_regclass('public.workspace_offer_launch_workflows') IS NULL THEN
    RAISE EXCEPTION 'Offer launch workflow table is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class AS relation
    WHERE relation.oid = 'public.workspace_offer_launch_workflows'::regclass
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Offer launch workflow RLS is not enabled';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = 'workspace_offer_launch_workflows'
  ) THEN
    RAISE EXCEPTION 'Browser roles must not have workflow row policies';
  END IF;

  IF has_table_privilege('anon', 'public.workspace_offer_launch_workflows', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_offer_launch_workflows', 'INSERT')
     OR has_table_privilege('anon', 'public.workspace_offer_launch_workflows', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_offer_launch_workflows', 'SELECT')
     OR has_table_privilege('authenticated', 'public.workspace_offer_launch_workflows', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_offer_launch_workflows', 'UPDATE') THEN
    RAISE EXCEPTION 'Browser roles must not directly read or change launch workflows';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.workspace_offer_launch_workflows', 'SELECT')
     OR has_table_privilege('service_role', 'public.workspace_offer_launch_workflows', 'INSERT')
     OR has_table_privilege('service_role', 'public.workspace_offer_launch_workflows', 'UPDATE')
     OR NOT has_column_privilege(
       'service_role', 'public.workspace_offer_launch_workflows', 'stage', 'UPDATE'
     )
     OR has_column_privilege(
       'service_role', 'public.workspace_offer_launch_workflows', 'tiktok_pixel_id', 'UPDATE'
     )
     OR has_column_privilege(
       'service_role', 'public.workspace_offer_launch_workflows', 'google_ads_conversion_id', 'UPDATE'
     ) THEN
    RAISE EXCEPTION 'Server role must have progress-only workflow access';
  END IF;

  IF v_begin_oid IS NULL OR NOT has_function_privilege('authenticated', v_begin_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_begin_oid, 'EXECUTE')
     OR has_function_privilege('service_role', v_begin_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Launch creation must use the authenticated, permission-checked RPC';
  END IF;

  IF v_change_host_oid IS NULL
     OR NOT has_function_privilege('service_role', v_change_host_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_change_host_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_change_host_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Hostname reassignment must remain server-only';
  END IF;

  IF v_claim_oid IS NULL OR v_renew_oid IS NULL OR v_release_oid IS NULL
     OR NOT has_function_privilege('service_role', v_claim_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_renew_oid, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_release_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_claim_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_renew_oid, 'EXECUTE')
     OR has_function_privilege('authenticated', v_release_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_claim_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_renew_oid, 'EXECUTE')
     OR has_function_privilege('anon', v_release_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'Launch processing lease RPCs must remain server-only';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc AS procedure
    WHERE procedure.oid = v_begin_oid
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_proc AS procedure
    WHERE procedure.oid = v_change_host_oid
      AND procedure.prosecdef
      AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public']
  ) OR EXISTS (
    SELECT 1 FROM pg_proc AS procedure
    WHERE procedure.oid IN (v_claim_oid, v_renew_oid, v_release_oid)
      AND (NOT procedure.prosecdef
        OR NOT procedure.proconfig @> ARRAY['search_path=pg_catalog, public'])
  ) THEN
    RAISE EXCEPTION 'Launch RPCs must be SECURITY DEFINER with a fixed search_path';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.workspace_offer_launch_workflows'::regclass
      AND constraint_row.conname = 'workspace_offer_launches_offer_unique'
      AND constraint_row.contype = 'u'
  ) OR (
    SELECT count(*) FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.workspace_offer_launch_workflows'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.conname::TEXT = ANY(ARRAY[
        'workspace_offer_launches_product_fk',
        'workspace_offer_launches_offer_fk',
        'workspace_offer_launches_host_fk',
        'workspace_offer_launches_tiktok_profile_fk',
        'workspace_offer_launches_google_profile_fk',
        'workspace_offer_launches_publication_version_fk'
      ])
  ) <> 6 THEN
    RAISE EXCEPTION 'Offer uniqueness or a workspace-isolation foreign key is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.workspace_offer_launch_workflows'::regclass
      AND constraint_row.conname = 'workspace_offer_launches_tiktok_snapshot_check'
      AND constraint_row.contype = 'c'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.workspace_offer_launch_workflows'::regclass
      AND constraint_row.conname = 'workspace_offer_launches_google_snapshot_check'
      AND constraint_row.contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Tracking profile snapshots must be validated';
  END IF;

  IF position('has_workspace_permission' IN pg_get_functiondef(v_begin_oid)) = 0
     OR position('offers.manage' IN pg_get_functiondef(v_begin_oid)) = 0
     OR position('products.read' IN pg_get_functiondef(v_begin_oid)) = 0
     OR position('landing_pages.manage' IN pg_get_functiondef(v_begin_oid)) = 0
     OR position('storage.objects' IN pg_get_functiondef(v_begin_oid)) = 0 THEN
    RAISE EXCEPTION 'Launch creation must retain server-side workspace permission checks';
  END IF;
END;
$$;

ROLLBACK;
