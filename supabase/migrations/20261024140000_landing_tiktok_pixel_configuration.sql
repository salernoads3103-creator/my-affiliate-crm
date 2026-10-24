-- Store one TikTok Pixel ID per landing draft and expose it through the existing
-- workspace-scoped landing list RPC. Apply only after review on a disposable DB.
BEGIN;

ALTER TABLE public.workspace_landings
  ADD COLUMN tiktok_pixel_id TEXT,
  ADD CONSTRAINT workspace_landings_tiktok_pixel_id_check
    CHECK (tiktok_pixel_id IS NULL OR tiktok_pixel_id ~ '^[A-Za-z0-9_-]{1,64}$');

CREATE OR REPLACE FUNCTION public.prevent_landing_identity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.published_url IS DISTINCT FROM OLD.published_url
     OR (
       NEW.status IS DISTINCT FROM OLD.status
       AND NOT (
         OLD.status = 'draft'
         AND OLD.deletion_started_at IS NULL
         AND NEW.status = 'error'
       )
     )
     OR (
       (NEW.name IS DISTINCT FROM OLD.name
        OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
        OR NEW.source_archive_path IS DISTINCT FROM OLD.source_archive_path
        OR NEW.source_archive_bytes IS DISTINCT FROM OLD.source_archive_bytes
        OR NEW.analysis IS DISTINCT FROM OLD.analysis
        OR NEW.adapted_archive_path IS DISTINCT FROM OLD.adapted_archive_path
        OR NEW.adapted_archive_bytes IS DISTINCT FROM OLD.adapted_archive_bytes
        OR NEW.adapter_status IS DISTINCT FROM OLD.adapter_status
        OR NEW.adapter_reason IS DISTINCT FROM OLD.adapter_reason
        OR NEW.intake_public_id IS DISTINCT FROM OLD.intake_public_id
        OR NEW.tiktok_pixel_id IS DISTINCT FROM OLD.tiktok_pixel_id)
       AND (OLD.status <> 'draft'
            OR OLD.deletion_started_at IS NOT NULL
            OR NEW.deletion_started_at IS NOT NULL)
     )
     OR (
       NEW.deletion_started_at IS DISTINCT FROM OLD.deletion_started_at
       AND (OLD.deletion_started_at IS NOT NULL
            OR NEW.deletion_started_at IS NULL
            OR OLD.status <> 'draft'
            OR NEW.name IS DISTINCT FROM OLD.name
            OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
            OR NEW.source_archive_path IS DISTINCT FROM OLD.source_archive_path
            OR NEW.source_archive_bytes IS DISTINCT FROM OLD.source_archive_bytes
            OR NEW.analysis IS DISTINCT FROM OLD.analysis
            OR NEW.adapted_archive_path IS DISTINCT FROM OLD.adapted_archive_path
            OR NEW.adapted_archive_bytes IS DISTINCT FROM OLD.adapted_archive_bytes
            OR NEW.adapter_status IS DISTINCT FROM OLD.adapter_status
            OR NEW.adapter_reason IS DISTINCT FROM OLD.adapter_reason
            OR NEW.intake_public_id IS DISTINCT FROM OLD.intake_public_id
            OR NEW.tiktok_pixel_id IS DISTINCT FROM OLD.tiktok_pixel_id)
     ) THEN
    RAISE EXCEPTION 'Landing identity or draft state cannot be reassigned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP FUNCTION public.get_workspace_landings(UUID, TEXT);

CREATE FUNCTION public.get_workspace_landings(
  p_workspace_id UUID,
  p_search TEXT DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  workspace_id UUID,
  name TEXT,
  offer_id UUID,
  offer_name TEXT,
  status TEXT,
  published_url TEXT,
  created_at TIMESTAMPTZ,
  created_by_user_id UUID,
  source_archive_path TEXT,
  source_archive_bytes BIGINT,
  deletion_started_at TIMESTAMPTZ,
  adapted_archive_bytes BIGINT,
  has_adapted_archive BOOLEAN,
  adapter_status TEXT,
  adapter_reason TEXT,
  tiktok_pixel_id TEXT,
  analysis JSONB
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.has_workspace_permission(p_workspace_id, 'landing_pages.read', NULL, NULL, NULL)
     AND NOT public.has_workspace_permission(p_workspace_id, 'landing_pages.manage', NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    landing.id,
    landing.workspace_id,
    landing.name,
    landing.offer_id,
    offer.name,
    landing.status,
    landing.published_url,
    landing.created_at,
    landing.created_by_user_id,
    landing.source_archive_path,
    landing.source_archive_bytes,
    landing.deletion_started_at,
    landing.adapted_archive_bytes,
    landing.adapted_archive_path IS NOT NULL,
    landing.adapter_status,
    landing.adapter_reason,
    landing.tiktok_pixel_id,
    landing.analysis
  FROM public.workspace_landings AS landing
  JOIN public.workspace_offers AS offer
    ON offer.workspace_id = landing.workspace_id
   AND offer.id = landing.offer_id
  WHERE landing.workspace_id = p_workspace_id
    AND (
      NULLIF(btrim(p_search), '') IS NULL
      OR landing.name ILIKE '%' || left(btrim(p_search), 120) || '%'
      OR offer.name ILIKE '%' || left(btrim(p_search), 120) || '%'
    )
  ORDER BY landing.created_at DESC, landing.name;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_landings(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_landings(UUID, TEXT) TO authenticated;

COMMENT ON COLUMN public.workspace_landings.tiktok_pixel_id IS
  'Public TikTok Pixel identifier embedded in an adapted static landing archive; not a secret.';

COMMIT;
