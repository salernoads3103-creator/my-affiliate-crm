-- Functional order/RLS test. Run only against a disposable local Supabase DB
-- after the Orders MVP migration. All fixtures are rolled back.
BEGIN;

DO $$
DECLARE
  v_main_workspace UUID := public.main_workspace_id();
BEGIN
  IF v_main_workspace IS NULL THEN
    RAISE EXCEPTION 'A main workspace is required for the orders access test';
  END IF;
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      'a2222222-2222-4222-8222-222222222101',
      'a2222222-2222-4222-8222-222222222102',
      'a2222222-2222-4222-8222-222222222103',
      'a2222222-2222-4222-8222-222222222104'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = 'e2222222-2222-4222-8222-222222222101'
       OR slug = 'orders-access-rls-fixture'
  ) THEN
    RAISE EXCEPTION 'Orders access test fixture ID collision; use a clean disposable database';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('a2222222-2222-4222-8222-222222222101', 'authenticated', 'authenticated', 'orders-op@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a2222222-2222-4222-8222-222222222102', 'authenticated', 'authenticated', 'orders-op-other@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a2222222-2222-4222-8222-222222222103', 'authenticated', 'authenticated', 'orders-viewer@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('a2222222-2222-4222-8222-222222222104', 'authenticated', 'authenticated', 'orders-op-foreign@example.invalid', '', now(), '{}', '{}', now(), now());

INSERT INTO public.workspaces (id, name, slug)
VALUES (
  'e2222222-2222-4222-8222-222222222101',
  'Orders RLS foreign workspace',
  'orders-access-rls-fixture'
);

INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES
  (public.main_workspace_id(), 'a2222222-2222-4222-8222-222222222101', 'operator'),
  (public.main_workspace_id(), 'a2222222-2222-4222-8222-222222222102', 'operator'),
  (public.main_workspace_id(), 'a2222222-2222-4222-8222-222222222103', 'viewer'),
  ('e2222222-2222-4222-8222-222222222101', 'a2222222-2222-4222-8222-222222222104', 'operator');

INSERT INTO public.products (id, workspace_id, name, sale_price_minor)
VALUES
  ('f2222222-2222-4222-8222-222222222101', public.main_workspace_id(), 'Snapshot product', 129000),
  ('f2222222-2222-4222-8222-222222222102', 'e2222222-2222-4222-8222-222222222101', 'Foreign product', 129000);

INSERT INTO public.workspace_offers (
  id, workspace_id, name, product_id, offer_price_minor
) VALUES
  ('c2222222-2222-4222-8222-222222222101', public.main_workspace_id(), 'Snapshot offer', 'f2222222-2222-4222-8222-222222222101', 119000),
  ('c2222222-2222-4222-8222-222222222102', public.main_workspace_id(), 'Other operator offer', 'f2222222-2222-4222-8222-222222222101', 119000),
  ('c2222222-2222-4222-8222-222222222103', public.main_workspace_id(), 'Viewer offer', 'f2222222-2222-4222-8222-222222222101', 119000),
  ('c2222222-2222-4222-8222-222222222104', 'e2222222-2222-4222-8222-222222222101', 'Foreign offer', 'f2222222-2222-4222-8222-222222222102', 119000);

INSERT INTO public.leads (
  id, workspace_id, user_id, created_by_user_id, name, email, phone,
  lead_status, operator_id, offer_id
) VALUES
  ('d2222222-2222-4222-8222-222222222101', public.main_workspace_id(), 'a2222222-2222-4222-8222-222222222101', 'a2222222-2222-4222-8222-222222222101', 'Main operator lead', NULL, '+380671234567', 'New', 'a2222222-2222-4222-8222-222222222101', 'c2222222-2222-4222-8222-222222222101'),
  ('d2222222-2222-4222-8222-222222222102', public.main_workspace_id(), 'a2222222-2222-4222-8222-222222222102', 'a2222222-2222-4222-8222-222222222102', 'Other operator lead', NULL, '+380671234568', 'New', 'a2222222-2222-4222-8222-222222222102', 'c2222222-2222-4222-8222-222222222102'),
  ('d2222222-2222-4222-8222-222222222103', public.main_workspace_id(), 'a2222222-2222-4222-8222-222222222103', 'a2222222-2222-4222-8222-222222222103', 'Viewer lead', NULL, '+380671234569', 'New', 'a2222222-2222-4222-8222-222222222103', 'c2222222-2222-4222-8222-222222222103'),
  ('d2222222-2222-4222-8222-222222222104', 'e2222222-2222-4222-8222-222222222101', 'a2222222-2222-4222-8222-222222222104', 'a2222222-2222-4222-8222-222222222104', 'Foreign operator lead', NULL, '+380671234570', 'New', 'a2222222-2222-4222-8222-222222222104', 'c2222222-2222-4222-8222-222222222104');

-- Seed rows owned by the other scopes so the authenticated reads can verify
-- both workspace isolation and operator-level visibility.
INSERT INTO public.workspace_orders (
  workspace_id, lead_id, offer_id, product_id,
  offer_name_snapshot, product_name_snapshot, quantity, unit_price_minor,
  buyer_name, buyer_phone, idempotency_key, created_by_user_id
) VALUES
  (public.main_workspace_id(), 'd2222222-2222-4222-8222-222222222102', 'c2222222-2222-4222-8222-222222222102', 'f2222222-2222-4222-8222-222222222101', 'Other operator offer', 'Snapshot product', 1, 119000, 'Other operator', '+380671234568', 'b2222222-2222-4222-8222-222222222102', 'a2222222-2222-4222-8222-222222222102'),
  (public.main_workspace_id(), 'd2222222-2222-4222-8222-222222222103', 'c2222222-2222-4222-8222-222222222103', 'f2222222-2222-4222-8222-222222222101', 'Viewer offer', 'Snapshot product', 1, 119000, 'Viewer', '+380671234569', 'b2222222-2222-4222-8222-222222222103', 'a2222222-2222-4222-8222-222222222103'),
  ('e2222222-2222-4222-8222-222222222101', 'd2222222-2222-4222-8222-222222222104', 'c2222222-2222-4222-8222-222222222104', 'f2222222-2222-4222-8222-222222222102', 'Foreign offer', 'Foreign product', 1, 119000, 'Foreign operator', '+380671234570', 'b2222222-2222-4222-8222-222222222104', 'a2222222-2222-4222-8222-222222222104');

SET LOCAL ROLE authenticated;

DO $$
DECLARE
  v_main_workspace UUID := public.main_workspace_id();
  v_order_id UUID;
  v_retry_id UUID;
  v_count BIGINT;
  v_total BIGINT;
  v_status TEXT;
  v_lead_status public.lead_status;
  v_rejected BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222101', TRUE);
  SELECT count(*) INTO v_count FROM public.workspace_orders;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Operator should not see orders outside their assigned lead scope';
  END IF;

  v_order_id := public.create_workspace_order(
    v_main_workspace,
    'd2222222-2222-4222-8222-222222222101',
    'b2222222-2222-4222-8222-222222222101',
    1,
    110000,
    'Main operator',
    '+380671234567',
    NULL,
    'Confirmed by phone'
  );
  v_retry_id := public.create_workspace_order(
    v_main_workspace,
    'd2222222-2222-4222-8222-222222222101',
    'b2222222-2222-4222-8222-222222222101',
    4,
    99000,
    'Changed retry payload',
    '+380671234567',
    NULL,
    NULL
  );
  IF v_retry_id IS DISTINCT FROM v_order_id THEN
    RAISE EXCEPTION 'Retry with the same idempotency key must return the original order';
  END IF;
  SELECT count(*) INTO v_count FROM public.workspace_orders;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Idempotent order creation created a duplicate row';
  END IF;

  SELECT total_amount_minor INTO v_total
  FROM public.workspace_orders WHERE id = v_order_id;
  IF v_total <> 110000 THEN
    RAISE EXCEPTION 'Order total must use exact integer kopiykas';
  END IF;

  PERFORM public.update_workspace_order_draft(
    v_main_workspace, v_order_id, 2, 8500, 'Main operator updated',
    '+380671234567', NULL, 'Quantity and price confirmed'
  );
  SELECT total_amount_minor INTO v_total
  FROM public.workspace_orders WHERE id = v_order_id;
  IF v_total <> 17000 THEN
    RAISE EXCEPTION 'Draft update must recalculate the generated total';
  END IF;

  PERFORM public.transition_workspace_order(v_main_workspace, v_order_id, 'confirmed');
  SELECT order_row.status, lead.lead_status
  INTO v_status, v_lead_status
  FROM public.workspace_orders AS order_row
  JOIN public.leads AS lead ON lead.id = order_row.lead_id
  WHERE order_row.id = v_order_id;
  IF v_status <> 'confirmed' OR v_lead_status <> 'New' THEN
    RAISE EXCEPTION 'Confirming an order must not change the lead status';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.transition_workspace_order(v_main_workspace, v_order_id, 'draft');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Confirmed orders must not transition back to draft';
  END IF;
  PERFORM public.transition_workspace_order(v_main_workspace, v_order_id, 'cancelled');

  v_rejected := FALSE;
  BEGIN
    PERFORM public.transition_workspace_order(v_main_workspace, v_order_id, 'confirmed');
  EXCEPTION WHEN SQLSTATE '23514' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cancelled orders must be terminal';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspace_orders (
      workspace_id, lead_id, offer_id, product_id,
      offer_name_snapshot, product_name_snapshot, quantity, unit_price_minor,
      buyer_name, buyer_phone, idempotency_key
    ) VALUES (
      v_main_workspace, 'd2222222-2222-4222-8222-222222222101',
      'c2222222-2222-4222-8222-222222222101',
      'f2222222-2222-4222-8222-222222222101',
      'Direct insert', 'Direct insert', 1, 1,
      'Direct insert', '+380671234567', gen_random_uuid()
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Authenticated browser roles must not insert order rows directly';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.create_workspace_order(
      'e2222222-2222-4222-8222-222222222101',
      'd2222222-2222-4222-8222-222222222104',
      gen_random_uuid(),
      1,
      1000,
      'Cross-workspace attempt',
      '+380671234567',
      NULL,
      NULL
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An operator must not create an order in another workspace';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222102', TRUE);
  SELECT count(*) INTO v_count FROM public.workspace_orders;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.workspace_orders
    WHERE lead_id = 'd2222222-2222-4222-8222-222222222102'
  ) THEN
    RAISE EXCEPTION 'An operator should see only orders for their assigned leads';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222103', TRUE);
  SELECT count(*) INTO v_count FROM public.workspace_orders;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.workspace_orders
    WHERE lead_id = 'd2222222-2222-4222-8222-222222222103'
  ) THEN
    RAISE EXCEPTION 'A viewer should read only orders for leads in their scope';
  END IF;
  v_rejected := FALSE;
  BEGIN
    PERFORM public.get_workspace_order_context(
      v_main_workspace, 'd2222222-2222-4222-8222-222222222103'
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A viewer without orders.manage must not receive order creation context';
  END IF;

  PERFORM set_config('request.jwt.claim.sub', 'a2222222-2222-4222-8222-222222222104', TRUE);
  SELECT count(*) INTO v_count FROM public.workspace_orders;
  IF v_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.workspace_orders
    WHERE workspace_id = 'e2222222-2222-4222-8222-222222222101'
  ) THEN
    RAISE EXCEPTION 'Workspace isolation must allow only the foreign operator''s own workspace';
  END IF;
END;
$$;

RESET ROLE;

-- Mutating live catalog data must not rewrite the order-time snapshots.
UPDATE public.products
SET name = 'Renamed product', sale_price_minor = 200000
WHERE id = 'f2222222-2222-4222-8222-222222222101';
UPDATE public.workspace_offers
SET name = 'Renamed offer', offer_price_minor = 180000
WHERE id = 'c2222222-2222-4222-8222-222222222101';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_orders
    WHERE lead_id = 'd2222222-2222-4222-8222-222222222101'
      AND offer_name_snapshot = 'Snapshot offer'
      AND product_name_snapshot = 'Snapshot product'
      AND unit_price_minor = 8500
      AND quantity = 2
      AND total_amount_minor = 17000
      AND status = 'cancelled'
  ) THEN
    RAISE EXCEPTION 'Live product/offer edits must not change order snapshots';
  END IF;
END;
$$;

ROLLBACK;
