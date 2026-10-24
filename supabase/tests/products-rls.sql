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
      AND p.proname IN (
        'create_product',
        'update_product',
        'create_product_with_shipping_dimensions',
        'update_product_with_shipping_dimensions'
      )
      AND p.prosecdef
  ) THEN
    RAISE EXCEPTION 'Product write functions must remain SECURITY INVOKER';
  END IF;

  IF has_function_privilege(
       'anon',
       'public.create_product_with_shipping_dimensions(uuid,text,text,bigint,text,integer,integer,integer,integer,text,boolean,bigint)',
       'EXECUTE'
     ) OR has_function_privilege(
       'anon',
       'public.update_product_with_shipping_dimensions(uuid,text,text,bigint,text,integer,integer,integer,integer,text,boolean,boolean,bigint)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'authenticated',
       'public.create_product_with_shipping_dimensions(uuid,text,text,bigint,text,integer,integer,integer,integer,text,boolean,bigint)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'authenticated',
       'public.update_product_with_shipping_dimensions(uuid,text,text,bigint,text,integer,integer,integer,integer,text,boolean,boolean,bigint)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Shipping dimension writes must use the authenticated product RLS policies';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.products'::regclass
      AND attname IN ('length_mm', 'width_mm', 'height_mm')
      AND NOT attisdropped
  ) <> 3 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'public.products'::regclass
      AND attname IN ('length_mm', 'width_mm', 'height_mm')
      AND NOT attisdropped
      AND attnotnull
  ) THEN
    RAISE EXCEPTION 'Product shipping dimensions must remain optional for existing records';
  END IF;
END;
$$;
