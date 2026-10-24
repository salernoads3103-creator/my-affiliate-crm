-- Add product parcel dimensions and immutable-at-creation shipping snapshots.
-- Existing orders intentionally remain NULL: current catalog data cannot
-- reliably reconstruct the package details that existed when old orders were made.
BEGIN;

ALTER TABLE public.products
  ADD COLUMN length_mm INTEGER CHECK (length_mm IS NULL OR length_mm > 0),
  ADD COLUMN width_mm INTEGER CHECK (width_mm IS NULL OR width_mm > 0),
  ADD COLUMN height_mm INTEGER CHECK (height_mm IS NULL OR height_mm > 0);

ALTER TABLE public.workspace_orders
  ADD COLUMN product_weight_grams_snapshot INTEGER
    CHECK (product_weight_grams_snapshot IS NULL OR product_weight_grams_snapshot > 0),
  ADD COLUMN product_length_mm_snapshot INTEGER
    CHECK (product_length_mm_snapshot IS NULL OR product_length_mm_snapshot > 0),
  ADD COLUMN product_width_mm_snapshot INTEGER
    CHECK (product_width_mm_snapshot IS NULL OR product_width_mm_snapshot > 0),
  ADD COLUMN product_height_mm_snapshot INTEGER
    CHECK (product_height_mm_snapshot IS NULL OR product_height_mm_snapshot > 0);

CREATE FUNCTION public.create_product_with_shipping_dimensions(
  p_workspace_id UUID,
  p_name TEXT,
  p_sku TEXT,
  p_sale_price_minor BIGINT,
  p_photo_url TEXT,
  p_weight_grams INTEGER,
  p_length_mm INTEGER,
  p_width_mm INTEGER,
  p_height_mm INTEGER,
  p_supplier_name TEXT,
  p_is_active BOOLEAN,
  p_cost_price_minor BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  INSERT INTO public.products (
    workspace_id, name, sku, sale_price_minor, photo_url,
    weight_grams, length_mm, width_mm, height_mm, supplier_name, is_active
  ) VALUES (
    p_workspace_id, p_name, p_sku, p_sale_price_minor, p_photo_url,
    p_weight_grams, p_length_mm, p_width_mm, p_height_mm, p_supplier_name, p_is_active
  )
  RETURNING id INTO v_product_id;

  IF p_cost_price_minor IS NOT NULL THEN
    INSERT INTO public.product_costs (product_id, workspace_id, cost_price_minor)
    VALUES (v_product_id, p_workspace_id, p_cost_price_minor);
  END IF;

  RETURN v_product_id;
END;
$$;

CREATE FUNCTION public.update_product_with_shipping_dimensions(
  p_product_id UUID,
  p_name TEXT,
  p_sku TEXT,
  p_sale_price_minor BIGINT,
  p_photo_url TEXT,
  p_weight_grams INTEGER,
  p_length_mm INTEGER,
  p_width_mm INTEGER,
  p_height_mm INTEGER,
  p_supplier_name TEXT,
  p_is_active BOOLEAN,
  p_update_cost BOOLEAN,
  p_cost_price_minor BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_workspace_id UUID;
BEGIN
  UPDATE public.products
  SET name = p_name,
      sku = p_sku,
      sale_price_minor = p_sale_price_minor,
      photo_url = p_photo_url,
      weight_grams = p_weight_grams,
      length_mm = p_length_mm,
      width_mm = p_width_mm,
      height_mm = p_height_mm,
      supplier_name = p_supplier_name,
      is_active = p_is_active
  WHERE id = p_product_id
  RETURNING workspace_id INTO v_workspace_id;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  IF p_update_cost THEN
    INSERT INTO public.product_costs (product_id, workspace_id, cost_price_minor)
    VALUES (p_product_id, v_workspace_id, p_cost_price_minor)
    ON CONFLICT (product_id) DO UPDATE
      SET cost_price_minor = EXCLUDED.cost_price_minor;
  END IF;

  RETURN p_product_id;
END;
$$;

CREATE FUNCTION public.get_workspace_order_context_v2(
  p_workspace_id UUID,
  p_lead_id UUID
)
RETURNS TABLE (
  lead_id UUID,
  lead_name TEXT,
  buyer_phone TEXT,
  buyer_email TEXT,
  offer_id UUID,
  offer_name TEXT,
  offer_price_minor BIGINT,
  product_id UUID,
  product_name TEXT,
  product_sku TEXT,
  product_sale_price_minor BIGINT,
  product_weight_grams INTEGER,
  product_length_mm INTEGER,
  product_width_mm INTEGER,
  product_height_mm INTEGER
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'leads.read', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT lead.id, lead.name, lead.phone, lead.email,
    offer.id, offer.name, offer.offer_price_minor,
    product.id, product.name, product.sku, product.sale_price_minor,
    product.weight_grams, product.length_mm, product.width_mm, product.height_mm
  FROM public.leads AS lead
  LEFT JOIN public.workspace_offers AS offer
    ON offer.workspace_id = lead.workspace_id AND offer.id = lead.offer_id
  LEFT JOIN public.products AS product
    ON product.workspace_id = offer.workspace_id AND product.id = offer.product_id
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_workspace_order(
  p_workspace_id UUID,
  p_lead_id UUID,
  p_idempotency_key UUID,
  p_quantity INTEGER,
  p_unit_price_minor BIGINT,
  p_buyer_name TEXT,
  p_buyer_phone TEXT,
  p_buyer_email TEXT,
  p_operator_comment TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_offer public.workspace_offers%ROWTYPE;
  v_product public.products%ROWTYPE;
  v_order_id UUID;
  v_existing_lead_id UUID;
BEGIN
  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'leads.read', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NULL
     OR p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 9999
     OR p_unit_price_minor IS NULL OR p_unit_price_minor NOT BETWEEN 1 AND 99999999999
     OR p_buyer_name IS NULL OR char_length(btrim(p_buyer_name)) NOT BETWEEN 1 AND 120
     OR p_buyer_phone IS NULL OR p_buyer_phone !~ '^\+380[0-9]{9}$'
     OR p_buyer_email IS NOT NULL AND (
       char_length(p_buyer_email) > 255
       OR p_buyer_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
     )
     OR p_operator_comment IS NOT NULL AND char_length(p_operator_comment) > 2000 THEN
    RAISE EXCEPTION 'Invalid order data' USING ERRCODE = '22023';
  END IF;

  -- Idempotent retries return the original order and its original snapshots.
  SELECT order_row.id, order_row.lead_id
  INTO v_order_id, v_existing_lead_id
  FROM public.workspace_orders AS order_row
  WHERE order_row.workspace_id = p_workspace_id
    AND order_row.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_existing_lead_id IS DISTINCT FROM p_lead_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different lead' USING ERRCODE = '23505';
    END IF;
    RETURN v_order_id;
  END IF;

  IF v_lead.offer_id IS NULL THEN
    RAISE EXCEPTION 'Lead must have an offer before creating an order' USING ERRCODE = '22023';
  END IF;

  SELECT offer.* INTO v_offer
  FROM public.workspace_offers AS offer
  WHERE offer.workspace_id = p_workspace_id AND offer.id = v_lead.offer_id;
  SELECT product.* INTO v_product
  FROM public.products AS product
  WHERE product.workspace_id = p_workspace_id AND product.id = v_offer.product_id;
  IF v_offer.id IS NULL OR v_product.id IS NULL THEN
    RAISE EXCEPTION 'Lead offer must have a linked product' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.workspace_orders (
    workspace_id, lead_id, offer_id, product_id,
    offer_name_snapshot, product_name_snapshot, product_sku_snapshot,
    product_weight_grams_snapshot, product_length_mm_snapshot,
    product_width_mm_snapshot, product_height_mm_snapshot,
    quantity, unit_price_minor, currency,
    buyer_name, buyer_phone, buyer_email, operator_comment,
    idempotency_key, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_lead_id, v_offer.id, v_product.id,
    btrim(v_offer.name), btrim(v_product.name), v_product.sku,
    v_product.weight_grams, v_product.length_mm, v_product.width_mm, v_product.height_mm,
    p_quantity, p_unit_price_minor, 'UAH',
    btrim(p_buyer_name), p_buyer_phone, NULLIF(btrim(p_buyer_email), ''),
    NULLIF(btrim(p_operator_comment), ''),
    p_idempotency_key, auth.uid(), auth.uid()
  )
  ON CONFLICT (workspace_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_order_id;

  IF v_order_id IS NULL THEN
    SELECT order_row.id, order_row.lead_id
    INTO v_order_id, v_existing_lead_id
    FROM public.workspace_orders AS order_row
    WHERE order_row.workspace_id = p_workspace_id
      AND order_row.idempotency_key = p_idempotency_key;
    IF v_existing_lead_id IS DISTINCT FROM p_lead_id THEN
      RAISE EXCEPTION 'Idempotency key was already used for a different lead' USING ERRCODE = '23505';
    END IF;
  END IF;

  RETURN v_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_product_with_shipping_dimensions(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN, BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_product_with_shipping_dimensions(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN, BOOLEAN, BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_workspace_order_context_v2(UUID, UUID)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product_with_shipping_dimensions(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product_with_shipping_dimensions(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, TEXT, BOOLEAN, BOOLEAN, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_order_context_v2(UUID, UUID)
  TO authenticated;

COMMENT ON COLUMN public.products.length_mm IS
  'Optional product parcel length in millimeters; copied into new order snapshots at creation.';
COMMENT ON COLUMN public.products.width_mm IS
  'Optional product parcel width in millimeters; copied into new order snapshots at creation.';
COMMENT ON COLUMN public.products.height_mm IS
  'Optional product parcel height in millimeters; copied into new order snapshots at creation.';
COMMENT ON COLUMN public.workspace_orders.product_weight_grams_snapshot IS
  'Product weight copied at order creation; later catalog edits do not change this value.';
COMMENT ON COLUMN public.workspace_orders.product_length_mm_snapshot IS
  'Product length copied at order creation; later catalog edits do not change this value.';
COMMENT ON COLUMN public.workspace_orders.product_width_mm_snapshot IS
  'Product width copied at order creation; later catalog edits do not change this value.';
COMMENT ON COLUMN public.workspace_orders.product_height_mm_snapshot IS
  'Product height copied at order creation; later catalog edits do not change this value.';

COMMIT;
