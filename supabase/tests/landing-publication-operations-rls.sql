-- Run only on a disposable local Supabase database after
-- 20261025140000_landing_publication_operations.sql. This test rolls back.
BEGIN;

DO $$
DECLARE
  v_table TEXT := 'landing_publication_operations';
  v_function TEXT;
  v_is_security_definer BOOLEAN;
  v_has_safe_search_path BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'public.landing_publication_operations'::REGCLASS
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Publication operation RLS must be enabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS policy
    WHERE policy.schemaname = 'public'
      AND policy.tablename = v_table
      AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Browser publication operation writes must remain unavailable';
  END IF;

  IF has_table_privilege('anon', 'public.landing_publication_operations', 'SELECT')
     OR has_table_privilege('anon', 'public.landing_publication_operations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.landing_publication_operations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.landing_publication_operations', 'INSERT')
     OR has_table_privilege('authenticated', 'public.landing_publication_operations', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.landing_publication_operations', 'DELETE')
     OR has_table_privilege('service_role', 'public.landing_publication_operations', 'INSERT')
     OR has_table_privilege('service_role', 'public.landing_publication_operations', 'UPDATE')
     OR has_table_privilege('service_role', 'public.landing_publication_operations', 'DELETE')
     OR NOT has_table_privilege('service_role', 'public.landing_publication_operations', 'SELECT') THEN
    RAISE EXCEPTION 'Publication operation table grants must stay server-read-only';
  END IF;

  IF has_table_privilege('service_role', 'public.landing_publication_versions', 'UPDATE')
     OR has_table_privilege('service_role', 'public.landing_publication_versions', 'DELETE')
     OR has_table_privilege('service_role', 'public.landing_publication_versions', 'INSERT') THEN
    RAISE EXCEPTION 'Publication versions must be created by the controlled claim RPC and remain immutable';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'claim_landing_publication_operation(uuid,uuid,uuid,uuid,text,text,text,uuid,text,text,uuid,uuid)',
    'advance_landing_publication_operation(uuid)',
    'complete_landing_publication_operation(uuid)',
    'fail_landing_publication_operation(uuid)',
    'require_landing_publication_recovery(uuid)'
  ] LOOP
    SELECT proc.prosecdef,
           COALESCE(proc.proconfig, ARRAY[]::TEXT[])
             @> ARRAY['search_path=pg_catalog, public']::TEXT[]
      INTO v_is_security_definer, v_has_safe_search_path
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.oid = to_regprocedure('public.' || v_function);
    IF NOT FOUND OR NOT v_is_security_definer OR NOT v_has_safe_search_path THEN
      RAISE EXCEPTION 'Publication RPC must be SECURITY DEFINER with a pinned search_path: %', v_function;
    END IF;

    IF has_function_privilege('anon', 'public.' || v_function, 'EXECUTE')
       OR has_function_privilege('authenticated', 'public.' || v_function, 'EXECUTE')
       OR NOT has_function_privilege('service_role', 'public.' || v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'Publication RPC ACL is incorrect for public.%', v_function;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_indexes AS index
    WHERE index.schemaname = 'public'
      AND index.indexname = 'landing_publication_operations_one_unresolved_per_host'
      AND index.indexdef LIKE '%UNIQUE%'
      AND index.indexdef LIKE '%status%'
  ) THEN
    RAISE EXCEPTION 'Only one unresolved publication operation per hostname must be enforced';
  END IF;
END;
$$;

ROLLBACK;
