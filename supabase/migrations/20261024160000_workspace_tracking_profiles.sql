-- Reusable, workspace-scoped TikTok and Google Ads profiles.
-- Profile edits do not rewrite already prepared landing archives.
BEGIN;

CREATE TABLE public.workspace_tracking_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  platform TEXT NOT NULL CHECK (platform IN ('tiktok', 'google_ads')),
  tiktok_pixel_id TEXT,
  google_ads_conversion_id TEXT,
  google_ads_conversion_label TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_tracking_profiles_platform_fields_check CHECK (
    (platform = 'tiktok'
      AND tiktok_pixel_id IS NOT NULL
      AND tiktok_pixel_id ~ '^[A-Za-z0-9_-]{1,64}$'
      AND google_ads_conversion_id IS NULL
      AND google_ads_conversion_label IS NULL)
    OR
    (platform = 'google_ads'
      AND tiktok_pixel_id IS NULL
      AND google_ads_conversion_id IS NOT NULL
      AND google_ads_conversion_id ~ '^AW-[0-9]{1,20}$'
      AND google_ads_conversion_label IS NOT NULL
      AND google_ads_conversion_label ~ '^[A-Za-z0-9_-]{1,128}$')
  ),
  CONSTRAINT workspace_tracking_profiles_id_workspace_unique UNIQUE (id, workspace_id)
);

CREATE UNIQUE INDEX workspace_tracking_profiles_workspace_name_unique
  ON public.workspace_tracking_profiles(workspace_id, lower(name));
CREATE INDEX workspace_tracking_profiles_workspace_platform_active_idx
  ON public.workspace_tracking_profiles(workspace_id, platform, is_active, name);

CREATE TRIGGER workspace_tracking_profiles_updated_at
  BEFORE UPDATE ON public.workspace_tracking_profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_tracking_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_tracking_profiles_read_authorized
  ON public.workspace_tracking_profiles FOR SELECT TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'landing_pages.read', NULL, NULL, NULL)
    OR public.has_workspace_permission(workspace_id, 'landing_pages.manage', NULL, NULL, NULL)
  );

REVOKE ALL ON public.workspace_tracking_profiles FROM anon, authenticated;
GRANT SELECT ON public.workspace_tracking_profiles TO authenticated;

ALTER TABLE public.workspace_landings
  ADD COLUMN tiktok_tracking_profile_id UUID,
  ADD COLUMN google_ads_tracking_profile_id UUID,
  ADD COLUMN adapted_tracking_fingerprint TEXT,
  ADD CONSTRAINT workspace_landings_tiktok_tracking_profile_fk
    FOREIGN KEY (tiktok_tracking_profile_id, workspace_id)
    REFERENCES public.workspace_tracking_profiles(id, workspace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workspace_landings_google_tracking_profile_fk
    FOREIGN KEY (google_ads_tracking_profile_id, workspace_id)
    REFERENCES public.workspace_tracking_profiles(id, workspace_id) ON DELETE RESTRICT,
  ADD CONSTRAINT workspace_landings_tracking_fingerprint_check
    CHECK (adapted_tracking_fingerprint IS NULL OR adapted_tracking_fingerprint ~ '^[0-9a-f]{64}$');

CREATE INDEX workspace_landings_tiktok_tracking_profile_idx
  ON public.workspace_landings(tiktok_tracking_profile_id)
  WHERE tiktok_tracking_profile_id IS NOT NULL;
CREATE INDEX workspace_landings_google_tracking_profile_idx
  ON public.workspace_landings(google_ads_tracking_profile_id)
  WHERE google_ads_tracking_profile_id IS NOT NULL;

CREATE FUNCTION public.prevent_landing_tracking_profile_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (NEW.tiktok_tracking_profile_id IS DISTINCT FROM OLD.tiktok_tracking_profile_id
      OR NEW.google_ads_tracking_profile_id IS DISTINCT FROM OLD.google_ads_tracking_profile_id
      OR NEW.adapted_tracking_fingerprint IS DISTINCT FROM OLD.adapted_tracking_fingerprint)
     AND (OLD.status <> 'draft'
          OR OLD.deletion_started_at IS NOT NULL
          OR NEW.deletion_started_at IS NOT NULL
          OR NEW.status <> 'draft') THEN
    RAISE EXCEPTION 'Tracking profiles can only be changed on editable landing drafts'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_landings_tracking_profile_guard
  BEFORE UPDATE ON public.workspace_landings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_landing_tracking_profile_change();
REVOKE ALL ON FUNCTION public.prevent_landing_tracking_profile_change() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.workspace_tracking_profiles IS
  'Reusable workspace-scoped public tracking identifiers for TikTok Ads and Google Ads. Writes are server-only after landing_pages.manage checks.';
COMMENT ON COLUMN public.workspace_landings.adapted_tracking_fingerprint IS
  'SHA-256 fingerprint of public tracking settings embedded in the currently stored adapted ZIP. Profile edits never rewrite that ZIP.';

COMMIT;
