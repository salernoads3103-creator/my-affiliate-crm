-- Disposable integration test for safe deletion, order-preserving lead hiding,
-- administrator restore, and workspace isolation. All fixtures roll back.
-- Run after 20261107100000_safe_record_removal.sql,
-- 20261107110000_lead_soft_delete.sql, and
-- 20261107120000_preserve_order_access_for_hidden_leads.sql.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users
    WHERE id IN (
      'f7110000-0000-4000-8000-000000000101',
      'f7110000-0000-4000-8000-000000000102'
    )
  ) OR EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id IN (
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000202'
    )
  ) THEN
    RAISE EXCEPTION 'Safe record removal fixture collision; reset the disposable database';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('f7110000-0000-4000-8000-000000000101', 'authenticated', 'authenticated', 'remove-a@example.invalid', '', now(), '{}'::JSONB, '{}'::JSONB, now(), now()),
  ('f7110000-0000-4000-8000-000000000102', 'authenticated', 'authenticated', 'remove-b@example.invalid', '', now(), '{}'::JSONB, '{}'::JSONB, now(), now());

INSERT INTO public.workspaces (id, name, slug) VALUES
  ('f7110000-0000-4000-8000-000000000201', 'Removal fixture A', 'removal-fixture-a'),
  ('f7110000-0000-4000-8000-000000000202', 'Removal fixture B', 'removal-fixture-b');

INSERT INTO public.workspace_memberships (workspace_id, user_id, role) VALUES
  ('f7110000-0000-4000-8000-000000000201', 'f7110000-0000-4000-8000-000000000101', 'admin'),
  ('f7110000-0000-4000-8000-000000000201', 'f7110000-0000-4000-8000-000000000102', 'operator'),
  ('f7110000-0000-4000-8000-000000000202', 'f7110000-0000-4000-8000-000000000102', 'admin');

INSERT INTO public.workspace_member_permissions (
  membership_id, workspace_id, permission_key, allowed, scope_type,
  scope_id, delegable, authority, granted_by
)
SELECT membership.id, membership.workspace_id, permission.permission_key, TRUE,
       'workspace', NULL, FALSE, 'admin', membership.user_id
FROM public.workspace_memberships AS membership
CROSS JOIN (VALUES
  ('products.manage'), ('products.read'), ('offers.manage'), ('leads.delete'),
  ('leads.read'), ('orders.read')
) AS permission(permission_key)
WHERE membership.workspace_id = 'f7110000-0000-4000-8000-000000000201'
  AND membership.user_id = 'f7110000-0000-4000-8000-000000000101';

INSERT INTO public.workspace_member_permissions (
  membership_id, workspace_id, permission_key, allowed, scope_type,
  scope_id, delegable, authority, granted_by
)
SELECT membership.id, membership.workspace_id, 'leads.read', TRUE,
       'workspace', NULL, FALSE, 'admin',
       'f7110000-0000-4000-8000-000000000101'
FROM public.workspace_memberships AS membership
WHERE membership.workspace_id = 'f7110000-0000-4000-8000-000000000201'
  AND membership.user_id = 'f7110000-0000-4000-8000-000000000102';

INSERT INTO public.products (id, workspace_id, name, sale_price_minor) VALUES
  ('f7110000-0000-4000-8000-000000000301', 'f7110000-0000-4000-8000-000000000201', 'Unused product', 10000),
  ('f7110000-0000-4000-8000-000000000302', 'f7110000-0000-4000-8000-000000000201', 'Product linked to offer', 12000),
  ('f7110000-0000-4000-8000-000000000303', 'f7110000-0000-4000-8000-000000000201', 'Product snapshot on order', 14000),
  ('f7110000-0000-4000-8000-000000000304', 'f7110000-0000-4000-8000-000000000202', 'Foreign product', 9000);

INSERT INTO public.workspace_offers (
  id, workspace_id, name, product_id, offer_price_minor, currency, is_active
) VALUES
  ('f7110000-0000-4000-8000-000000000401', 'f7110000-0000-4000-8000-000000000201', 'Unused offer', NULL, 10000, 'UAH', TRUE),
  ('f7110000-0000-4000-8000-000000000402', 'f7110000-0000-4000-8000-000000000201', 'Offer linked to product', 'f7110000-0000-4000-8000-000000000302', 12000, 'UAH', TRUE),
  ('f7110000-0000-4000-8000-000000000403', 'f7110000-0000-4000-8000-000000000201', 'Offer linked to order', NULL, 14000, 'UAH', TRUE),
  ('f7110000-0000-4000-8000-000000000404', 'f7110000-0000-4000-8000-000000000202', 'Foreign offer', 'f7110000-0000-4000-8000-000000000304', 9000, 'UAH', TRUE);

INSERT INTO public.leads (
  id, user_id, name, email, phone, lead_status, workspace_id, offer_id, operator_id
) VALUES
  ('f7110000-0000-4000-8000-000000000501', 'f7110000-0000-4000-8000-000000000101', 'Unused lead', 'unused@example.invalid', '+380501234501', 'New', 'f7110000-0000-4000-8000-000000000201', NULL, 'f7110000-0000-4000-8000-000000000101'),
  ('f7110000-0000-4000-8000-000000000502', 'f7110000-0000-4000-8000-000000000101', 'Lead with order', 'ordered@example.invalid', '+380501234502', 'New', 'f7110000-0000-4000-8000-000000000201', 'f7110000-0000-4000-8000-000000000403', 'f7110000-0000-4000-8000-000000000102'),
  ('f7110000-0000-4000-8000-000000000503', 'f7110000-0000-4000-8000-000000000102', 'Foreign lead', 'foreign@example.invalid', '+380501234503', 'New', 'f7110000-0000-4000-8000-000000000202', NULL, 'f7110000-0000-4000-8000-000000000102');

INSERT INTO public.workspace_orders (
  id, workspace_id, lead_id, offer_id, product_id, offer_name_snapshot,
  product_name_snapshot, quantity, unit_price_minor, buyer_name, buyer_phone,
  idempotency_key, created_by_user_id, updated_by_user_id
) VALUES (
  'f7110000-0000-4000-8000-000000000601',
  'f7110000-0000-4000-8000-000000000201',
  'f7110000-0000-4000-8000-000000000502',
  'f7110000-0000-4000-8000-000000000403',
  'f7110000-0000-4000-8000-000000000303',
  'Offer linked to order', 'Product snapshot on order', 1, 14000,
  'Lead with order', '+380501234502',
  'f7110000-0000-4000-8000-000000000701',
  'f7110000-0000-4000-8000-000000000101',
  'f7110000-0000-4000-8000-000000000101'
);

INSERT INTO public.workspace_tracking_profiles (
  id, workspace_id, name, platform, tiktok_pixel_id
) VALUES (
  'f7110000-0000-4000-8000-000000000801',
  'f7110000-0000-4000-8000-000000000201',
  'Unused TikTok profile', 'tiktok', 'PixelRemoveUnused01'
);

SELECT set_config('request.jwt.claim.sub', 'f7110000-0000-4000-8000-000000000101', TRUE);

DO $$
DECLARE
  v_rejected BOOLEAN;
  v_result UUID;
BEGIN
  v_result := public.delete_workspace_product_if_unused(
    'f7110000-0000-4000-8000-000000000201',
    'f7110000-0000-4000-8000-000000000301'
  );
  IF v_result <> 'f7110000-0000-4000-8000-000000000301' OR EXISTS (
    SELECT 1 FROM public.products WHERE id = 'f7110000-0000-4000-8000-000000000301'
  ) THEN
    RAISE EXCEPTION 'An unused workspace product was not deleted';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.delete_workspace_product_if_unused(
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000302'
    );
  EXCEPTION WHEN SQLSTATE '23503' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM public.products WHERE id = 'f7110000-0000-4000-8000-000000000302'
  ) THEN
    RAISE EXCEPTION 'A product referenced by an offer was not retained';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.delete_workspace_product_if_unused(
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000303'
    );
  EXCEPTION WHEN SQLSTATE '23503' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM public.products WHERE id = 'f7110000-0000-4000-8000-000000000303'
  ) THEN
    RAISE EXCEPTION 'A product snapshot referenced by an order was not retained';
  END IF;

  v_result := public.delete_commercial_offer_if_unused(
    'f7110000-0000-4000-8000-000000000201',
    'f7110000-0000-4000-8000-000000000401'
  );
  IF v_result <> 'f7110000-0000-4000-8000-000000000401' OR EXISTS (
    SELECT 1 FROM public.workspace_offers WHERE id = 'f7110000-0000-4000-8000-000000000401'
  ) THEN
    RAISE EXCEPTION 'An unused workspace offer was not deleted';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.delete_commercial_offer_if_unused(
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000403'
    );
  EXCEPTION WHEN SQLSTATE '23503' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM public.workspace_offers WHERE id = 'f7110000-0000-4000-8000-000000000403'
  ) THEN
    RAISE EXCEPTION 'An offer linked to a lead and order was not retained';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.delete_workspace_product_if_unused(
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000304'
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM public.products WHERE id = 'f7110000-0000-4000-8000-000000000304'
  ) THEN
    RAISE EXCEPTION 'Cross-workspace product deletion was not denied';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.delete_commercial_offer_if_unused(
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000404'
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM public.workspace_offers WHERE id = 'f7110000-0000-4000-8000-000000000404'
  ) THEN
    RAISE EXCEPTION 'Cross-workspace offer deletion was not denied';
  END IF;
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f7110000-0000-4000-8000-000000000101', TRUE);

DO $$
DECLARE
  v_rejected BOOLEAN := FALSE;
  v_deleted_count INTEGER;
  v_result TEXT;
  v_order_status TEXT;
BEGIN
  BEGIN
    DELETE FROM public.leads
    WHERE id = 'f7110000-0000-4000-8000-000000000502'
      AND workspace_id = 'f7110000-0000-4000-8000-000000000201';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected OR NOT EXISTS (
    SELECT 1 FROM public.leads WHERE id = 'f7110000-0000-4000-8000-000000000502'
  ) THEN
    RAISE EXCEPTION 'Browser clients must use the guarded lead-removal operation';
  END IF;

  v_result := public.remove_workspace_lead(
    'f7110000-0000-4000-8000-000000000201',
    'f7110000-0000-4000-8000-000000000502'
  );
  SELECT status INTO v_order_status FROM public.workspace_orders
  WHERE id = 'f7110000-0000-4000-8000-000000000601';
  IF v_result <> 'hidden'
     OR NOT EXISTS (
       SELECT 1 FROM public.leads
       WHERE id = 'f7110000-0000-4000-8000-000000000502'
         AND deleted_at IS NOT NULL AND lead_status = 'New'
     )
     OR v_order_status <> 'draft'
     OR NOT EXISTS (
       SELECT 1 FROM public.workspace_orders
       WHERE id = 'f7110000-0000-4000-8000-000000000601'
         AND lead_id = 'f7110000-0000-4000-8000-000000000502'
         AND product_name_snapshot = 'Product snapshot on order'
         AND total_amount_minor = 14000
     ) THEN
    RAISE EXCEPTION 'Removing a lead with an order must preserve the hidden lead and order history';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = 'f7110000-0000-4000-8000-000000000502' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Soft-deleted leads must not appear in active queries';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = 'f7110000-0000-4000-8000-000000000502' AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Workspace administrators must be able to find hidden leads for recovery';
  END IF;
  IF public.can_read_workspace_order(
    'f7110000-0000-4000-8000-000000000202',
    'f7110000-0000-4000-8000-000000000503'
  ) OR public.can_read_workspace_order(
    'f7110000-0000-4000-8000-000000000201',
    'f7110000-0000-4000-8000-000000000503'
  ) THEN
    RAISE EXCEPTION 'The order visibility helper must not cross workspace boundaries';
  END IF;

  v_result := public.remove_workspace_lead(
    'f7110000-0000-4000-8000-000000000201',
    'f7110000-0000-4000-8000-000000000501'
  );
  SELECT count(*) INTO v_deleted_count FROM public.leads
  WHERE id = 'f7110000-0000-4000-8000-000000000501';
  IF v_result <> 'deleted' OR v_deleted_count <> 0 THEN
    RAISE EXCEPTION 'An unused lead must retain physical-delete behavior';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.remove_workspace_lead(
      'f7110000-0000-4000-8000-000000000202',
      'f7110000-0000-4000-8000-000000000503'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A lead from another workspace must not be removed';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.remove_workspace_lead(
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000503'
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A lead ID must not be usable against a different active workspace';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'f7110000-0000-4000-8000-000000000102', TRUE);
DO $$
DECLARE
  v_denied BOOLEAN := FALSE;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = 'f7110000-0000-4000-8000-000000000502' AND deleted_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'A non-admin workspace member must not read hidden leads';
  END IF;
  BEGIN
    PERFORM public.restore_workspace_lead(
      'f7110000-0000-4000-8000-000000000201',
      'f7110000-0000-4000-8000-000000000502'
    );
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_denied := TRUE;
  END;
  IF NOT v_denied THEN
    RAISE EXCEPTION 'A non-admin member must not restore hidden leads';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_orders
    WHERE id = 'f7110000-0000-4000-8000-000000000601'
      AND lead_id = 'f7110000-0000-4000-8000-000000000502' AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'An authorized operator must keep access to the linked order after lead hiding';
  END IF;
END;
$$;

SELECT set_config('request.jwt.claim.sub', 'f7110000-0000-4000-8000-000000000101', TRUE);
DO $$
BEGIN
  PERFORM public.restore_workspace_lead(
    'f7110000-0000-4000-8000-000000000201',
    'f7110000-0000-4000-8000-000000000502'
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = 'f7110000-0000-4000-8000-000000000502' AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'A workspace administrator must be able to restore a hidden lead';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_orders
    WHERE id = 'f7110000-0000-4000-8000-000000000601'
      AND lead_id = 'f7110000-0000-4000-8000-000000000502' AND status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Restoring a lead must not change its order';
  END IF;
END;
$$;

RESET ROLE;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE id = 'f7110000-0000-4000-8000-000000000503'
      AND workspace_id = 'f7110000-0000-4000-8000-000000000202'
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Cross-workspace lead removal changed the foreign record';
  END IF;
END;
$$;
ROLLBACK;
