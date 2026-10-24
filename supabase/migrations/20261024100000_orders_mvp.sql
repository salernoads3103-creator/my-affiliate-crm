-- Orders MVP: preserve lead, offer, and product data while recording an order
-- snapshot. Apply only after review against a disposable local Supabase DB.
BEGIN;

INSERT INTO public.workspace_permission_catalog (permission_key, description) VALUES
  ('orders.read', 'View orders in the granted lead scope'),
  ('orders.manage', 'Create, update drafts, and change order status in the granted lead scope')
ON CONFLICT (permission_key) DO NOTHING;

-- Operators work with orders only for leads already in their assigned scope.
-- Admins receive no elevated default access; access can be explicitly granted.
INSERT INTO public.workspace_role_permissions (role, permission_key, scope_type) VALUES
  ('operator', 'orders.read', 'operator'),
  ('operator', 'orders.manage', 'operator'),
  ('viewer', 'orders.read', 'operator')
ON CONFLICT (role, permission_key) DO NOTHING;

-- leads.id is already a primary key. This composite index lets order FKs also
-- enforce that the referenced lead belongs to the same workspace.
CREATE UNIQUE INDEX leads_workspace_id_id_uidx
  ON public.leads(workspace_id, id);

CREATE TABLE public.workspace_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  lead_id UUID NOT NULL,
  offer_id UUID NOT NULL,
  product_id UUID NOT NULL,
  offer_name_snapshot TEXT NOT NULL
    CHECK (char_length(btrim(offer_name_snapshot)) BETWEEN 1 AND 120),
  product_name_snapshot TEXT NOT NULL
    CHECK (char_length(btrim(product_name_snapshot)) BETWEEN 1 AND 200),
  product_sku_snapshot TEXT CHECK (
    product_sku_snapshot IS NULL OR char_length(product_sku_snapshot) <= 100
  ),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 9999),
  unit_price_minor BIGINT NOT NULL
    CHECK (unit_price_minor BETWEEN 1 AND 99999999999),
  total_amount_minor BIGINT GENERATED ALWAYS AS (quantity::BIGINT * unit_price_minor) STORED,
  currency TEXT NOT NULL DEFAULT 'UAH' CHECK (currency = 'UAH'),
  buyer_name TEXT NOT NULL CHECK (char_length(btrim(buyer_name)) BETWEEN 1 AND 120),
  buyer_phone TEXT NOT NULL CHECK (buyer_phone ~ '^\+380[0-9]{9}$'),
  buyer_email TEXT CHECK (buyer_email IS NULL OR char_length(buyer_email) <= 255),
  operator_comment TEXT CHECK (
    operator_comment IS NULL OR char_length(operator_comment) <= 2000
  ),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'confirmed', 'cancelled')),
  idempotency_key UUID NOT NULL,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_orders_workspace_lead_fkey
    FOREIGN KEY (workspace_id, lead_id)
    REFERENCES public.leads(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_orders_workspace_offer_fkey
    FOREIGN KEY (workspace_id, offer_id)
    REFERENCES public.workspace_offers(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_orders_workspace_product_fkey
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_orders_workspace_idempotency_key_key
    UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT workspace_orders_status_timestamps_check CHECK (
    (status <> 'confirmed' OR confirmed_at IS NOT NULL)
    AND (status <> 'cancelled' OR cancelled_at IS NOT NULL)
  )
);

CREATE INDEX workspace_orders_workspace_created_idx
  ON public.workspace_orders(workspace_id, created_at DESC);
CREATE INDEX workspace_orders_workspace_lead_idx
  ON public.workspace_orders(workspace_id, lead_id, created_at DESC);
CREATE INDEX workspace_orders_workspace_status_idx
  ON public.workspace_orders(workspace_id, status, created_at DESC);

CREATE TRIGGER workspace_orders_updated_at
  BEFORE UPDATE ON public.workspace_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_orders_read_authorized
  ON public.workspace_orders FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE lead.id = workspace_orders.lead_id
        AND lead.workspace_id = workspace_orders.workspace_id
        AND public.has_workspace_permission(
          lead.workspace_id, 'leads.read', lead.team_id, lead.operator_id, lead.offer_id
        )
        AND (
          public.has_workspace_permission(
            lead.workspace_id, 'orders.read', lead.team_id, lead.operator_id, lead.offer_id
          )
          OR public.has_workspace_permission(
            lead.workspace_id, 'orders.manage', lead.team_id, lead.operator_id, lead.offer_id
          )
        )
    )
  );

REVOKE ALL ON public.workspace_orders FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_orders TO authenticated;

CREATE FUNCTION public.get_workspace_order_context(
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
  product_sale_price_minor BIGINT
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
    product.id, product.name, product.sku, product.sale_price_minor
  FROM public.leads AS lead
  LEFT JOIN public.workspace_offers AS offer
    ON offer.workspace_id = lead.workspace_id AND offer.id = lead.offer_id
  LEFT JOIN public.products AS product
    ON product.workspace_id = offer.workspace_id AND product.id = offer.product_id
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id;
END;
$$;

CREATE FUNCTION public.create_workspace_order(
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

  -- Return the first successful result for a retry before consulting the
  -- current offer fields, which may have changed since the original request.
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
    quantity, unit_price_minor, currency,
    buyer_name, buyer_phone, buyer_email, operator_comment,
    idempotency_key, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_lead_id, v_offer.id, v_product.id,
    btrim(v_offer.name), btrim(v_product.name), v_product.sku,
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

CREATE FUNCTION public.update_workspace_order_draft(
  p_workspace_id UUID,
  p_order_id UUID,
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
  v_order public.workspace_orders%ROWTYPE;
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT order_row.* INTO v_order
  FROM public.workspace_orders AS order_row
  WHERE order_row.workspace_id = p_workspace_id AND order_row.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = v_order.workspace_id AND lead.id = v_order.lead_id;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'leads.read', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_order.status <> 'draft' THEN
    RAISE EXCEPTION 'Only draft orders can be edited' USING ERRCODE = '23514';
  END IF;
  IF p_quantity IS NULL OR p_quantity NOT BETWEEN 1 AND 9999
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

  UPDATE public.workspace_orders AS order_row
  SET quantity = p_quantity,
      unit_price_minor = p_unit_price_minor,
      buyer_name = btrim(p_buyer_name),
      buyer_phone = p_buyer_phone,
      buyer_email = NULLIF(btrim(p_buyer_email), ''),
      operator_comment = NULLIF(btrim(p_operator_comment), ''),
      updated_by_user_id = auth.uid()
  WHERE order_row.id = p_order_id AND order_row.workspace_id = p_workspace_id;
  RETURN p_order_id;
END;
$$;

CREATE FUNCTION public.transition_workspace_order(
  p_workspace_id UUID,
  p_order_id UUID,
  p_status TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.workspace_orders%ROWTYPE;
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT order_row.* INTO v_order
  FROM public.workspace_orders AS order_row
  WHERE order_row.workspace_id = p_workspace_id AND order_row.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = v_order.workspace_id AND lead.id = v_order.lead_id;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'leads.read', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('draft', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid order status' USING ERRCODE = '22023';
  END IF;
  IF p_status = v_order.status THEN
    RETURN p_order_id;
  END IF;
  IF NOT (
    (v_order.status = 'draft' AND p_status IN ('confirmed', 'cancelled'))
    OR (v_order.status = 'confirmed' AND p_status = 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Order status transition is not allowed' USING ERRCODE = '23514';
  END IF;

  UPDATE public.workspace_orders AS order_row
  SET status = p_status,
      confirmed_at = CASE WHEN p_status = 'confirmed' THEN now() ELSE confirmed_at END,
      cancelled_at = CASE WHEN p_status = 'cancelled' THEN now() ELSE cancelled_at END,
      updated_by_user_id = auth.uid()
  WHERE order_row.id = p_order_id AND order_row.workspace_id = p_workspace_id;
  RETURN p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_order_context(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_workspace_order(UUID, UUID, UUID, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_workspace_order_draft(UUID, UUID, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_workspace_order(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_order_context(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_order(UUID, UUID, UUID, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_workspace_order_draft(UUID, UUID, INTEGER, BIGINT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_workspace_order(UUID, UUID, TEXT) TO authenticated;

COMMENT ON TABLE public.workspace_orders IS
  'Workspace-scoped order records. Product, offer name, unit price, buyer contact, and total are captured as an order-time snapshot.';
COMMENT ON COLUMN public.workspace_orders.total_amount_minor IS
  'Generated total in integer kopiykas (quantity multiplied by the snapshotted unit price).';
COMMENT ON COLUMN public.workspace_orders.idempotency_key IS
  'Client-generated request key scoped to the workspace to prevent duplicate creation on retries.';

COMMIT;
