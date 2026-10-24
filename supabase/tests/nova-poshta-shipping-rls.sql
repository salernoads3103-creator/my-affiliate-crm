-- Nova Poshta delivery/RLS test. Run only against a disposable local Supabase DB
-- after the orders and Nova Poshta migrations. All fixtures are rolled back.
BEGIN;

DO $$
DECLARE
  v_shipments_policy TEXT;
  v_function_count INTEGER;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.workspace_nova_poshta_settings'::regclass AND relrowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.workspace_order_shipments'::regclass AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Delivery tables must have row-level security enabled';
  END IF;

  IF has_table_privilege('authenticated', 'public.workspace_nova_poshta_settings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.workspace_nova_poshta_settings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_nova_poshta_settings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_nova_poshta_settings', 'DELETE') THEN
    RAISE EXCEPTION 'Browser roles must not access encrypted Nova Poshta settings';
  END IF;
  IF has_table_privilege('anon', 'public.workspace_nova_poshta_settings', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_order_shipments', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_order_shipments', 'INSERT') THEN
    RAISE EXCEPTION 'Anonymous roles must not access delivery data';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.workspace_nova_poshta_settings', 'SELECT')
     OR NOT has_table_privilege('service_role', 'public.workspace_nova_poshta_settings', 'UPDATE') THEN
    RAISE EXCEPTION 'The server service role must be able to access encrypted settings';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.workspace_order_shipments', 'SELECT')
     OR has_table_privilege('authenticated', 'public.workspace_order_shipments', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_order_shipments', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_order_shipments', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated users may read scoped delivery data but must not write directly';
  END IF;

  SELECT qual INTO v_shipments_policy
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename = 'workspace_order_shipments'
    AND policyname = 'workspace_order_shipments_read_authorized';
  IF v_shipments_policy IS NULL
     OR position('has_workspace_permission' IN v_shipments_policy) = 0
     OR position('leads.read' IN v_shipments_policy) = 0
     OR position('orders.read' IN v_shipments_policy) = 0
     OR position('orders.manage' IN v_shipments_policy) = 0 THEN
    RAISE EXCEPTION 'Shipment reads must use lead scope and existing order permissions';
  END IF;

  SELECT count(*) INTO v_function_count
  FROM pg_proc AS proc
  JOIN pg_namespace AS namespace ON namespace.oid = proc.pronamespace
  WHERE namespace.nspname = 'public'
    AND proc.proname IN (
      'get_workspace_order_delivery_prefill',
      'save_workspace_order_delivery',
      'claim_workspace_order_waybill',
      'finish_workspace_order_waybill'
    )
    AND proc.prosecdef
    AND array_to_string(proc.proconfig, ',') LIKE '%search_path=pg_catalog, public%';
  IF v_function_count <> 4 THEN
    RAISE EXCEPTION 'Delivery SECURITY DEFINER functions need a fixed safe search_path';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.claim_workspace_order_waybill(uuid,uuid,uuid)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'authenticated',
       'public.claim_workspace_order_waybill(uuid,uuid,uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Waybill claim RPC must be unavailable to anon and available to authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.workspace_order_shipments'::regclass
      AND conname = 'workspace_order_shipments_workspace_order_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Shipment rows must enforce same-workspace order references';
  END IF;
END;
$$;

DO $$
BEGIN
  IF public.main_workspace_id() IS NULL THEN
    RAISE EXCEPTION 'A main workspace is required for the Nova Poshta access test';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      'a2322222-2222-4222-8222-222222222101',
      'a2322222-2222-4222-8222-222222222102'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.products WHERE id = 'f2322222-2222-4222-8222-222222222101'
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_offers WHERE id = 'c2322222-2222-4222-8222-222222222101'
  ) OR EXISTS (
    SELECT 1 FROM public.leads WHERE id IN (
      'd2322222-2222-4222-8222-222222222101',
      'd2322222-2222-4222-8222-222222222102'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_orders WHERE id IN (
      'b2322222-2222-4222-8222-222222222101',
      'b2322222-2222-4222-8222-222222222102'
    )
  ) THEN
    RAISE EXCEPTION 'Nova Poshta RLS fixture ID collision; use a clean disposable database';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('a2322222-2222-4222-8222-222222222101', 'authenticated', 'authenticated', 'shipping-op@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a2322222-2222-4222-8222-222222222102', 'authenticated', 'authenticated', 'shipping-op-other@example.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
VALUES
  (public.main_workspace_id(), 'a2322222-2222-4222-8222-222222222101', 'operator'),
  (public.main_workspace_id(), 'a2322222-2222-4222-8222-222222222102', 'operator');

INSERT INTO public.workspace_member_permissions (
  membership_id, workspace_id, permission_key, allowed,
  scope_type, scope_id, authority, granted_by
)
SELECT membership.id, membership.workspace_id, 'shipping.manage', TRUE,
       'workspace', NULL, 'super_admin', 'a2322222-2222-4222-8222-222222222101'
FROM public.workspace_memberships AS membership
WHERE membership.workspace_id = public.main_workspace_id()
  AND membership.user_id = 'a2322222-2222-4222-8222-222222222101';

INSERT INTO public.products (id, workspace_id, name, sale_price_minor)
VALUES ('f2322222-2222-4222-8222-222222222101', public.main_workspace_id(), 'Shipping RLS product', 119000);
INSERT INTO public.workspace_offers (id, workspace_id, name, product_id, offer_price_minor)
VALUES ('c2322222-2222-4222-8222-222222222101', public.main_workspace_id(), 'Shipping RLS offer', 'f2322222-2222-4222-8222-222222222101', 119000);
INSERT INTO public.leads (
  id, workspace_id, user_id, created_by_user_id, name, email, phone,
  lead_status, operator_id, offer_id
) VALUES
  ('d2322222-2222-4222-8222-222222222101', public.main_workspace_id(), 'a2322222-2222-4222-8222-222222222101', 'a2322222-2222-4222-8222-222222222101', 'Shipping RLS lead A', NULL, '+380671234567', 'New', 'a2322222-2222-4222-8222-222222222101', 'c2322222-2222-4222-8222-222222222101'),
  ('d2322222-2222-4222-8222-222222222102', public.main_workspace_id(), 'a2322222-2222-4222-8222-222222222102', 'a2322222-2222-4222-8222-222222222102', 'Shipping RLS lead B', NULL, '+380671234568', 'New', 'a2322222-2222-4222-8222-222222222102', 'c2322222-2222-4222-8222-222222222101');

INSERT INTO public.workspace_orders (
  id, workspace_id, lead_id, offer_id, product_id,
  offer_name_snapshot, product_name_snapshot, quantity, unit_price_minor,
  buyer_name, buyer_phone, idempotency_key, status, confirmed_at
) VALUES
  ('b2322222-2222-4222-8222-222222222101', public.main_workspace_id(), 'd2322222-2222-4222-8222-222222222101', 'c2322222-2222-4222-8222-222222222101', 'f2322222-2222-4222-8222-222222222101', 'Shipping RLS offer', 'Shipping RLS product', 1, 119000, 'Customer A', '+380671234567', 'e2322222-2222-4222-8222-222222222101', 'confirmed', now()),
  ('b2322222-2222-4222-8222-222222222102', public.main_workspace_id(), 'd2322222-2222-4222-8222-222222222102', 'c2322222-2222-4222-8222-222222222101', 'f2322222-2222-4222-8222-222222222101', 'Shipping RLS offer', 'Shipping RLS product', 1, 119000, 'Customer B', '+380671234568', 'e2322222-2222-4222-8222-222222222102', 'confirmed', now());

INSERT INTO public.workspace_order_shipments (
  workspace_id, order_id, delivery_type,
  recipient_city_ref, recipient_city_name, recipient_branch_ref, recipient_branch_name,
  weight_grams, length_mm, width_mm, height_mm, declared_value_minor,
  delivery_payer, delivery_payment_method
) VALUES
  (public.main_workspace_id(), 'b2322222-2222-4222-8222-222222222101', 'warehouse', '8d5a980d-391c-11dd-90d9-001a92567626', 'Київ', '90010000-0000-4000-8000-000000000001', 'Відділення 1', 850, 250, 150, 100, 119000, 'Recipient', 'Cash'),
  (public.main_workspace_id(), 'b2322222-2222-4222-8222-222222222102', 'warehouse', '8d5a980d-391c-11dd-90d9-001a92567626', 'Київ', '90010000-0000-4000-8000-000000000001', 'Відділення 1', 850, 250, 150, 100, 119000, 'Recipient', 'Cash');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_workspace_id UUID := public.main_workspace_id();
  v_count BIGINT;
  v_claim RECORD;
  v_denied BOOLEAN;
  v_blocked BOOLEAN;
  v_error_message TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a2322222-2222-4222-8222-222222222101', TRUE);
  SELECT count(*) INTO v_count FROM public.workspace_order_shipments;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.workspace_order_shipments
    WHERE order_id = 'b2322222-2222-4222-8222-222222222101'
  ) THEN
    RAISE EXCEPTION 'A shipping manager must read only shipment rows in their lead scope';
  END IF;

  PERFORM public.save_workspace_order_delivery(
    v_workspace_id, 'b2322222-2222-4222-8222-222222222101',
    'warehouse', '8d5a980d-391c-11dd-90d9-001a92567626', 'Київ', '90010000-0000-4000-8000-000000000001', 'Відділення 1',
    900, 250, 150, 100, 119050, 'Recipient', 'Cash', NULL, NULL
  );
  SELECT * INTO v_claim
  FROM public.claim_workspace_order_waybill(
    v_workspace_id, 'b2322222-2222-4222-8222-222222222101',
    'e2322222-2222-4222-8222-222222222111'
  );
  IF NOT v_claim.claimed OR v_claim.operation_status <> 'creating' THEN
    RAISE EXCEPTION 'An authorized shipping manager must be able to claim one confirmed-order attempt';
  END IF;

  SELECT * INTO v_claim
  FROM public.claim_workspace_order_waybill(
    v_workspace_id, 'b2322222-2222-4222-8222-222222222101',
    'e2322222-2222-4222-8222-222222222112'
  );
  IF v_claim.claimed OR v_claim.operation_status <> 'creating' THEN
    RAISE EXCEPTION 'A second concurrent attempt must not claim the same order';
  END IF;

  v_blocked := FALSE;
  BEGIN
    PERFORM public.save_workspace_order_delivery(
      v_workspace_id, 'b2322222-2222-4222-8222-222222222101',
      'warehouse', '8d5a980d-391c-11dd-90d9-001a92567626', 'Київ', '90010000-0000-4000-8000-000000000001', 'Відділення 1',
      850, 250, 150, 100, 119000, 'Recipient', 'Cash', NULL, NULL
    );
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
    v_blocked := v_error_message = 'Delivery cannot be edited while a waybill operation is unresolved';
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Delivery must not be editable while a waybill operation is unresolved';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a2322222-2222-4222-8222-222222222102', TRUE);
  v_denied := FALSE;
  BEGIN
    PERFORM public.save_workspace_order_delivery(
      v_workspace_id, 'b2322222-2222-4222-8222-222222222102',
      'warehouse', '8d5a980d-391c-11dd-90d9-001a92567626', 'Київ', '90010000-0000-4000-8000-000000000001', 'Відділення 1',
      850, 250, 150, 100, 119000, 'Recipient', 'Cash', NULL, NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'An operator without shipping.manage must not update delivery details';
  END IF;

  v_denied := FALSE;
  BEGIN
    INSERT INTO public.workspace_order_shipments (workspace_id, order_id)
    VALUES (v_workspace_id, 'b2322222-2222-4222-8222-222222222101');
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'Authenticated clients must not insert shipment rows directly';
  END IF;

  SELECT count(*) INTO v_count FROM public.workspace_order_shipments;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.workspace_order_shipments
    WHERE order_id = 'b2322222-2222-4222-8222-222222222102'
  ) THEN
    RAISE EXCEPTION 'Workspace permission must not expose another operator''s shipment';
  END IF;

  v_denied := FALSE;
  BEGIN
    PERFORM public.claim_workspace_order_waybill(
      v_workspace_id, 'b2322222-2222-4222-8222-222222222102',
      'e2322222-2222-4222-8222-222222222121'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'An operator without shipping.manage must not claim a waybill operation';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
