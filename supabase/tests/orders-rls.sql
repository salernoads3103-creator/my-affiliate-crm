-- Run only against a disposable local Supabase database after the Orders MVP
-- migration. Fixture rows are rolled back at the end of this test.
BEGIN;

DO $$
DECLARE
  v_main_workspace UUID := public.main_workspace_id();
  v_foreign_workspace UUID := gen_random_uuid();
  v_main_product UUID := gen_random_uuid();
  v_foreign_product UUID := gen_random_uuid();
  v_main_offer UUID := gen_random_uuid();
  v_foreign_offer UUID := gen_random_uuid();
  v_main_lead UUID := gen_random_uuid();
  v_foreign_lead UUID := gen_random_uuid();
  v_rls_enabled BOOLEAN;
  v_total_is_generated BOOLEAN;
  v_rejected BOOLEAN;
BEGIN
  IF v_main_workspace IS NULL THEN
    RAISE EXCEPTION 'A main workspace is required for the orders workspace-boundary test';
  END IF;

  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class
  WHERE oid = 'public.workspace_orders'::regclass;
  IF NOT COALESCE(v_rls_enabled, FALSE) THEN
    RAISE EXCEPTION 'RLS must remain enabled for workspace_orders';
  END IF;

  SELECT attgenerated = 's' INTO v_total_is_generated
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.workspace_orders'::regclass
    AND attname = 'total_amount_minor'
    AND NOT attisdropped;
  IF NOT COALESCE(v_total_is_generated, FALSE) THEN
    RAISE EXCEPTION 'Order total must be generated from quantity and unit price';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_orders'
      AND policyname = 'workspace_orders_read_authorized'
      AND qual LIKE '%leads.read%'
      AND qual LIKE '%orders.read%'
      AND qual LIKE '%orders.manage%'
  ) THEN
    RAISE EXCEPTION 'Order row access must check lead and order permissions in the lead scope';
  END IF;

  IF has_table_privilege('anon', 'public.workspace_orders', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_orders', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_orders', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_orders', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_orders', 'DELETE') THEN
    RAISE EXCEPTION 'Browser roles must not write order rows directly';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.workspace_orders', 'SELECT') THEN
    RAISE EXCEPTION 'Authenticated order reads must remain available through RLS';
  END IF;

  IF has_function_privilege('anon', 'public.get_workspace_order_context(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_workspace_order(uuid,uuid,uuid,integer,bigint,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_workspace_order_draft(uuid,uuid,integer,bigint,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.transition_workspace_order(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Order RPCs must not be executable by anon';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.create_workspace_order(uuid,uuid,uuid,integer,bigint,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.update_workspace_order_draft(uuid,uuid,integer,bigint,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.transition_workspace_order(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated users must use the protected order RPCs for writes';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS proc
    WHERE proc.pronamespace = 'public'::regnamespace
      AND proc.proname IN (
        'get_workspace_order_context',
        'create_workspace_order',
        'update_workspace_order_draft',
        'transition_workspace_order'
      )
      AND (
        NOT proc.prosecdef
        OR NOT COALESCE(proc.proconfig @> ARRAY['search_path=pg_catalog, public'], FALSE)
      )
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_proc AS proc
    WHERE proc.pronamespace = 'public'::regnamespace
      AND proc.proname IN (
        'get_workspace_order_context',
        'create_workspace_order',
        'update_workspace_order_draft',
        'transition_workspace_order'
      )
  ) <> 4 THEN
    RAISE EXCEPTION 'Order RPCs must be SECURITY DEFINER with a fixed search_path';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_role_permissions
    WHERE role = 'operator' AND permission_key = 'orders.manage' AND scope_type = 'operator'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.workspace_role_permissions
    WHERE role = 'viewer' AND permission_key = 'orders.read' AND scope_type = 'operator'
  ) THEN
    RAISE EXCEPTION 'Default order permissions must remain scoped to assigned operators';
  END IF;

  INSERT INTO public.workspaces (id, name, slug)
  VALUES (
    v_foreign_workspace,
    'Orders RLS fixture',
    'orders-rls-' || replace(v_foreign_workspace::TEXT, '-', '')
  );
  INSERT INTO public.products (id, workspace_id, name, sale_price_minor)
  VALUES
    (v_main_product, v_main_workspace, 'Main order RLS product', 10000),
    (v_foreign_product, v_foreign_workspace, 'Foreign order RLS product', 10000);
  INSERT INTO public.workspace_offers (
    id, workspace_id, name, product_id, offer_price_minor
  ) VALUES
    (v_main_offer, v_main_workspace, 'Main order RLS offer', v_main_product, 9000),
    (v_foreign_offer, v_foreign_workspace, 'Foreign order RLS offer', v_foreign_product, 9000);
  INSERT INTO public.leads (
    id, workspace_id, user_id, name, email, phone, offer_id
  ) VALUES
    (v_main_lead, v_main_workspace, NULL, 'Main order RLS lead', NULL, NULL, v_main_offer),
    (v_foreign_lead, v_foreign_workspace, NULL, 'Foreign order RLS lead', NULL, NULL, v_foreign_offer);

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspace_orders (
      workspace_id, lead_id, offer_id, product_id,
      offer_name_snapshot, product_name_snapshot, quantity, unit_price_minor,
      buyer_name, buyer_phone, idempotency_key
    ) VALUES (
      v_main_workspace, v_foreign_lead, v_main_offer, v_main_product,
      'Main offer', 'Main product', 1, 9000,
      'Test buyer', '+380671234567', gen_random_uuid()
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An order must not reference a lead from another workspace';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspace_orders (
      workspace_id, lead_id, offer_id, product_id,
      offer_name_snapshot, product_name_snapshot, quantity, unit_price_minor,
      buyer_name, buyer_phone, idempotency_key
    ) VALUES (
      v_main_workspace, v_main_lead, v_foreign_offer, v_foreign_product,
      'Foreign offer', 'Foreign product', 1, 9000,
      'Test buyer', '+380671234567', gen_random_uuid()
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An order must not reference an offer from another workspace';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspace_orders (
      workspace_id, lead_id, offer_id, product_id,
      offer_name_snapshot, product_name_snapshot, quantity, unit_price_minor,
      buyer_name, buyer_phone, idempotency_key
    ) VALUES (
      v_main_workspace, v_main_lead, v_main_offer, v_foreign_product,
      'Main offer', 'Foreign product', 1, 9000,
      'Test buyer', '+380671234567', gen_random_uuid()
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An order must not reference a product from another workspace';
  END IF;
END;
$$;

ROLLBACK;
