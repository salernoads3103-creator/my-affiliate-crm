-- Offers MVP extends the RBAC-backed workspace_offers table in place.
-- Existing offer IDs, names, and lead links remain valid; legacy rows keep
-- nullable product and offer-price fields until they are upgraded in the UI.
BEGIN;

ALTER TABLE public.workspace_offers
  ADD COLUMN product_id UUID,
  ADD COLUMN offer_price_minor BIGINT,
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'UAH',
  ADD COLUMN landing_url TEXT,
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD CONSTRAINT workspace_offers_price_positive
    CHECK (offer_price_minor IS NULL OR offer_price_minor BETWEEN 1 AND 99999999999),
  ADD CONSTRAINT workspace_offers_currency_uah
    CHECK (currency = 'UAH'),
  ADD CONSTRAINT workspace_offers_landing_url_length
    CHECK (landing_url IS NULL OR char_length(landing_url) <= 2048),
  ADD CONSTRAINT workspace_offers_workspace_product_fk
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.products(workspace_id, id) ON DELETE RESTRICT;

CREATE INDEX workspace_offers_workspace_product_idx
  ON public.workspace_offers(workspace_id, product_id)
  WHERE product_id IS NOT NULL;
CREATE INDEX workspace_offers_workspace_active_idx
  ON public.workspace_offers(workspace_id, is_active, created_at DESC);

CREATE TRIGGER workspace_offers_updated_at
  BEFORE UPDATE ON public.workspace_offers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.get_workspace_offer_catalog(
  p_workspace_id UUID,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  name TEXT,
  product_id UUID,
  offer_price_minor BIGINT,
  currency TEXT,
  landing_url TEXT,
  is_active BOOLEAN,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  product_name TEXT,
  product_sku TEXT,
  product_photo_url TEXT,
  product_sale_price_minor BIGINT,
  product_currency TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'products.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    o.id,
    o.workspace_id,
    o.name,
    o.product_id,
    o.offer_price_minor,
    o.currency,
    o.landing_url,
    o.is_active,
    o.created_at,
    o.updated_at,
    p.name,
    p.sku,
    p.photo_url,
    p.sale_price_minor,
    p.currency
  FROM public.workspace_offers AS o
  LEFT JOIN public.products AS p
    ON p.workspace_id = o.workspace_id
   AND p.id = o.product_id
  WHERE o.workspace_id = p_workspace_id
    AND public.has_workspace_permission(
      p_workspace_id, 'offers.read', NULL, NULL, o.id
    )
    AND (
      NULLIF(btrim(p_search), '') IS NULL
      OR o.name ILIKE '%' || left(btrim(p_search), 120) || '%'
      OR COALESCE(p.name, '') ILIKE '%' || left(btrim(p_search), 120) || '%'
      OR COALESCE(p.sku, '') ILIKE '%' || left(btrim(p_search), 120) || '%'
    )
  ORDER BY o.created_at DESC, o.name;
END;
$$;

CREATE FUNCTION public.create_commercial_offer(
  p_workspace_id UUID,
  p_name TEXT,
  p_product_id UUID,
  p_offer_price_minor BIGINT,
  p_landing_url TEXT,
  p_is_active BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, NULL
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'products.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120
     OR p_product_id IS NULL
     OR p_offer_price_minor IS NULL
     OR p_offer_price_minor NOT BETWEEN 1 AND 99999999999
     OR p_landing_url IS NOT NULL AND char_length(p_landing_url) > 2048
     OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Invalid offer data' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.id = p_product_id AND p.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Product not found in workspace' USING ERRCODE = '23503';
  END IF;

  INSERT INTO public.workspace_offers (
    workspace_id, name, product_id, offer_price_minor,
    currency, landing_url, is_active
  ) VALUES (
    p_workspace_id, btrim(p_name), p_product_id, p_offer_price_minor,
    'UAH', NULLIF(btrim(p_landing_url), ''), p_is_active
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION public.update_commercial_offer(
  p_workspace_id UUID,
  p_offer_id UUID,
  p_name TEXT,
  p_product_id UUID,
  p_offer_price_minor BIGINT,
  p_landing_url TEXT,
  p_is_active BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, p_offer_id
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'products.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120
     OR p_product_id IS NULL
     OR p_offer_price_minor IS NULL
     OR p_offer_price_minor NOT BETWEEN 1 AND 99999999999
     OR p_landing_url IS NOT NULL AND char_length(p_landing_url) > 2048
     OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Invalid offer data' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.products AS p
    WHERE p.id = p_product_id AND p.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Product not found in workspace' USING ERRCODE = '23503';
  END IF;

  UPDATE public.workspace_offers AS o
  SET name = btrim(p_name),
      product_id = p_product_id,
      offer_price_minor = p_offer_price_minor,
      currency = 'UAH',
      landing_url = NULLIF(btrim(p_landing_url), ''),
      is_active = p_is_active
  WHERE o.id = p_offer_id AND o.workspace_id = p_workspace_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_offer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_offer_catalog(UUID, TEXT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_commercial_offer(UUID, TEXT, UUID, BIGINT, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_commercial_offer(UUID, UUID, TEXT, UUID, BIGINT, TEXT, BOOLEAN)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_offer_catalog(UUID, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_commercial_offer(UUID, TEXT, UUID, BIGINT, TEXT, BOOLEAN)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_commercial_offer(UUID, UUID, TEXT, UUID, BIGINT, TEXT, BOOLEAN)
  TO authenticated;

COMMENT ON COLUMN public.workspace_offers.offer_price_minor IS
  'Offer price in integer kopiykas; nullable for legacy workspace offers until upgraded.';
COMMENT ON COLUMN public.workspace_offers.product_id IS
  'Workspace-scoped catalog product; nullable for legacy workspace offers.';

COMMIT;
