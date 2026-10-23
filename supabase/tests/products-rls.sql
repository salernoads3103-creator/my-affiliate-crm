-- Run against a disposable local database after applying the Products MVP migration.
-- This checks the authorization structure without touching shared or production data.
DO $$
DECLARE
  v_products_rls BOOLEAN;
  v_costs_rls BOOLEAN;
BEGIN
  SELECT relrowsecurity INTO v_products_rls
  FROM pg_catalog.pg_class
  WHERE oid = 'public.products'::regclass;
  SELECT relrowsecurity INTO v_costs_rls
  FROM pg_catalog.pg_class
  WHERE oid = 'public.product_costs'::regclass;

  IF NOT COALESCE(v_products_rls, FALSE) OR NOT COALESCE(v_costs_rls, FALSE) THEN
    RAISE EXCEPTION 'RLS must be enabled for products and product_costs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_permission_catalog
    WHERE permission_key = 'products.read'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.workspace_permission_catalog
    WHERE permission_key = 'products.manage'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.workspace_permission_catalog
    WHERE permission_key = 'products.cost.read'
  ) THEN
    RAISE EXCEPTION 'Product permissions are missing from the permission catalog';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'products'
      AND policyname = 'products_read_authorized'
      AND qual LIKE '%products.read%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'product_costs'
      AND policyname = 'product_costs_read_authorized'
      AND qual LIKE '%products.cost.read%'
  ) THEN
    RAISE EXCEPTION 'Product reads must be checked by their permission policies';
  END IF;

  IF has_table_privilege('authenticated', 'public.products', 'DELETE')
     OR has_table_privilege('authenticated', 'public.product_costs', 'DELETE') THEN
    RAISE EXCEPTION 'Authenticated users must not hard-delete products or costs';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('create_product', 'update_product')
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Product write functions must remain SECURITY INVOKER';
  END IF;
END;
$$;
