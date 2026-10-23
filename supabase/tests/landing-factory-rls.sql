-- Run only against a disposable local Supabase database after the Landing
-- Factory migration. Fixture writes are rolled back at the end.
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
