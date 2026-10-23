-- Landing draft editing and recoverable deletion. This migration is append-only.
BEGIN;

UPDATE public.workspace_permission_catalog
SET description = 'Create, edit, and delete workspace landing drafts and manage their private source ZIPs'
WHERE permission_key = 'landing_pages.manage';

ALTER TABLE public.workspace_landings
  ADD COLUMN source_archive_bytes BIGINT,
  ADD COLUMN deletion_started_at TIMESTAMPTZ,
  DROP CONSTRAINT workspace_landings_source_archive_path_shape,
  ADD CONSTRAINT workspace_landings_source_archive_path_shape
    CHECK (
      source_archive_path = workspace_id::TEXT || '/' || id::TEXT || '/source.zip'
      OR source_archive_path ~ (
        '^' || workspace_id::TEXT || '/' || id::TEXT
        || '/source-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]zip$'
      )
    ),
  ADD CONSTRAINT workspace_landings_source_archive_bytes_check
    CHECK (source_archive_bytes IS NULL OR source_archive_bytes BETWEEN 1 AND 26214400);

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
        OR NEW.analysis IS DISTINCT FROM OLD.analysis)
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
            OR NEW.analysis IS DISTINCT FROM OLD.analysis)
     ) THEN
    RAISE EXCEPTION 'Landing identity or draft state cannot be reassigned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.require_landing_draft_deletion_started()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF OLD.status <> 'draft' OR OLD.deletion_started_at IS NULL THEN
    RAISE EXCEPTION 'Only a draft marked for deletion can be removed' USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER workspace_landings_draft_delete_guard
  BEFORE DELETE ON public.workspace_landings
  FOR EACH ROW EXECUTE FUNCTION public.require_landing_draft_deletion_started();

REVOKE ALL ON FUNCTION public.prevent_landing_identity_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.require_landing_draft_deletion_started() FROM PUBLIC, anon, authenticated;

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

NOTIFY pgrst, 'reload schema';

COMMIT;
