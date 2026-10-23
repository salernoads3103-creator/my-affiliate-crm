-- Run only against a disposable local Supabase database after the Offers MVP
-- migration. Fixture writes run in a transaction and are rolled back.
BEGIN;

DO $$
DECLARE
  v_rls_enabled BOOLEAN;
  v_fk_definition TEXT;
  v_main_workspace UUID := public.main_workspace_id();
  v_foreign_workspace UUID := gen_random_uuid();
  v_foreign_product UUID := gen_random_uuid();
  v_rejected BOOLEAN := FALSE;
BEGIN
  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class
  WHERE oid = 'public.workspace_offers'::regclass;

  IF NOT COALESCE(v_rls_enabled, FALSE) THEN
    RAISE EXCEPTION 'RLS must remain enabled for workspace_offers';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid)
  INTO v_fk_definition
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.workspace_offers'::regclass
    AND c.conname = 'workspace_offers_workspace_product_fk'
    AND c.contype = 'f'
    AND c.convalidated;

  IF v_fk_definition IS NULL
     OR v_fk_definition NOT LIKE '%(workspace_id, product_id)%'
     OR v_fk_definition NOT LIKE '%products(workspace_id, id)%' THEN
    RAISE EXCEPTION 'Offer product relation must enforce matching workspace IDs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_offers'
      AND policyname = 'offers_read_authorized'
      AND qual LIKE '%offers.read%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_offers'
      AND policyname = 'offers_update_authorized'
      AND qual LIKE '%offers.manage%'
      AND with_check LIKE '%offers.manage%'
  ) THEN
    RAISE EXCEPTION 'Existing offer permission scopes must remain active';
  END IF;

  IF has_function_privilege('anon', 'public.get_workspace_offer_catalog(uuid,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.create_commercial_offer(uuid,text,uuid,bigint,text,boolean)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.update_commercial_offer(uuid,uuid,text,uuid,bigint,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Offer catalog and write RPCs must not be executable by anon';
  END IF;

  IF v_main_workspace IS NULL THEN
    RAISE EXCEPTION 'A main workspace is required for the workspace-boundary test';
  END IF;

  INSERT INTO public.workspaces (id, name, slug)
  VALUES (v_foreign_workspace, 'Offers RLS fixture', 'offers-rls-' || v_foreign_workspace::TEXT);
  INSERT INTO public.products (id, workspace_id, name, sale_price_minor)
  VALUES (v_foreign_product, v_foreign_workspace, 'Foreign workspace fixture', 10000);

  BEGIN
    INSERT INTO public.workspace_offers (
      workspace_id, name, product_id, offer_price_minor
    ) VALUES (
      v_main_workspace, 'Cross-workspace offer fixture ' || gen_random_uuid()::TEXT,
      v_foreign_product, 9000
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := TRUE;
  END;

  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An offer must not reference a product from another workspace';
  END IF;
END;
$$;

ROLLBACK;
