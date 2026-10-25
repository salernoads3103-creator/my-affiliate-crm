-- Durable state for the offer -> landing -> publication wizard.
-- The workflow is server-readable only; existing domain services remain the
-- source of truth for product, form, landing, domain, and publication rules.
BEGIN;

CREATE TABLE public.workspace_offer_launch_workflows (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  created_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  source_archive_path TEXT NOT NULL CHECK (
    char_length(source_archive_path) BETWEEN 1 AND 512
    AND source_archive_path !~ '(^/|(^|/)\.\.?(/|$)|\\)'
  ),
  source_archive_sha256 TEXT NOT NULL CHECK (source_archive_sha256 ~ '^[0-9a-f]{64}$'),
  product_id UUID NOT NULL,
  offer_id UUID NOT NULL,
  offer_name TEXT NOT NULL CHECK (char_length(btrim(offer_name)) BETWEEN 1 AND 120),
  offer_price_minor BIGINT NOT NULL CHECK (offer_price_minor BETWEEN 1 AND 99999999999),
  domain_host_id UUID NOT NULL,
  tiktok_tracking_profile_id UUID,
  google_ads_tracking_profile_id UUID,
  tiktok_pixel_id TEXT,
  google_ads_conversion_id TEXT,
  google_ads_conversion_label TEXT,
  stage TEXT NOT NULL DEFAULT 'offer_created'
    CHECK (stage IN ('offer_created', 'landing_created', 'adapter_prepared', 'published')),
  processing_token UUID,
  processing_until TIMESTAMPTZ,
  publication_attempt INTEGER NOT NULL DEFAULT 0 CHECK (publication_attempt BETWEEN 0 AND 99),
  publication_version_id UUID,
  published_url TEXT CHECK (published_url IS NULL OR published_url ~ '^https://'),
  last_error_code TEXT CHECK (
    last_error_code IS NULL OR last_error_code IN (
      'LANDING_ARCHIVE_UNAVAILABLE', 'LANDING_ADAPTATION_REQUIRED',
      'INTAKE_API_NOT_CONFIGURED',
      'DOMAIN_CONFLICT', 'DOMAIN_NOT_READY', 'PUBLICATION_CONFLICT',
      'PUBLICATION_FAILED', 'INTERNAL_ERROR'
    )
  ),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_offer_launches_id_workspace_unique UNIQUE (workspace_id, id),
  CONSTRAINT workspace_offer_launches_archive_scope_check CHECK (
    source_archive_path = workspace_id::TEXT || '/.offer-launches/' || id::TEXT || '/'
      || source_archive_sha256 || '/source.zip'
  ),
  CONSTRAINT workspace_offer_launches_offer_unique UNIQUE (workspace_id, offer_id),
  CONSTRAINT workspace_offer_launches_product_fk
    FOREIGN KEY (workspace_id, product_id)
    REFERENCES public.products(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_offer_launches_offer_fk
    FOREIGN KEY (workspace_id, offer_id)
    REFERENCES public.workspace_offers(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_offer_launches_host_fk
    FOREIGN KEY (workspace_id, domain_host_id)
    REFERENCES public.workspace_domain_hosts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_offer_launches_tiktok_profile_fk
    FOREIGN KEY (tiktok_tracking_profile_id, workspace_id)
    REFERENCES public.workspace_tracking_profiles(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_offer_launches_google_profile_fk
    FOREIGN KEY (google_ads_tracking_profile_id, workspace_id)
    REFERENCES public.workspace_tracking_profiles(id, workspace_id) ON DELETE RESTRICT,
  CONSTRAINT workspace_offer_launches_tiktok_snapshot_check CHECK (
    (tiktok_tracking_profile_id IS NULL AND tiktok_pixel_id IS NULL)
    OR (tiktok_tracking_profile_id IS NOT NULL AND tiktok_pixel_id IS NOT NULL
      AND tiktok_pixel_id ~ '^[A-Za-z0-9_-]{1,64}$')
  ),
  CONSTRAINT workspace_offer_launches_google_snapshot_check CHECK (
    (google_ads_tracking_profile_id IS NULL
      AND google_ads_conversion_id IS NULL AND google_ads_conversion_label IS NULL)
    OR (google_ads_tracking_profile_id IS NOT NULL
      AND google_ads_conversion_id IS NOT NULL AND google_ads_conversion_label IS NOT NULL
      AND google_ads_conversion_id ~ '^AW-[0-9]{1,20}$'
      AND google_ads_conversion_label ~ '^[A-Za-z0-9_-]{1,128}$')
  ),
  CONSTRAINT workspace_offer_launches_publication_version_fk
    FOREIGN KEY (workspace_id, domain_host_id, id, publication_version_id)
    REFERENCES public.landing_publication_versions(workspace_id, domain_host_id, landing_id, id)
    ON DELETE RESTRICT,
  CONSTRAINT workspace_offer_launches_completion_check CHECK (
    (stage = 'published' AND publication_version_id IS NOT NULL AND published_url IS NOT NULL)
    OR (stage <> 'published' AND publication_version_id IS NULL AND published_url IS NULL)
  ),
  CONSTRAINT workspace_offer_launches_processing_check CHECK (
    (processing_token IS NULL) = (processing_until IS NULL)
  )
);

CREATE INDEX workspace_offer_launches_workspace_created_idx
  ON public.workspace_offer_launch_workflows(workspace_id, created_at DESC);
CREATE INDEX workspace_offer_launches_host_stage_idx
  ON public.workspace_offer_launch_workflows(workspace_id, domain_host_id, stage);

CREATE TRIGGER workspace_offer_launches_updated_at
  BEFORE UPDATE ON public.workspace_offer_launch_workflows
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_offer_launch_workflows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_offer_launch_workflows FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.workspace_offer_launch_workflows TO service_role;
GRANT UPDATE (
  domain_host_id, stage, processing_token, processing_until, publication_attempt,
  publication_version_id, published_url, last_error_code, updated_at
) ON public.workspace_offer_launch_workflows TO service_role;

CREATE FUNCTION public.begin_workspace_offer_launch(
  p_workspace_id UUID,
  p_launch_id UUID,
  p_request_fingerprint TEXT,
  p_source_archive_path TEXT,
  p_source_archive_sha256 TEXT,
  p_product_id UUID,
  p_offer_name TEXT,
  p_offer_price_minor BIGINT,
  p_domain_host_id UUID,
  p_tiktok_tracking_profile_id UUID DEFAULT NULL,
  p_google_ads_tracking_profile_id UUID DEFAULT NULL,
  p_tiktok_pixel_id TEXT DEFAULT NULL,
  p_google_ads_conversion_id TEXT DEFAULT NULL,
  p_google_ads_conversion_label TEXT DEFAULT NULL
)
RETURNS TABLE(launch_id UUID, offer_id UUID, stage TEXT, replayed BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing public.workspace_offer_launch_workflows%ROWTYPE;
  v_offer_id UUID;
  v_domain_status TEXT;
  v_host public.workspace_domain_hosts%ROWTYPE;
BEGIN
  IF v_user_id IS NULL OR p_workspace_id IS NULL OR p_launch_id IS NULL
     OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$'
     OR p_source_archive_sha256 IS NULL OR p_source_archive_sha256 !~ '^[0-9a-f]{64}$'
     OR p_source_archive_path IS NULL OR char_length(p_source_archive_path) NOT BETWEEN 1 AND 512
     OR p_product_id IS NULL OR p_domain_host_id IS NULL
     OR p_offer_name IS NULL OR char_length(btrim(p_offer_name)) NOT BETWEEN 1 AND 120
     OR p_offer_price_minor IS NULL OR p_offer_price_minor NOT BETWEEN 1 AND 99999999999 THEN
    RAISE EXCEPTION 'Invalid offer launch request' USING ERRCODE = '22023';
  END IF;
  IF p_source_archive_path ~ '(^/|(^|/)\.\.?(/|$)|\\)' THEN
    RAISE EXCEPTION 'Invalid source archive path' USING ERRCODE = '22023';
  END IF;
  IF p_source_archive_path <> (
    p_workspace_id::TEXT || '/.offer-launches/' || p_launch_id::TEXT
      || '/' || p_source_archive_sha256 || '/source.zip'
  ) THEN
    RAISE EXCEPTION 'Source archive path is outside this launch' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_workspace_permission(p_workspace_id, 'offers.manage', NULL, NULL, NULL)
     OR NOT public.has_workspace_permission(p_workspace_id, 'products.read', NULL, NULL, NULL)
     OR NOT public.has_workspace_permission(p_workspace_id, 'landing_pages.manage', NULL, NULL, NULL) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'crmonia-landing-archives'
      AND object.name = p_source_archive_path
  ) THEN
    RAISE EXCEPTION 'Staged source archive was not uploaded' USING ERRCODE = 'P0002';
  END IF;

  SELECT workflow.* INTO v_existing
  FROM public.workspace_offer_launch_workflows AS workflow
  WHERE workflow.workspace_id = p_workspace_id AND workflow.id = p_launch_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.created_by_user_id <> v_user_id
       OR v_existing.request_fingerprint <> p_request_fingerprint THEN
      RAISE EXCEPTION 'Launch key was already used for another request' USING ERRCODE = '23505';
    END IF;
    RETURN QUERY SELECT v_existing.id, v_existing.offer_id, v_existing.stage, TRUE;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.products AS product
    WHERE product.workspace_id = p_workspace_id
      AND product.id = p_product_id AND product.is_active
  ) THEN
    RAISE EXCEPTION 'Product is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT host.* INTO v_host
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_domains AS parent_domain
    ON parent_domain.workspace_id = host.workspace_id AND parent_domain.id = host.domain_id
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
  FOR UPDATE OF host, parent_domain;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;
  SELECT parent_domain.connection_status INTO v_domain_status
  FROM public.workspace_domains AS parent_domain
  WHERE parent_domain.workspace_id = p_workspace_id
    AND parent_domain.id = v_host.domain_id;
  IF v_host.status <> 'available' OR v_host.current_publication_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Domain address is already in use' USING ERRCODE = '23505';
  END IF;
  IF v_domain_status <> 'active' OR v_host.technical_status <> 'ready'
     OR v_host.technical_checked_at IS NULL
     OR v_host.technical_checked_at < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'A recent successful DNS and HTTPS check is required' USING ERRCODE = '23514';
  END IF;

  IF (p_tiktok_tracking_profile_id IS NULL AND p_tiktok_pixel_id IS NOT NULL)
     OR (p_tiktok_tracking_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_tracking_profiles AS profile
    WHERE profile.workspace_id = p_workspace_id AND profile.id = p_tiktok_tracking_profile_id
      AND profile.platform = 'tiktok' AND profile.is_active
      AND profile.tiktok_pixel_id = p_tiktok_pixel_id
  )) THEN
    RAISE EXCEPTION 'TikTok profile is unavailable' USING ERRCODE = '23503';
  END IF;
  IF (p_google_ads_tracking_profile_id IS NULL
      AND (p_google_ads_conversion_id IS NOT NULL OR p_google_ads_conversion_label IS NOT NULL))
     OR (p_google_ads_tracking_profile_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspace_tracking_profiles AS profile
    WHERE profile.workspace_id = p_workspace_id AND profile.id = p_google_ads_tracking_profile_id
      AND profile.platform = 'google_ads' AND profile.is_active
      AND profile.google_ads_conversion_id = p_google_ads_conversion_id
      AND profile.google_ads_conversion_label = p_google_ads_conversion_label
  )) THEN
    RAISE EXCEPTION 'Google Ads profile is unavailable' USING ERRCODE = '23503';
  END IF;

  v_offer_id := public.create_commercial_offer(
    p_workspace_id, btrim(p_offer_name), p_product_id, p_offer_price_minor, NULL, TRUE
  );
  INSERT INTO public.workspace_offer_launch_workflows (
    id, workspace_id, created_by_user_id, request_fingerprint,
    source_archive_path, source_archive_sha256, product_id, offer_id,
    offer_name, offer_price_minor, domain_host_id,
    tiktok_tracking_profile_id, google_ads_tracking_profile_id,
    tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label
  ) VALUES (
    p_launch_id, p_workspace_id, v_user_id, p_request_fingerprint,
    p_source_archive_path, p_source_archive_sha256, p_product_id, v_offer_id,
    btrim(p_offer_name), p_offer_price_minor, p_domain_host_id,
    p_tiktok_tracking_profile_id, p_google_ads_tracking_profile_id,
    p_tiktok_pixel_id, p_google_ads_conversion_id, p_google_ads_conversion_label
  );

  RETURN QUERY SELECT p_launch_id, v_offer_id, 'offer_created'::TEXT, FALSE;
END;
$$;

-- A hostname can be claimed by another launch between the initial check and
-- creation of the landing draft. Allow the owner to select another checked,
-- free hostname only before adapter/publication work begins. Reservation and
-- workflow binding change in one transaction.
CREATE FUNCTION public.change_workspace_offer_launch_host(
  p_workspace_id UUID,
  p_launch_id UUID,
  p_domain_host_id UUID
)
RETURNS TABLE(domain_host_id UUID, hostname TEXT, already_selected BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_launch public.workspace_offer_launch_workflows%ROWTYPE;
  v_old_host public.workspace_domain_hosts%ROWTYPE;
  v_new_host public.workspace_domain_hosts%ROWTYPE;
  v_domain_status TEXT;
BEGIN
  IF p_workspace_id IS NULL OR p_launch_id IS NULL OR p_domain_host_id IS NULL THEN
    RAISE EXCEPTION 'Invalid launch hostname request' USING ERRCODE = '22023';
  END IF;
  -- This function is executable only by service_role. The calling API performs
  -- the user's workspace permission check before invoking it.
  SELECT workflow.* INTO v_launch
  FROM public.workspace_offer_launch_workflows AS workflow
  WHERE workflow.workspace_id = p_workspace_id AND workflow.id = p_launch_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer launch not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_launch.stage NOT IN ('offer_created', 'landing_created') THEN
    RAISE EXCEPTION 'Hostname can no longer be changed for this launch' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.landing_publication_operations AS operation
    WHERE operation.workspace_id = p_workspace_id
      AND operation.landing_id = p_launch_id
      AND operation.operation_kind = 'publish'
  ) THEN
    RAISE EXCEPTION 'A publication operation already exists for this launch' USING ERRCODE = '23514';
  END IF;
  IF v_launch.domain_host_id = p_domain_host_id THEN
    RETURN QUERY
      SELECT host.id, host.hostname, TRUE
      FROM public.workspace_domain_hosts AS host
      WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id;
    RETURN;
  END IF;

  -- Lock both rows in a stable order so simultaneous reassignment requests do
  -- not deadlock while trying to release and claim opposite addresses.
  PERFORM host.id
  FROM public.workspace_domain_hosts AS host
  WHERE host.workspace_id = p_workspace_id
    AND host.id IN (v_launch.domain_host_id, p_domain_host_id)
  ORDER BY host.id
  FOR UPDATE;

  SELECT host.* INTO v_old_host
  FROM public.workspace_domain_hosts AS host
  WHERE host.workspace_id = p_workspace_id AND host.id = v_launch.domain_host_id;
  SELECT host.* INTO v_new_host
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_domains AS domain
    ON domain.workspace_id = host.workspace_id AND domain.id = host.domain_id
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
  FOR UPDATE OF host, domain;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT domain.connection_status INTO v_domain_status
  FROM public.workspace_domains AS domain
  WHERE domain.workspace_id = p_workspace_id AND domain.id = v_new_host.domain_id;

  IF v_new_host.status = 'reserved' AND v_new_host.reserved_landing_id = p_launch_id THEN
    -- This is a retry after reserving the new host but before persisting the
    -- selection. Continue below and release the former reservation.
    NULL;
  ELSIF v_new_host.status <> 'available' OR v_new_host.current_publication_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Domain address is already in use' USING ERRCODE = '23505';
  END IF;
  IF v_domain_status <> 'active' OR v_new_host.technical_status <> 'ready'
     OR v_new_host.technical_checked_at IS NULL
     OR v_new_host.technical_checked_at < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'A recent successful DNS and HTTPS check is required' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_landings AS landing
    WHERE landing.workspace_id = p_workspace_id AND landing.id = p_launch_id
      AND landing.offer_id = v_launch.offer_id AND landing.status = 'draft'
      AND landing.deletion_started_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The launch landing draft is unavailable' USING ERRCODE = 'P0002';
  END IF;

  IF v_new_host.status = 'available' THEN
    UPDATE public.workspace_domain_hosts AS host
    SET status = 'reserved', reserved_landing_id = p_launch_id
    WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
      AND host.status = 'available' AND host.current_publication_version_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Domain address changed concurrently' USING ERRCODE = '40001';
    END IF;
  END IF;

  IF v_old_host.status = 'reserved' AND v_old_host.reserved_landing_id = p_launch_id THEN
    IF v_old_host.current_publication_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'Published hostname cannot be released by this operation' USING ERRCODE = '23514';
    END IF;
    UPDATE public.workspace_domain_hosts AS host
    SET status = 'available', reserved_landing_id = NULL
    WHERE host.workspace_id = p_workspace_id AND host.id = v_old_host.id
      AND host.status = 'reserved' AND host.reserved_landing_id = p_launch_id
      AND host.current_publication_version_id IS NULL;
  END IF;

  UPDATE public.workspace_offer_launch_workflows AS workflow
  SET domain_host_id = p_domain_host_id, last_error_code = NULL
  WHERE workflow.workspace_id = p_workspace_id AND workflow.id = p_launch_id;

  RETURN QUERY SELECT v_new_host.id, v_new_host.hostname, FALSE;
END;
$$;

CREATE FUNCTION public.claim_workspace_offer_launch(
  p_workspace_id UUID,
  p_launch_id UUID,
  p_processing_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_launch_id IS NULL OR p_processing_token IS NULL THEN
    RAISE EXCEPTION 'Invalid launch processing claim' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspace_offer_launch_workflows AS workflow
  SET processing_token = p_processing_token,
      processing_until = now() + INTERVAL '3 minutes'
  WHERE workflow.workspace_id = p_workspace_id
    AND workflow.id = p_launch_id
    AND workflow.stage <> 'published'
    AND (workflow.processing_until IS NULL OR workflow.processing_until <= now()
      OR workflow.processing_token = p_processing_token);
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.renew_workspace_offer_launch_claim(
  p_workspace_id UUID,
  p_launch_id UUID,
  p_processing_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_launch_id IS NULL OR p_processing_token IS NULL THEN
    RAISE EXCEPTION 'Invalid launch processing claim' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspace_offer_launch_workflows AS workflow
  SET processing_until = now() + INTERVAL '3 minutes'
  WHERE workflow.workspace_id = p_workspace_id AND workflow.id = p_launch_id
    AND workflow.processing_token = p_processing_token
    AND workflow.stage <> 'published';
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.release_workspace_offer_launch_claim(
  p_workspace_id UUID,
  p_launch_id UUID,
  p_processing_token UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_launch_id IS NULL OR p_processing_token IS NULL THEN
    RAISE EXCEPTION 'Invalid launch processing claim' USING ERRCODE = '22023';
  END IF;
  UPDATE public.workspace_offer_launch_workflows AS workflow
  SET processing_token = NULL, processing_until = NULL
  WHERE workflow.workspace_id = p_workspace_id AND workflow.id = p_launch_id
    AND workflow.processing_token = p_processing_token;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.begin_workspace_offer_launch(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BIGINT, UUID, UUID, UUID, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.begin_workspace_offer_launch(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BIGINT, UUID, UUID, UUID, TEXT, TEXT, TEXT
) TO authenticated;
REVOKE ALL ON FUNCTION public.change_workspace_offer_launch_host(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_workspace_offer_launch_host(UUID, UUID, UUID)
  TO service_role;

COMMENT ON TABLE public.workspace_offer_launch_workflows IS
  'Server-only resumable state for one offer, one landing draft (same UUID as id), and one publication workflow.';
COMMENT ON COLUMN public.workspace_offer_launch_workflows.request_fingerprint IS
  'Stable SHA-256 of immutable offer, tracking, and source ZIP inputs; hostname may change only through the pre-publication reassignment RPC.';
COMMENT ON FUNCTION public.begin_workspace_offer_launch(
  UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, BIGINT, UUID, UUID, UUID, TEXT, TEXT, TEXT
) IS 'Creates an offer and its durable launch state atomically; retries return the original offer.';
COMMENT ON FUNCTION public.change_workspace_offer_launch_host(UUID, UUID, UUID) IS
  'Service-only atomic hostname reassignment for a launch before adapter preparation.';
REVOKE ALL ON FUNCTION public.claim_workspace_offer_launch(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.renew_workspace_offer_launch_claim(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_workspace_offer_launch_claim(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_workspace_offer_launch(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.renew_workspace_offer_launch_claim(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_workspace_offer_launch_claim(UUID, UUID, UUID)
  TO service_role;

COMMIT;
