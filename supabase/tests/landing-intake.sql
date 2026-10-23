-- Run only against a disposable local Supabase database after the intake migration.
-- All fixture data is rolled back.
BEGIN;

DO $$
DECLARE
  v_workspace UUID := public.main_workspace_id();
  v_other_workspace UUID := gen_random_uuid();
  v_offer UUID := gen_random_uuid();
  v_product UUID := gen_random_uuid();
  v_other_offer UUID := gen_random_uuid();
  v_other_product UUID := gen_random_uuid();
  v_form UUID := gen_random_uuid();
  v_table REGCLASS;
  v_public_id UUID := gen_random_uuid();
  v_ip_hash TEXT := repeat('a', 64);
  v_key TEXT := repeat('b', 64);
  v_result TEXT;
  v_rows INTEGER;
  i INTEGER;
  v_rls BOOLEAN;
BEGIN
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'A main workspace is required';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'public.leads'::regclass,
    'public.landing_form_integrations'::regclass,
    'public.landing_intake_requests'::regclass,
    'public.landing_intake_rate_limits'::regclass
  ] LOOP
    SELECT relrowsecurity INTO v_rls
    FROM pg_catalog.pg_class WHERE oid = v_table;
    IF NOT COALESCE(v_rls, FALSE) THEN
      RAISE EXCEPTION 'RLS must be enabled for %', v_table::TEXT;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.landing_form_integrations', 'SELECT')
     OR has_table_privilege('authenticated', 'public.landing_form_integrations', 'SELECT') THEN
    RAISE EXCEPTION 'Landing integration rows must not be directly readable by anon or authenticated';
  END IF;

  IF has_table_privilege('anon', 'public.leads', 'INSERT') THEN
    RAISE EXCEPTION 'anon must not have a direct INSERT table privilege on public.leads';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies AS p
    WHERE p.schemaname = 'public'
      AND p.tablename = 'leads'
      AND p.cmd IN ('INSERT', 'ALL')
      AND (p.roles @> ARRAY['anon']::name[] OR p.roles @> ARRAY['public']::name[])
  ) THEN
    RAISE EXCEPTION 'RLS must not define an anon or PUBLIC INSERT policy on public.leads';
  END IF;

  IF has_function_privilege('anon', 'public.create_public_landing_lead(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute create_public_landing_lead';
  END IF;
  IF has_function_privilege('authenticated', 'public.create_public_landing_lead(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must not execute create_public_landing_lead';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.create_public_landing_lead(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute create_public_landing_lead';
  END IF;
  IF has_function_privilege('anon', 'public.consume_landing_intake_ip_limit(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'anon must not execute consume_landing_intake_ip_limit';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.consume_landing_intake_ip_limit(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role must execute consume_landing_intake_ip_limit';
  END IF;

  INSERT INTO public.products (id, workspace_id, name, sale_price_minor)
  VALUES (v_product, v_workspace, 'Landing intake test product', 10000);
  INSERT INTO public.workspace_offers (
    id, workspace_id, name, product_id, offer_price_minor, is_active
  ) VALUES (
    v_offer, v_workspace, 'Landing intake test offer', v_product, 9000, TRUE
  );
  INSERT INTO public.landing_form_integrations (
    id, workspace_id, offer_id, public_id, allowed_origin, is_active
  ) VALUES (
    v_form, v_workspace, v_offer, v_public_id, 'https://shop.example.test', TRUE
  );

  INSERT INTO public.workspaces (id, name, slug)
  VALUES (v_other_workspace, 'Landing intake isolation fixture', 'landing-intake-' || v_other_workspace::TEXT);
  INSERT INTO public.products (id, workspace_id, name, sale_price_minor)
  VALUES (v_other_product, v_other_workspace, 'Foreign intake test product', 10000);
  INSERT INTO public.workspace_offers (
    id, workspace_id, name, product_id, offer_price_minor, is_active
  ) VALUES (
    v_other_offer, v_other_workspace, 'Foreign intake test offer', v_other_product, 9000, TRUE
  );
  BEGIN
    INSERT INTO public.landing_form_integrations (
      workspace_id, offer_id, public_id, allowed_origin
    ) VALUES (
      v_workspace, v_other_offer, gen_random_uuid(), 'https://shop.example.test'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rows := -1;
  END;
  IF v_rows IS DISTINCT FROM -1 THEN
    RAISE EXCEPTION 'Landing form configuration must not link an offer from another workspace';
  END IF;

  v_result := public.create_public_landing_lead(
    v_public_id, v_key, v_ip_hash, 'https://shop.example.test',
    'Test buyer', '0501234567', '+380501234567', NULL,
    'tiktok', 'paid', 'campaign-a', NULL, NULL, 'click-1', 'sub-1',
    'warehouse', 'city-ref', 'Kyiv', 'warehouse-ref', 'Branch 1'
  );
  IF v_result <> 'accepted' THEN RAISE EXCEPTION 'Expected accepted intake result, got %', v_result; END IF;

  -- A replay returns the same minimal result and creates no second lead.
  v_result := public.create_public_landing_lead(
    v_public_id, v_key, v_ip_hash, 'https://shop.example.test',
    'Test buyer', '0501234567', '+380501234567', NULL,
    'tiktok', 'paid', 'campaign-a', NULL, NULL, 'click-1', 'sub-1',
    'warehouse', 'city-ref', 'Kyiv', 'warehouse-ref', 'Branch 1'
  );
  SELECT count(*) INTO v_rows FROM public.leads
  WHERE workspace_id = v_workspace AND offer_id = v_offer AND created_via = 'landing';
  IF v_result <> 'accepted' OR v_rows <> 1 THEN
    RAISE EXCEPTION 'Idempotency replay must not create another lead';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads
    WHERE workspace_id = v_workspace AND offer_id = v_offer
      AND lead_status = 'New' AND user_id IS NULL AND created_by_user_id IS NULL
      AND phone_normalized = '+380501234567' AND delivery_city_ref = 'city-ref'
  ) THEN
    RAISE EXCEPTION 'Landing lead must keep server-derived scope, null author, normalized phone, and delivery refs';
  END IF;

  -- A single IP/form may submit at most five distinct requests per minute.
  FOR i IN 1..5 LOOP
    v_result := public.create_public_landing_lead(
      v_public_id, lpad(to_hex(i), 64, '0'), v_ip_hash, 'https://shop.example.test',
      'Test buyer ' || i, '0501234567', '+380501234567', NULL,
      NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL
    );
  END LOOP;
  IF v_result <> 'rate_limited' THEN
    RAISE EXCEPTION 'Sixth distinct form submission in a minute must be rate limited';
  END IF;

  UPDATE public.landing_form_integrations SET is_active = FALSE WHERE id = v_form;
  v_result := public.create_public_landing_lead(
    v_public_id, repeat('c', 64), repeat('d', 64), 'https://shop.example.test',
    'Test buyer', '0501234567', '+380501234567', NULL,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL
  );
  IF v_result <> 'unavailable' THEN
    RAISE EXCEPTION 'Inactive form must be unavailable';
  END IF;

  IF public.is_landing_form_origin_allowed(v_public_id, 'https://evil.example.test') THEN
    RAISE EXCEPTION 'An origin outside the saved allowlist must not pass CORS checks';
  END IF;
END;
$$;

ROLLBACK;
