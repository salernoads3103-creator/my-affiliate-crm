-- Run only on a disposable local Supabase database after all migrations through
-- 20261025100000_landing_domains_publication_foundation.sql. This test rolls back.
BEGIN;

DO $$
DECLARE
  v_workspace_a UUID := 'e2510000-0000-4000-8000-000000000101';
  v_workspace_b UUID := 'e2510000-0000-4000-8000-000000000102';
  v_user_a UUID := 'a2510000-0000-4000-8000-000000000101';
  v_offer_a UUID := 'c2510000-0000-4000-8000-000000000101';
  v_offer_b UUID := 'c2510000-0000-4000-8000-000000000102';
  v_landing_a UUID := 'd2510000-0000-4000-8000-000000000101';
  v_landing_b UUID := 'd2510000-0000-4000-8000-000000000102';
  v_form_a UUID := 'f2510000-0000-4000-8000-000000000101';
  v_form_b UUID := 'f2510000-0000-4000-8000-000000000102';
  v_domain_a UUID := 'b2510000-0000-4000-8000-000000000101';
  v_domain_b UUID := 'b2510000-0000-4000-8000-000000000102';
  v_host_a UUID := 'b2510000-0000-4000-8000-000000000201';
  v_host_a_unpublished UUID := 'b2510000-0000-4000-8000-000000000202';
  v_host_b UUID := 'b2510000-0000-4000-8000-000000000301';
  v_version_a1 UUID := 'c2510000-0000-4000-8000-000000000201';
  v_version_a2 UUID := 'c2510000-0000-4000-8000-000000000202';
  v_version_b1 UUID := 'c2510000-0000-4000-8000-000000000301';
  v_membership_a UUID;
  v_accepted TEXT;
  v_rejected BOOLEAN;
  v_table TEXT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id = v_user_a
  ) OR EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id IN (v_workspace_a, v_workspace_b)
       OR slug IN ('landing-domains-test-a', 'landing-domains-test-b')
  ) THEN
    RAISE EXCEPTION 'Landing domains fixture collision; reset the disposable database';
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'workspace_domains',
    'workspace_domain_hosts',
    'landing_publication_versions',
    'landing_form_allowed_origins'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = ('public.' || v_table)::REGCLASS
        AND relation.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'RLS must be enabled on public.%', v_table;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = v_table
        AND policy.cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ) THEN
      RAISE EXCEPTION 'Browser mutation policies are forbidden on public.%', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_policies AS policy
      WHERE policy.schemaname = 'public'
        AND policy.tablename = v_table
        AND policy.cmd = 'SELECT'
        AND policy.roles @> ARRAY['authenticated']::NAME[]
        AND policy.qual LIKE '%has_workspace_permission%'
        AND policy.qual LIKE '%workspace_id%'
    ) THEN
      RAISE EXCEPTION 'Authorized workspace read policy is missing on public.%', v_table;
    END IF;
    IF has_table_privilege('anon', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('anon', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('anon', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('anon', 'public.' || v_table, 'DELETE')
       OR NOT has_table_privilege('authenticated', 'public.' || v_table, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'INSERT')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'UPDATE')
       OR has_table_privilege('authenticated', 'public.' || v_table, 'DELETE') THEN
      RAISE EXCEPTION 'Anonymous access or browser writes are available on public.%', v_table;
    END IF;
  END LOOP;

  IF has_table_privilege(
       'service_role', 'public.landing_publication_versions', 'UPDATE'
     ) OR has_table_privilege(
       'service_role', 'public.landing_publication_versions', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'Publication history must not be mutable, including by service-role table grants';
  END IF;

  IF has_function_privilege(
       'anon', 'public.reserve_workspace_domain_host(uuid,uuid,uuid)', 'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.reserve_workspace_domain_host(uuid,uuid,uuid)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role', 'public.reserve_workspace_domain_host(uuid,uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Host reservation must remain server-only';
  END IF;
  IF has_function_privilege(
       'anon', 'public.switch_landing_publication_version(uuid,uuid,uuid,uuid)', 'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.switch_landing_publication_version(uuid,uuid,uuid,uuid)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role', 'public.switch_landing_publication_version(uuid,uuid,uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Publication switch and rollback must remain server-only';
  END IF;
  IF has_function_privilege(
       'anon', 'public.create_public_landing_lead_with_click_ids(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
       'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.create_public_landing_lead_with_click_ids(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
       'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role', 'public.create_public_landing_lead_with_click_ids(uuid,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Public intake must retain service-role-only RPC execution';
  END IF;
  IF has_function_privilege(
       'anon', 'public.is_landing_origin_allowed(text)', 'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.is_landing_origin_allowed(text)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role', 'public.is_landing_origin_allowed(text)', 'EXECUTE'
     ) OR has_function_privilege(
       'anon', 'public.is_landing_form_origin_allowed(uuid,text)', 'EXECUTE'
     ) OR has_function_privilege(
       'authenticated', 'public.is_landing_form_origin_allowed(uuid,text)', 'EXECUTE'
     ) OR NOT has_function_privilege(
       'service_role', 'public.is_landing_form_origin_allowed(uuid,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Origin lookup RPCs must remain service-role-only';
  END IF;
  IF has_table_privilege('anon', 'public.leads', 'INSERT') THEN
    RAISE EXCEPTION 'Anonymous direct lead inserts must remain unavailable';
  END IF;

  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_user_a, 'authenticated', 'authenticated', 'landing-domains-a@example.invalid',
    '', now(), '{}'::JSONB, '{}'::JSONB, now(), now()
  );
  INSERT INTO public.workspaces (id, name, slug) VALUES
    (v_workspace_a, 'Landing domains test A', 'landing-domains-test-a'),
    (v_workspace_b, 'Landing domains test B', 'landing-domains-test-b');

  INSERT INTO public.workspace_memberships (workspace_id, user_id, role)
  VALUES (v_workspace_a, v_user_a, 'admin')
  RETURNING id INTO v_membership_a;
  INSERT INTO public.workspace_member_permissions (
    membership_id, workspace_id, permission_key, allowed, scope_type,
    scope_id, delegable, authority, granted_by
  ) VALUES (
    v_membership_a, v_workspace_a, 'landing_pages.read', TRUE,
    'workspace', NULL, FALSE, 'admin', v_user_a
  );

  INSERT INTO public.workspace_offers (id, workspace_id, name, is_active) VALUES
    (v_offer_a, v_workspace_a, 'Domains test offer A', TRUE),
    (v_offer_b, v_workspace_b, 'Domains test offer B', TRUE);
  INSERT INTO public.landing_form_integrations (
    id, workspace_id, offer_id, public_id, allowed_origin, is_active
  ) VALUES
    (v_form_a, v_workspace_a, v_offer_a, 'f2510000-0000-4000-8000-000000000111',
      'https://crmonia-landing-test.onrender.com', TRUE),
    (v_form_b, v_workspace_b, v_offer_b, 'f2510000-0000-4000-8000-000000000112',
      'https://legacy-b.example.invalid', TRUE);
  INSERT INTO public.workspace_landings (
    id, workspace_id, name, offer_id, status, source_archive_path, analysis,
    adapted_archive_path, adapted_archive_bytes, adapter_status, intake_public_id,
    adapted_build_fingerprint
  ) VALUES
    (v_landing_a, v_workspace_a, 'Domains landing A', v_offer_a, 'draft',
      v_workspace_a::TEXT || '/' || v_landing_a::TEXT || '/source.zip', '{}'::JSONB,
      v_workspace_a::TEXT || '/' || v_landing_a::TEXT
        || '/adapted-a2510000-0000-4000-8000-000000000111.zip',
      100, 'prepared', 'f2510000-0000-4000-8000-000000000111', repeat('a', 64)),
    (v_landing_b, v_workspace_b, 'Domains landing B', v_offer_b, 'draft',
      v_workspace_b::TEXT || '/' || v_landing_b::TEXT || '/source.zip', '{}'::JSONB,
      v_workspace_b::TEXT || '/' || v_landing_b::TEXT
        || '/adapted-a2510000-0000-4000-8000-000000000112.zip',
      100, 'prepared', 'f2510000-0000-4000-8000-000000000112', repeat('b', 64));

  INSERT INTO public.workspace_domains (
    id, workspace_id, domain_name, connection_status
  ) VALUES
    (v_domain_a, v_workspace_a, 'example-a.test', 'active'),
    (v_domain_b, v_workspace_b, 'example-b.test', 'active');
  INSERT INTO public.workspace_domain_hosts (
    id, workspace_id, domain_id, apex_domain, hostname
  ) VALUES
    (v_host_a, v_workspace_a, v_domain_a, 'example-a.test', 'shop.example-a.test'),
    (v_host_a_unpublished, v_workspace_a, v_domain_a, 'example-a.test', 'draft.example-a.test'),
    (v_host_b, v_workspace_b, v_domain_b, 'example-b.test', 'shop.example-b.test');

  PERFORM public.reserve_workspace_domain_host(v_workspace_a, v_host_a, v_landing_a);
  PERFORM public.reserve_workspace_domain_host(
    v_workspace_a, v_host_a_unpublished, v_landing_a
  );
  PERFORM public.reserve_workspace_domain_host(v_workspace_b, v_host_b, v_landing_b);

  IF public.is_landing_origin_allowed('https://draft.example-a.test')
     OR public.is_landing_form_origin_allowed(
       'f2510000-0000-4000-8000-000000000111', 'https://draft.example-a.test'
     ) THEN
    RAISE EXCEPTION 'An unpublished hostname must not be allowed for intake';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspace_domain_hosts (
      workspace_id, domain_id, apex_domain, hostname
    ) VALUES (
      v_workspace_a, v_domain_a, 'example-a.test', 'shop.example-a.test'
    );
  EXCEPTION WHEN unique_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Duplicate hostname was accepted';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.workspace_domain_hosts (
      workspace_id, domain_id, apex_domain, hostname
    ) VALUES (
      v_workspace_a, v_domain_b, 'example-b.test', 'foreign.example-b.test'
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A host could reference another workspace domain';
  END IF;

  INSERT INTO public.landing_publication_versions (
    id, workspace_id, domain_host_id, landing_id, version_number,
    zip_fingerprint, build_fingerprint, r2_prefix
  ) VALUES
    (v_version_a1, v_workspace_a, v_host_a, v_landing_a, 1,
      repeat('1', 64), repeat('a', 64),
      'crmonia/landing-sites/' || v_workspace_a::TEXT || '/' || v_host_a::TEXT
        || '/' || v_version_a1::TEXT || '/'),
    (v_version_b1, v_workspace_b, v_host_b, v_landing_b, 1,
      repeat('2', 64), repeat('b', 64),
      'crmonia/landing-sites/' || v_workspace_b::TEXT || '/' || v_host_b::TEXT
        || '/' || v_version_b1::TEXT || '/');
  PERFORM public.switch_landing_publication_version(
    v_workspace_a, v_host_a, v_version_a1, NULL
  );
  PERFORM public.switch_landing_publication_version(
    v_workspace_b, v_host_b, v_version_b1, NULL
  );

  INSERT INTO public.landing_form_allowed_origins (
    workspace_id, integration_id, offer_id, landing_id,
    domain_host_id, hostname, origin
  ) VALUES
    (v_workspace_a, v_form_a, v_offer_a, v_landing_a,
      v_host_a, 'shop.example-a.test', 'https://shop.example-a.test'),
    (v_workspace_b, v_form_b, v_offer_b, v_landing_b,
      v_host_b, 'shop.example-b.test', 'https://shop.example-b.test');

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.landing_form_allowed_origins (
      workspace_id, integration_id, offer_id, landing_id,
      domain_host_id, hostname, origin
    ) VALUES (
      v_workspace_a, v_form_a, v_offer_a, v_landing_a,
      v_host_a_unpublished, 'draft.example-a.test', 'https://draft.example-a.test'
    );
  EXCEPTION WHEN check_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'An origin row was accepted before the host had a publication';
  END IF;

  v_rejected := FALSE;
  BEGIN
    INSERT INTO public.landing_form_allowed_origins (
      workspace_id, integration_id, offer_id, landing_id,
      domain_host_id, hostname, origin
    ) VALUES (
      v_workspace_a, v_form_a, v_offer_a, v_landing_a,
      v_host_b, 'shop.example-b.test', 'https://shop.example-b.test'
    );
  EXCEPTION WHEN foreign_key_violation OR check_violation THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A form origin could reference a host from another workspace';
  END IF;

  INSERT INTO public.landing_publication_versions (
    id, workspace_id, domain_host_id, landing_id, version_number,
    zip_fingerprint, build_fingerprint, r2_prefix
  ) VALUES (
    v_version_a2, v_workspace_a, v_host_a, v_landing_a, 2,
    repeat('3', 64), repeat('a', 64),
    'crmonia/landing-sites/' || v_workspace_a::TEXT || '/' || v_host_a::TEXT
      || '/' || v_version_a2::TEXT || '/'
  );
  PERFORM public.switch_landing_publication_version(
    v_workspace_a, v_host_a, v_version_a2, v_version_a1
  );
  PERFORM public.switch_landing_publication_version(
    v_workspace_a, v_host_a, v_version_a1, v_version_a2
  );

  v_rejected := FALSE;
  BEGIN
    PERFORM public.switch_landing_publication_version(
      v_workspace_a, v_host_a, v_version_a2, NULL
    );
  EXCEPTION WHEN SQLSTATE '40001' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A stale publication pointer was not rejected';
  END IF;

  v_rejected := FALSE;
  BEGIN
    PERFORM public.switch_landing_publication_version(
      v_workspace_a, v_host_a, v_version_b1, v_version_a1
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'A version from another workspace and host was accepted';
  END IF;

  v_rejected := FALSE;
  BEGIN
    UPDATE public.landing_publication_versions
    SET zip_fingerprint = repeat('f', 64)
    WHERE id = v_version_a1;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Publication version update was not rejected';
  END IF;

  v_rejected := FALSE;
  BEGIN
    DELETE FROM public.landing_publication_versions WHERE id = v_version_a1;
  EXCEPTION WHEN SQLSTATE '42501' THEN
    v_rejected := TRUE;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Publication version deletion was not rejected';
  END IF;

  IF NOT public.is_landing_origin_allowed('https://crmonia-landing-test.onrender.com')
     OR NOT public.is_landing_form_origin_allowed(
       'f2510000-0000-4000-8000-000000000111',
       'https://crmonia-landing-test.onrender.com'
     ) THEN
    RAISE EXCEPTION 'Legacy Render allowed_origin compatibility was lost';
  END IF;
  IF NOT public.is_landing_origin_allowed('https://shop.example-a.test')
     OR NOT public.is_landing_form_origin_allowed(
       'f2510000-0000-4000-8000-000000000111', 'https://shop.example-a.test'
     ) OR public.is_landing_form_origin_allowed(
       'f2510000-0000-4000-8000-000000000112', 'https://shop.example-a.test'
     ) THEN
    RAISE EXCEPTION 'Published exact origin access is incorrect or not form-scoped';
  END IF;

  v_accepted := public.create_public_landing_lead_with_click_ids(
    'f2510000-0000-4000-8000-000000000111', repeat('1', 64), repeat('2', 64),
    'https://crmonia-landing-test.onrender.com', 'Legacy test', '+380501234567',
    '+380501234567', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL
  );
  IF v_accepted <> 'accepted' THEN
    RAISE EXCEPTION 'Existing Render integration did not accept a lead';
  END IF;
  v_accepted := public.create_public_landing_lead_with_click_ids(
    'f2510000-0000-4000-8000-000000000111', repeat('3', 64), repeat('4', 64),
    'https://shop.example-a.test', 'Domain test', '+380501234568',
    '+380501234568', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    NULL, NULL, NULL, NULL, NULL, NULL
  );
  IF v_accepted <> 'accepted' THEN
    RAISE EXCEPTION 'Published domain origin did not accept a lead';
  END IF;

  UPDATE public.workspace_domain_hosts
  SET current_publication_version_id = NULL
  WHERE workspace_id = v_workspace_a AND id = v_host_a;
  IF public.is_landing_origin_allowed('https://shop.example-a.test')
     OR public.is_landing_form_origin_allowed(
       'f2510000-0000-4000-8000-000000000111', 'https://shop.example-a.test'
     ) THEN
    RAISE EXCEPTION 'An origin stayed allowed after its publication pointer was removed';
  END IF;
  PERFORM public.switch_landing_publication_version(
    v_workspace_a, v_host_a, v_version_a1, NULL
  );
END;
$$;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a2510000-0000-4000-8000-000000000101', TRUE);

DO $$
DECLARE
  v_count BIGINT;
BEGIN
  SELECT count(*) INTO v_count FROM public.workspace_domains;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'RLS did not isolate workspace_domains to the user''s authorized workspace';
  END IF;
  SELECT count(*) INTO v_count FROM public.workspace_domain_hosts;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'RLS did not isolate workspace_domain_hosts to the user''s authorized workspace';
  END IF;
  SELECT count(*) INTO v_count FROM public.landing_publication_versions;
  IF v_count <> 2 THEN
    RAISE EXCEPTION 'RLS did not isolate publication history to the user''s authorized workspace';
  END IF;
  SELECT count(*) INTO v_count FROM public.landing_form_allowed_origins;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'RLS did not isolate allowed origins to the user''s authorized workspace';
  END IF;
END;
$$;

RESET ROLE;
ROLLBACK;
