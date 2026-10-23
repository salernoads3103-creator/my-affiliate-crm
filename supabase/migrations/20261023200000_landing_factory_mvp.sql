-- Landing Factory MVP: workspace-scoped landing metadata and private source ZIPs.
-- Apply only after review on a disposable database; this migration is append-only.
BEGIN;

INSERT INTO public.workspace_permission_catalog (permission_key, description) VALUES
  ('landing_pages.read', 'View workspace landing pages and their ZIP analysis'),
  ('landing_pages.manage', 'Create workspace landing drafts and upload source ZIPs')
ON CONFLICT (permission_key) DO NOTHING;

CREATE TABLE public.workspace_landings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 160),
  offer_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'published', 'error')),
  published_url TEXT CHECK (published_url IS NULL OR char_length(published_url) <= 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source_archive_path TEXT NOT NULL,
  analysis JSONB NOT NULL CHECK (jsonb_typeof(analysis) = 'object'),
  CONSTRAINT workspace_landings_workspace_offer_fk
    FOREIGN KEY (workspace_id, offer_id)
    REFERENCES public.workspace_offers(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_landings_source_archive_path_unique UNIQUE (source_archive_path),
  CONSTRAINT workspace_landings_source_archive_path_shape
    CHECK (source_archive_path = workspace_id::TEXT || '/' || id::TEXT || '/source.zip'),
  CONSTRAINT workspace_landings_published_url_required
    CHECK (status <> 'published' OR published_url IS NOT NULL)
);

CREATE INDEX workspace_landings_workspace_created_idx
  ON public.workspace_landings(workspace_id, created_at DESC);
CREATE INDEX workspace_landings_workspace_offer_idx
  ON public.workspace_landings(workspace_id, offer_id);

CREATE FUNCTION public.prevent_landing_creator_reassignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  -- Allow ON DELETE SET NULL when an auth user is removed, but never replace
  -- the original author with another user.
  IF NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     AND NEW.created_by_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Landing creator cannot be reassigned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_landings_creator_immutable
  BEFORE UPDATE OF created_by_user_id ON public.workspace_landings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_landing_creator_reassignment();

CREATE FUNCTION public.prevent_landing_identity_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.offer_id IS DISTINCT FROM OLD.offer_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.source_archive_path IS DISTINCT FROM OLD.source_archive_path
     OR NEW.analysis IS DISTINCT FROM OLD.analysis
     OR NEW.published_url IS DISTINCT FROM OLD.published_url
     OR (
       NEW.status IS DISTINCT FROM OLD.status
       AND NOT (OLD.status = 'draft' AND NEW.status = 'error')
     ) THEN
    RAISE EXCEPTION 'Landing source metadata cannot be reassigned' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workspace_landings_identity_immutable
  BEFORE UPDATE ON public.workspace_landings
  FOR EACH ROW EXECUTE FUNCTION public.prevent_landing_identity_change();

REVOKE ALL ON FUNCTION public.prevent_landing_creator_reassignment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_landing_identity_change() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.workspace_landings ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_landings_read_authorized
  ON public.workspace_landings FOR SELECT TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'landing_pages.read', NULL, NULL, NULL)
    OR public.has_workspace_permission(workspace_id, 'landing_pages.manage', NULL, NULL, NULL)
  );

REVOKE ALL ON public.workspace_landings FROM anon, authenticated;
GRANT SELECT ON public.workspace_landings TO authenticated;

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

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crmonia-landing-archives',
  'crmonia-landing-archives',
  FALSE,
  26214400,
  ARRAY['application/zip']::TEXT[]
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 26214400,
    allowed_mime_types = ARRAY['application/zip']::TEXT[];

CREATE POLICY landing_archive_read_authorized
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'crmonia-landing-archives'
    AND EXISTS (
      SELECT 1
      FROM public.workspace_landings AS landing
      WHERE landing.source_archive_path = name
        AND (
          public.has_workspace_permission(landing.workspace_id, 'landing_pages.read', NULL, NULL, NULL)
          OR public.has_workspace_permission(landing.workspace_id, 'landing_pages.manage', NULL, NULL, NULL)
        )
    )
  );

COMMENT ON TABLE public.workspace_landings IS
  'Workspace-scoped landing drafts. Source ZIP contents remain in the private crmonia-landing-archives bucket.';
COMMENT ON COLUMN public.workspace_landings.source_archive_path IS
  'Private Storage object path only; archive bytes are never stored in the database. Mutations and uploads are server-only after RBAC and archive validation.';

COMMIT;
