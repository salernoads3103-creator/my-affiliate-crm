-- Read-only metadata checks for the safe record-removal migration.
-- Run only against a disposable local Supabase database after
-- 20261107100000_safe_record_removal.sql,
-- 20261107110000_lead_soft_delete.sql, and
-- 20261107120000_preserve_order_access_for_hidden_leads.sql.
DO $$
DECLARE
  v_function_definition TEXT;
  v_guarded_functions INTEGER;
  v_restrict_relationships INTEGER;
BEGIN
  IF has_table_privilege('authenticated', 'public.products', 'DELETE')
     OR has_table_privilege('authenticated', 'public.workspace_offers', 'DELETE')
     OR has_table_privilege('authenticated', 'public.workspace_tracking_profiles', 'DELETE')
     OR has_table_privilege('authenticated', 'public.leads', 'DELETE') THEN
    RAISE EXCEPTION 'Browser roles must not have direct DELETE on protected records';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_offers'
      AND cmd IN ('DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Offers must not retain a browser DELETE policy';
  END IF;

  IF has_function_privilege(
       'anon', 'public.delete_workspace_product_if_unused(uuid,uuid)', 'EXECUTE'
     ) OR has_function_privilege(
       'service_role', 'public.delete_workspace_product_if_unused(uuid,uuid)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'authenticated', 'public.delete_workspace_product_if_unused(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Product deletion RPC must be authenticated and workspace-authorized';
  END IF;

  IF has_function_privilege(
       'anon', 'public.delete_commercial_offer_if_unused(uuid,uuid)', 'EXECUTE'
     ) OR has_function_privilege(
       'service_role', 'public.delete_commercial_offer_if_unused(uuid,uuid)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'authenticated', 'public.delete_commercial_offer_if_unused(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Offer deletion RPC must be authenticated and workspace-authorized';
  END IF;

  IF has_function_privilege(
       'anon', 'public.set_workspace_offer_active(uuid,uuid,boolean)', 'EXECUTE'
     ) OR has_function_privilege(
       'service_role', 'public.set_workspace_offer_active(uuid,uuid,boolean)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'authenticated', 'public.set_workspace_offer_active(uuid,uuid,boolean)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Offer activation RPC must remain authenticated and permission-checked';
  END IF;

  IF has_function_privilege(
       'anon', 'public.delete_workspace_domain_address(uuid,uuid)', 'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.delete_workspace_domain_address(uuid,uuid)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role', 'public.delete_workspace_domain_address(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Domain deletion RPC must remain server-only';
  END IF;

  IF has_function_privilege('anon', 'public.remove_workspace_lead(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.remove_workspace_lead(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.remove_workspace_lead(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.restore_workspace_lead(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.restore_workspace_lead(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.restore_workspace_lead(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Lead removal and restoration RPCs must be authenticated and permission-checked';
  END IF;

  IF has_function_privilege('anon', 'public.can_read_workspace_order(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.can_read_workspace_order(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.can_read_workspace_order(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'The order visibility helper must be authenticated and read-only';
  END IF;

  SELECT count(*) INTO v_guarded_functions
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid IN (
    'public.delete_workspace_product_if_unused(uuid,uuid)'::REGPROCEDURE,
    'public.delete_commercial_offer_if_unused(uuid,uuid)'::REGPROCEDURE,
    'public.set_workspace_offer_active(uuid,uuid,boolean)'::REGPROCEDURE,
    'public.delete_workspace_domain_address(uuid,uuid)'::REGPROCEDURE,
    'public.remove_workspace_lead(uuid,uuid)'::REGPROCEDURE,
    'public.restore_workspace_lead(uuid,uuid)'::REGPROCEDURE,
    'public.can_read_workspace_order(uuid,uuid)'::REGPROCEDURE
  ) AND procedure.prosecdef
    AND procedure.proconfig @> ARRAY['search_path=pg_catalog, public'];
  IF v_guarded_functions <> 7 THEN
    RAISE EXCEPTION 'All guarded RPCs must be SECURITY DEFINER with a fixed search_path';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.delete_workspace_product_if_unused(uuid,uuid)'::REGPROCEDURE
  ) INTO v_function_definition;
  IF position('p_workspace_id' IN v_function_definition) = 0
     OR position('workspace_offers' IN v_function_definition) = 0
     OR position('workspace_orders' IN v_function_definition) = 0
     OR position('products.manage' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Product deletion must enforce workspace, RBAC, offer, and order checks';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.delete_commercial_offer_if_unused(uuid,uuid)'::REGPROCEDURE
  ) INTO v_function_definition;
  IF position('p_workspace_id' IN v_function_definition) = 0
     OR position('offers.manage' IN v_function_definition) = 0
     OR position('leads' IN v_function_definition) = 0
     OR position('workspace_orders' IN v_function_definition) = 0
     OR position('workspace_landings' IN v_function_definition) = 0
     OR position('landing_form_integrations' IN v_function_definition) = 0
     OR position('workspace_offer_launch_workflows' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Offer deletion must retain workspace and historical relationship checks';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.delete_workspace_domain_address(uuid,uuid)'::REGPROCEDURE
  ) INTO v_function_definition;
  IF position('p_workspace_id' IN v_function_definition) = 0
     OR position('landing_publication_versions' IN v_function_definition) = 0
     OR position('landing_publication_operations' IN v_function_definition) = 0
     OR position('Remove subdomains' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Domain deletion must retain workspace and publication-history checks';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.remove_workspace_lead(uuid,uuid)'::REGPROCEDURE
  ) INTO v_function_definition;
  IF position('has_workspace_permission' IN v_function_definition) = 0
     OR position('workspace_orders' IN v_function_definition) = 0
     OR position('deleted_at' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Lead removal must check scoped permission and preserve order-linked leads';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.restore_workspace_lead(uuid,uuid)'::REGPROCEDURE
  ) INTO v_function_definition;
  IF position('workspace_memberships' IN v_function_definition) = 0
     OR position('role' IN v_function_definition) = 0
     OR position('deleted_at' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Lead restoration must require workspace administrator access';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'leads'
      AND cmd IN ('DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Leads must not retain a direct browser DELETE policy';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'leads'
      AND policyname = 'leads_read_authorized'
      AND qual ILIKE '%deleted_at%'
      AND qual ILIKE '%admin%'
  ) THEN
    RAISE EXCEPTION 'Lead read policy must hide deleted records from non-admin members';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'workspace_orders'
      AND policyname = 'workspace_orders_read_authorized'
      AND qual ILIKE '%can_read_workspace_order%'
  ) THEN
    RAISE EXCEPTION 'Order access must preserve lead scopes without exposing hidden leads';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.can_read_workspace_order(uuid,uuid)'::REGPROCEDURE
  ) INTO v_function_definition;
  IF position('leads.read' IN v_function_definition) = 0
     OR position('orders.read' IN v_function_definition) = 0
     OR position('orders.manage' IN v_function_definition) = 0
     OR position('workspace_id' IN v_function_definition) = 0 THEN
    RAISE EXCEPTION 'Order visibility helper must preserve workspace and permission scopes';
  END IF;

  SELECT count(*) INTO v_restrict_relationships
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.contype = 'f'
    AND constraint_row.confdeltype = 'r'
    AND constraint_row.conrelid IN (
      'public.workspace_landings'::REGCLASS,
      'public.workspace_offer_launch_workflows'::REGCLASS
    )
    AND constraint_row.confrelid = 'public.workspace_tracking_profiles'::REGCLASS;
  IF v_restrict_relationships <> 4 THEN
    RAISE EXCEPTION 'Landing and launch history must prevent deleting referenced tracking profiles';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conname = 'workspace_orders_workspace_lead_fkey'
      AND constraint_row.conrelid = 'public.workspace_orders'::REGCLASS
      AND constraint_row.confrelid = 'public.leads'::REGCLASS
      AND constraint_row.contype = 'f'
      AND constraint_row.confdeltype = 'r'
  ) THEN
    RAISE EXCEPTION 'The leads-orders FK must remain RESTRICT; the removal RPC handles preservation';
  END IF;
END;
$$;
