-- Run only against a disposable local Supabase database after the Landing
-- Factory, Adapter, and tracking configuration migrations. Fixture writes
-- are rolled back at the end.
BEGIN;

DO $$
DECLARE
  v_workspace_id UUID := public.main_workspace_id();
  v_foreign_workspace_id UUID := gen_random_uuid();
  v_foreign_offer_id UUID := gen_random_uuid();
  v_landing_id UUID := gen_random_uuid();
  v_rls_enabled BOOLEAN;
  v_fk_definition TEXT;
  v_bucket_public BOOLEAN;
  v_bucket_limit BIGINT;
  v_listing_result TEXT;
  v_adapter_function TEXT;
  v_storage_policy TEXT;
  v_pixel_constraint TEXT;
  v_google_ads_constraint TEXT;
  v_cross_workspace_rejected BOOLEAN := FALSE;
BEGIN
  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'A main workspace is required for the workspace isolation check';
  END IF;

  SELECT relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class
  WHERE oid = 'public.workspace_landings'::regclass;
  IF NOT COALESCE(v_rls_enabled, FALSE) THEN
    RAISE EXCEPTION 'RLS must remain enabled for workspace_landings';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_landings'
      AND column_name = 'source_archive_bytes'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_landings'
      AND column_name = 'deletion_started_at'
  ) THEN
    RAISE EXCEPTION 'Draft management metadata is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_landings'
      AND column_name = 'adapted_archive_path'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_landings'
      AND column_name = 'adapter_status'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_landings'
      AND column_name = 'intake_public_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_landings'
      AND column_name = 'tiktok_pixel_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_landings'
      AND column_name = 'google_ads_conversion_id'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'workspace_landings'
      AND column_name = 'google_ads_conversion_label'
  ) THEN
    RAISE EXCEPTION 'Landing adapter metadata is missing';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid)
  INTO v_pixel_constraint
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.workspace_landings'::regclass
    AND c.conname = 'workspace_landings_tiktok_pixel_id_check'
    AND c.contype = 'c'
    AND c.convalidated;
  IF v_pixel_constraint IS NULL OR v_pixel_constraint NOT LIKE '%A-Za-z0-9_%' THEN
    RAISE EXCEPTION 'TikTok Pixel IDs must reject values unsafe for generated JavaScript';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid)
  INTO v_google_ads_constraint
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.workspace_landings'::regclass
    AND c.conname = 'workspace_landings_google_ads_settings_check'
    AND c.contype = 'c'
    AND c.convalidated;
  IF v_google_ads_constraint IS NULL
     OR v_google_ads_constraint NOT LIKE '%AW-%'
     OR v_google_ads_constraint NOT LIKE '%google_ads_conversion_label%' THEN
    RAISE EXCEPTION 'Google Ads conversion ID and label must be stored as a validated pair';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'public.workspace_landings'::regclass
      AND tgname = 'workspace_landings_draft_delete_guard'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Hard deletion must require a draft marked for deletion';
  END IF;

  SELECT pg_catalog.pg_get_function_result('public.get_workspace_landings(uuid,text)'::regprocedure)
  INTO v_listing_result;
  IF v_listing_result NOT LIKE '%source_archive_bytes%'
     OR v_listing_result NOT LIKE '%deletion_started_at%'
     OR v_listing_result NOT LIKE '%adapter_status%'
     OR v_listing_result NOT LIKE '%has_adapted_archive%'
     OR v_listing_result NOT LIKE '%tiktok_pixel_id%'
     OR v_listing_result NOT LIKE '%google_ads_conversion_id%'
     OR v_listing_result NOT LIKE '%google_ads_conversion_label%' THEN
    RAISE EXCEPTION 'Landing listing must expose source and adapter state without private ZIP paths';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_permission_catalog
    WHERE permission_key = 'landing_pages.read'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.workspace_permission_catalog
    WHERE permission_key = 'landing_pages.manage'
  ) THEN
    RAISE EXCEPTION 'Landing page permissions are missing from the permission catalog';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_landings'
      AND policyname = 'workspace_landings_read_authorized'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['authenticated']::NAME[]
      AND NOT (roles @> ARRAY['anon']::NAME[])
  ) THEN
    RAISE EXCEPTION 'The workspace_landings SELECT policy is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_landings'
      AND policyname = 'workspace_landings_read_authorized'
      AND cmd = 'SELECT'
      AND qual LIKE '%landing_pages.read%'
  ) THEN
    RAISE EXCEPTION 'The SELECT policy must check landing_pages.read';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_landings'
      AND policyname = 'workspace_landings_read_authorized'
      AND cmd = 'SELECT'
      AND qual LIKE '%landing_pages.manage%'
  ) THEN
    RAISE EXCEPTION 'The SELECT policy must also allow landing_pages.manage';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_landings'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Direct mutation policies are forbidden; writes must remain server-only';
  END IF;

  IF has_table_privilege('anon', 'public.workspace_landings', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_landings', 'INSERT')
     OR NOT has_table_privilege('authenticated', 'public.workspace_landings', 'SELECT')
     OR has_table_privilege('authenticated', 'public.workspace_landings', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_landings', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_landings', 'DELETE') THEN
    RAISE EXCEPTION 'Direct metadata mutations and anonymous access must remain unavailable';
  END IF;

  IF has_function_privilege('anon', 'public.get_workspace_landings(uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.get_workspace_landings(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Landing listing RPC must be authenticated and never executable by anon';
  END IF;

  IF has_function_privilege('anon', 'public.ensure_landing_form_config_for_adapter(uuid,uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.configure_landing_form_origin_for_adapter(uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.ensure_landing_form_config_for_adapter(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.configure_landing_form_origin_for_adapter(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Landing form adapter RPCs must be authenticated and unavailable to anon';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.ensure_landing_form_config_for_adapter(uuid,uuid)'::regprocedure)
  INTO v_adapter_function;
  IF v_adapter_function NOT LIKE '%landing_pages.manage%'
     OR v_adapter_function NOT LIKE '%https://pending.crmonia.invalid%'
     OR v_adapter_function NOT LIKE '%FALSE%' THEN
    RAISE EXCEPTION 'Pending landing forms must use landing_pages.manage and remain inactive';
  END IF;

  SELECT pg_catalog.pg_get_functiondef('public.configure_landing_form_origin_for_adapter(uuid,uuid,text)'::regprocedure)
  INTO v_adapter_function;
  IF v_adapter_function NOT LIKE '%landing_pages.manage%'
     OR v_adapter_function NOT LIKE '%FOR UPDATE%'
     OR v_adapter_function NOT LIKE '%pending.crmonia.invalid%' THEN
    RAISE EXCEPTION 'Origin configuration must remain scoped and preserve existing offer configuration';
  END IF;

  SELECT policy.qual
  INTO v_storage_policy
  FROM pg_catalog.pg_policies AS policy
  WHERE policy.schemaname = 'storage'
    AND policy.tablename = 'objects'
    AND policy.policyname = 'landing_archive_read_authorized';
  IF v_storage_policy IS NULL
     OR v_storage_policy NOT LIKE '%source_archive_path%'
     OR v_storage_policy LIKE '%adapted_archive_path%' THEN
    RAISE EXCEPTION 'Adapted ZIPs must remain accessible through the authorized server endpoint only';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(c.oid)
  INTO v_fk_definition
  FROM pg_catalog.pg_constraint AS c
  WHERE c.conrelid = 'public.workspace_landings'::regclass
    AND c.conname = 'workspace_landings_workspace_offer_fk'
    AND c.contype = 'f'
    AND c.convalidated;
  IF v_fk_definition IS NULL
     OR v_fk_definition NOT LIKE '%(workspace_id, offer_id)%'
     OR v_fk_definition NOT LIKE '%workspace_offers(workspace_id, id)%' THEN
    RAISE EXCEPTION 'A landing must reference an offer from its own workspace';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_landings'
      AND column_name IN ('archive_bytes', 'zip_bytes', 'source_archive')
  ) THEN
    RAISE EXCEPTION 'ZIP bytes must remain outside the database';
  END IF;

  SELECT public, file_size_limit
  INTO v_bucket_public, v_bucket_limit
  FROM storage.buckets
  WHERE id = 'crmonia-landing-archives';
  IF NOT FOUND OR v_bucket_public OR v_bucket_limit <> 26214400 THEN
    RAISE EXCEPTION 'Landing source ZIP storage must be private and limited to 25 MB';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'landing_archive_read_authorized'
      AND qual LIKE '%crmonia-landing-archives%'
      AND qual LIKE '%landing_pages.read%'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND cmd IN ('INSERT', 'ALL')
      AND coalesce(with_check, '') LIKE '%crmonia-landing-archives%'
  ) THEN
    RAISE EXCEPTION 'Private archives must be readable by scoped users and writable only by the server';
  END IF;

  INSERT INTO public.workspaces (id, name, slug)
  VALUES (v_foreign_workspace_id, 'Landing Factory fixture', 'landing-factory-' || v_foreign_workspace_id::TEXT);
  INSERT INTO public.workspace_offers (id, workspace_id, name)
  VALUES (v_foreign_offer_id, v_foreign_workspace_id, 'Foreign offer fixture');

  BEGIN
    INSERT INTO public.workspace_landings (
      id, workspace_id, name, offer_id, created_by_user_id, source_archive_path, analysis
    ) VALUES (
      v_landing_id,
      v_workspace_id,
      'Cross-workspace landing fixture',
      v_foreign_offer_id,
      NULL,
      v_workspace_id::TEXT || '/' || v_landing_id::TEXT || '/source.zip',
      '{}'::JSONB
    );
  EXCEPTION WHEN foreign_key_violation THEN
    v_cross_workspace_rejected := TRUE;
  END;

  IF NOT v_cross_workspace_rejected THEN
    RAISE EXCEPTION 'A landing must not reference an offer from another workspace';
  END IF;
END;
$$;

ROLLBACK;
