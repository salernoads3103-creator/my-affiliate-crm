-- Run only against a disposable Supabase test database after applying
-- 20261024160000_workspace_tracking_profiles.sql.
DO $$
DECLARE
  v_guard_definition TEXT;
  v_tiktok_fk_definition TEXT;
  v_google_fk_definition TEXT;
  v_profile_fields_definition TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname = 'workspace_tracking_profiles'
      AND relation.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Tracking profiles must have row-level security enabled';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_tracking_profiles'
      AND policyname = 'workspace_tracking_profiles_read_authorized'
      AND cmd = 'SELECT'
      AND roles @> ARRAY['authenticated']::NAME[]
      AND NOT (roles @> ARRAY['anon']::NAME[])
      AND qual LIKE '%has_workspace_permission%'
      AND qual LIKE '%workspace_id%'
      AND qual LIKE '%landing_pages.read%'
      AND qual LIKE '%landing_pages.manage%'
  ) THEN
    RAISE EXCEPTION 'Tracking profile reads must use existing workspace permissions';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'workspace_tracking_profiles'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'Tracking profile writes must remain server-only';
  END IF;

  IF has_table_privilege('anon', 'public.workspace_tracking_profiles', 'SELECT')
     OR has_table_privilege('anon', 'public.workspace_tracking_profiles', 'INSERT')
     OR has_table_privilege('anon', 'public.workspace_tracking_profiles', 'UPDATE')
     OR has_table_privilege('anon', 'public.workspace_tracking_profiles', 'DELETE')
     OR has_table_privilege('authenticated', 'public.workspace_tracking_profiles', 'INSERT')
     OR has_table_privilege('authenticated', 'public.workspace_tracking_profiles', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.workspace_tracking_profiles', 'DELETE')
     OR NOT has_table_privilege('authenticated', 'public.workspace_tracking_profiles', 'SELECT') THEN
    RAISE EXCEPTION 'Only permission-scoped authenticated reads may access tracking profiles directly';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.workspace_tracking_profiles'::regclass
      AND conname = 'workspace_tracking_profiles_platform_fields_check'
      AND contype = 'c'
  ) THEN
    RAISE EXCEPTION 'Tracking profiles must constrain platform-specific fields';
  END IF;
  SELECT pg_catalog.pg_get_constraintdef(oid)
    INTO v_profile_fields_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.workspace_tracking_profiles'::regclass
    AND conname = 'workspace_tracking_profiles_platform_fields_check'
    AND contype = 'c';
  IF v_profile_fields_definition NOT LIKE '%tiktok_pixel_id IS NOT NULL%'
     OR v_profile_fields_definition NOT LIKE '%google_ads_conversion_id IS NOT NULL%'
     OR v_profile_fields_definition NOT LIKE '%google_ads_conversion_label IS NOT NULL%' THEN
    RAISE EXCEPTION 'Platform-specific tracking identifiers must be required by the table constraint';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_landings'
      AND column_name = 'adapted_tracking_fingerprint'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_landings'
      AND column_name = 'tiktok_tracking_profile_id'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_landings'
      AND column_name = 'google_ads_tracking_profile_id'
  ) THEN
    RAISE EXCEPTION 'Landing tracking selection and prepared snapshot fields are required';
  END IF;

  SELECT pg_catalog.pg_get_constraintdef(oid)
    INTO v_tiktok_fk_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.workspace_landings'::regclass
    AND conname = 'workspace_landings_tiktok_tracking_profile_fk'
    AND contype = 'f'
    AND confrelid = 'public.workspace_tracking_profiles'::regclass;
  SELECT pg_catalog.pg_get_constraintdef(oid)
    INTO v_google_fk_definition
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.workspace_landings'::regclass
    AND conname = 'workspace_landings_google_tracking_profile_fk'
    AND contype = 'f'
    AND confrelid = 'public.workspace_tracking_profiles'::regclass;
  IF v_tiktok_fk_definition NOT LIKE '%(tiktok_tracking_profile_id, workspace_id)%'
     OR v_google_fk_definition NOT LIKE '%(google_ads_tracking_profile_id, workspace_id)%'
     OR v_tiktok_fk_definition NOT LIKE '%(id, workspace_id)%'
     OR v_google_fk_definition NOT LIKE '%(id, workspace_id)%'
     OR v_tiktok_fk_definition NOT LIKE '%ON DELETE RESTRICT%'
     OR v_google_fk_definition NOT LIKE '%ON DELETE RESTRICT%' THEN
    RAISE EXCEPTION 'Landing profile references must be constrained to same-workspace profiles';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(
    'public.prevent_landing_tracking_profile_change()'::regprocedure
  ) INTO v_guard_definition;
  IF v_guard_definition NOT LIKE '%OLD.status <> ''draft''%'
     OR v_guard_definition NOT LIKE '%deletion_started_at%'
     OR v_guard_definition NOT LIKE '%NEW.status <> ''draft''%' THEN
    RAISE EXCEPTION 'Tracking profile selection must remain editable only on active drafts';
  END IF;
END;
$$;
