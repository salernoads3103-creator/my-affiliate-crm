-- Products MVP: workspace-scoped catalog with financial costs isolated behind
-- a separate permission-protected table. Apply only after review on a local DB.

BEGIN;

INSERT INTO public.workspace_permission_catalog (permission_key, description) VALUES
  ('products.read', 'View workspace products'),
  ('products.manage', 'Create and update workspace products'),
  ('products.cost.read', 'View product cost prices')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  sku TEXT CHECK (sku IS NULL OR char_length(sku) <= 100),
  sale_price_minor BIGINT NOT NULL CHECK (sale_price_minor BETWEEN 1 AND 99999999999),
  currency TEXT NOT NULL DEFAULT 'UAH' CHECK (currency = 'UAH'),
  photo_url TEXT CHECK (photo_url IS NULL OR char_length(photo_url) <= 2048),
  weight_grams INTEGER CHECK (weight_grams IS NULL OR weight_grams > 0),
  supplier_name TEXT CHECK (supplier_name IS NULL OR char_length(supplier_name) <= 200),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

-- Cost prices are isolated so users without the financial permission cannot
-- read them through the Supabase client, even if they bypass the application API.
CREATE TABLE public.product_costs (
  product_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  cost_price_minor BIGINT CHECK (cost_price_minor IS NULL OR cost_price_minor BETWEEN 0 AND 99999999999),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.products(workspace_id, id) ON DELETE CASCADE
);

CREATE INDEX products_workspace_created_idx ON public.products(workspace_id, created_at DESC);
CREATE INDEX products_workspace_name_idx ON public.products(workspace_id, lower(name));
CREATE INDEX products_workspace_sku_idx ON public.products(workspace_id, sku)
  WHERE sku IS NOT NULL;
CREATE INDEX product_costs_workspace_idx ON public.product_costs(workspace_id, product_id);

CREATE TRIGGER products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER product_costs_updated_at
  BEFORE UPDATE ON public.product_costs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY products_read_authorized
  ON public.products FOR SELECT TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'products.read', NULL, NULL, NULL));

CREATE POLICY products_insert_authorized
  ON public.products FOR INSERT TO authenticated
  WITH CHECK (public.has_workspace_permission(workspace_id, 'products.manage', NULL, NULL, NULL));

CREATE POLICY products_update_authorized
  ON public.products FOR UPDATE TO authenticated
  USING (public.has_workspace_permission(workspace_id, 'products.manage', NULL, NULL, NULL))
  WITH CHECK (public.has_workspace_permission(workspace_id, 'products.manage', NULL, NULL, NULL));

CREATE POLICY product_costs_read_authorized
  ON public.product_costs FOR SELECT TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'products.read', NULL, NULL, NULL)
    AND public.has_workspace_permission(workspace_id, 'products.cost.read', NULL, NULL, NULL)
  );

CREATE POLICY product_costs_insert_authorized
  ON public.product_costs FOR INSERT TO authenticated
  WITH CHECK (
    public.has_workspace_permission(workspace_id, 'products.read', NULL, NULL, NULL)
    AND public.has_workspace_permission(workspace_id, 'products.manage', NULL, NULL, NULL)
    AND public.has_workspace_permission(workspace_id, 'products.cost.read', NULL, NULL, NULL)
  );

CREATE POLICY product_costs_update_authorized
  ON public.product_costs FOR UPDATE TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'products.read', NULL, NULL, NULL)
    AND public.has_workspace_permission(workspace_id, 'products.manage', NULL, NULL, NULL)
    AND public.has_workspace_permission(workspace_id, 'products.cost.read', NULL, NULL, NULL)
  )
  WITH CHECK (
    public.has_workspace_permission(workspace_id, 'products.read', NULL, NULL, NULL)
    AND public.has_workspace_permission(workspace_id, 'products.manage', NULL, NULL, NULL)
    AND public.has_workspace_permission(workspace_id, 'products.cost.read', NULL, NULL, NULL)
  );

REVOKE ALL ON TABLE public.products, public.product_costs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.products TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.product_costs TO authenticated;

-- Invoker functions keep RLS active and make the product/cost write one atomic
-- database statement. The API derives p_update_cost from the caller's request;
-- the financial table's own policy remains the final authorization boundary.
CREATE FUNCTION public.create_product(
  p_workspace_id UUID,
  p_name TEXT,
  p_sku TEXT,
  p_sale_price_minor BIGINT,
  p_photo_url TEXT,
  p_weight_grams INTEGER,
  p_supplier_name TEXT,
  p_is_active BOOLEAN,
  p_cost_price_minor BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_product_id UUID;
BEGIN
  INSERT INTO public.products (
    workspace_id, name, sku, sale_price_minor, photo_url,
    weight_grams, supplier_name, is_active
  ) VALUES (
    p_workspace_id, p_name, p_sku, p_sale_price_minor, p_photo_url,
    p_weight_grams, p_supplier_name, p_is_active
  )
  RETURNING id INTO v_product_id;

  IF p_cost_price_minor IS NOT NULL THEN
    INSERT INTO public.product_costs (product_id, workspace_id, cost_price_minor)
    VALUES (v_product_id, p_workspace_id, p_cost_price_minor);
  END IF;

  RETURN v_product_id;
END;
$$;

CREATE FUNCTION public.update_product(
  p_product_id UUID,
  p_name TEXT,
  p_sku TEXT,
  p_sale_price_minor BIGINT,
  p_photo_url TEXT,
  p_weight_grams INTEGER,
  p_supplier_name TEXT,
  p_is_active BOOLEAN,
  p_update_cost BOOLEAN,
  p_cost_price_minor BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
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

REVOKE ALL ON FUNCTION public.create_product(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, TEXT, BOOLEAN, BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_product(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, TEXT, BOOLEAN, BOOLEAN, BIGINT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_product(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, TEXT, BOOLEAN, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_product(UUID, TEXT, TEXT, BIGINT, TEXT, INTEGER, TEXT, BOOLEAN, BOOLEAN, BIGINT)
  TO authenticated;

COMMENT ON TABLE public.products IS
  'Workspace-scoped MVP product catalog. Prices use integer minor units in UAH.';
COMMENT ON COLUMN public.products.sale_price_minor IS
  'Sale price in kopiykas (integer minor units); currency is fixed to UAH for MVP.';
COMMENT ON TABLE public.product_costs IS
  'Financial cost prices, isolated from product reads by the products.cost.read permission.';

COMMIT;
