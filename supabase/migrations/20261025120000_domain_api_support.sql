-- Server API support for the workspace-owned domain pool.
-- DNS/HTTPS readiness is never inferred from an existing database row.
BEGIN;

ALTER TABLE public.workspace_domain_hosts
  DROP CONSTRAINT workspace_domain_hosts_name_check,
  ADD COLUMN technical_status TEXT NOT NULL DEFAULT 'not_configured'
    CHECK (technical_status IN ('not_configured', 'checking', 'ready', 'error')),
  ADD COLUMN technical_checked_at TIMESTAMPTZ,
  ADD COLUMN technical_error_code TEXT
    CHECK (technical_error_code IS NULL OR technical_error_code IN (
      'DNS_OR_HTTPS_UNAVAILABLE', 'TIMEOUT'
    )),
  ADD CONSTRAINT workspace_domain_hosts_name_check CHECK (
    char_length(hostname) BETWEEN 3 AND 253
    AND hostname = lower(hostname)
    AND hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    AND (
      hostname = apex_domain
      OR right(hostname, char_length(apex_domain) + 1) = '.' || apex_domain
    )
  ),
  ADD CONSTRAINT workspace_domain_hosts_verification_state_check CHECK (
    (technical_status = 'checking' AND technical_checked_at IS NULL AND technical_error_code IS NULL)
    OR (technical_status = 'ready' AND technical_checked_at IS NOT NULL AND technical_error_code IS NULL)
    OR (technical_status = 'error' AND technical_checked_at IS NOT NULL AND technical_error_code IS NOT NULL)
    OR (technical_status = 'not_configured' AND technical_checked_at IS NULL AND technical_error_code IS NULL)
  );

-- Existing addresses have no recorded live check. Preserve their ownership and
-- publication pointers, but do not infer readiness from legacy connection_status.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.workspace_domains AS domain
    JOIN public.workspace_domain_hosts AS host ON host.hostname = domain.domain_name
  ) THEN
    RAISE EXCEPTION 'A domain root conflicts with an existing host; resolve the hostname before applying this migration';
  END IF;
END;
$$;

INSERT INTO public.workspace_domain_hosts (
  workspace_id, domain_id, apex_domain, hostname, status,
  technical_status, created_by_user_id
)
SELECT
  domain.workspace_id, domain.id, domain.domain_name, domain.domain_name,
  'available', 'not_configured', domain.created_by_user_id
FROM public.workspace_domains AS domain
WHERE NOT EXISTS (
  SELECT 1
  FROM public.workspace_domain_hosts AS host
  WHERE host.workspace_id = domain.workspace_id
    AND host.domain_id = domain.id
    AND host.hostname = domain.domain_name
);

CREATE FUNCTION public.create_workspace_domain_with_root_host(
  p_workspace_id UUID,
  p_domain_name TEXT,
  p_created_by_user_id UUID
)
RETURNS TABLE(domain_id UUID, root_host_id UUID, result TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_domain_id UUID;
  v_host_id UUID;
BEGIN
  IF p_workspace_id IS NULL OR p_created_by_user_id IS NULL
     OR p_domain_name IS NULL OR char_length(p_domain_name) NOT BETWEEN 3 AND 253
     OR p_domain_name <> lower(p_domain_name)
     OR p_domain_name !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' THEN
    RAISE EXCEPTION 'Invalid domain registration request' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_domain_name, 0));

  IF EXISTS (
    SELECT 1 FROM public.workspace_domain_hosts AS host
    WHERE host.hostname = p_domain_name
  ) AND NOT EXISTS (
    SELECT 1 FROM public.workspace_domains AS domain
    WHERE domain.workspace_id = p_workspace_id
      AND domain.domain_name = p_domain_name
  ) THEN
    RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'conflict'::TEXT;
    RETURN;
  END IF;

  SELECT domain.id INTO v_domain_id
  FROM public.workspace_domains AS domain
  WHERE domain.domain_name = p_domain_name;

  IF FOUND THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_domains AS domain
      WHERE domain.id = v_domain_id AND domain.workspace_id = p_workspace_id
    ) THEN
      RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'conflict'::TEXT;
      RETURN;
    END IF;

    SELECT host.id INTO v_host_id
    FROM public.workspace_domain_hosts AS host
    WHERE host.workspace_id = p_workspace_id
      AND host.domain_id = v_domain_id
      AND host.hostname = p_domain_name;

    IF NOT FOUND THEN
      INSERT INTO public.workspace_domain_hosts (
        workspace_id, domain_id, apex_domain, hostname, created_by_user_id
      ) VALUES (
        p_workspace_id, v_domain_id, p_domain_name, p_domain_name, p_created_by_user_id
      ) ON CONFLICT (hostname) DO NOTHING
      RETURNING id INTO v_host_id;
      IF v_host_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, 'conflict'::TEXT;
        RETURN;
      END IF;
    END IF;

    RETURN QUERY SELECT v_domain_id, v_host_id, 'exists'::TEXT;
    RETURN;
  END IF;

  INSERT INTO public.workspace_domains (workspace_id, domain_name, created_by_user_id)
  VALUES (p_workspace_id, p_domain_name, p_created_by_user_id)
  RETURNING id INTO v_domain_id;

  INSERT INTO public.workspace_domain_hosts (
    workspace_id, domain_id, apex_domain, hostname, created_by_user_id
  ) VALUES (
    p_workspace_id, v_domain_id, p_domain_name, p_domain_name, p_created_by_user_id
  ) RETURNING id INTO v_host_id;

  RETURN QUERY SELECT v_domain_id, v_host_id, 'created'::TEXT;
END;
$$;

CREATE FUNCTION public.add_workspace_domain_hosts(
  p_workspace_id UUID,
  p_domain_id UUID,
  p_hostnames TEXT[]
)
RETURNS TABLE(input_index INTEGER, hostname TEXT, outcome TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_apex_domain TEXT;
  v_domain_status TEXT;
  v_candidate TEXT;
  v_index INTEGER;
  v_existing_workspace UUID;
  v_existing_domain UUID;
BEGIN
  IF p_workspace_id IS NULL OR p_domain_id IS NULL OR p_hostnames IS NULL
     OR cardinality(p_hostnames) > 500 THEN
    RAISE EXCEPTION 'Invalid host batch' USING ERRCODE = '22023';
  END IF;

  SELECT domain.domain_name, domain.connection_status
    INTO v_apex_domain, v_domain_status
  FROM public.workspace_domains AS domain
  WHERE domain.workspace_id = p_workspace_id AND domain.id = p_domain_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_domain_status <> 'active' THEN
    RAISE EXCEPTION 'Verify the root domain before adding subdomains' USING ERRCODE = '23514';
  END IF;

  FOR v_candidate, v_index IN
    SELECT batch.hostname, batch.ordinality::INTEGER
    FROM unnest(p_hostnames) WITH ORDINALITY AS batch(hostname, ordinality)
  LOOP
    IF v_candidate IS NULL OR v_candidate <> lower(v_candidate)
       OR char_length(v_candidate) NOT BETWEEN 3 AND 253
       OR v_candidate !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
       OR v_candidate = v_apex_domain
       OR right(v_candidate, char_length(v_apex_domain) + 1) <> '.' || v_apex_domain THEN
      RAISE EXCEPTION 'Invalid subdomain hostname' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_advisory_xact_lock(hashtextextended(v_candidate, 0));
    v_existing_workspace := NULL;
    v_existing_domain := NULL;
    SELECT host.workspace_id, host.domain_id
      INTO v_existing_workspace, v_existing_domain
    FROM public.workspace_domain_hosts AS host
    WHERE host.hostname = v_candidate;

    IF FOUND THEN
      IF v_existing_workspace = p_workspace_id AND v_existing_domain = p_domain_id THEN
        RETURN QUERY SELECT v_index, v_candidate, 'already_exists'::TEXT;
      ELSE
        RETURN QUERY SELECT v_index, v_candidate, 'conflict'::TEXT;
      END IF;
      CONTINUE;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.workspace_domains AS root_domain
      WHERE root_domain.domain_name = v_candidate
    ) THEN
      RETURN QUERY SELECT v_index, v_candidate, 'conflict'::TEXT;
      CONTINUE;
    END IF;

    INSERT INTO public.workspace_domain_hosts (
      workspace_id, domain_id, apex_domain, hostname
    ) VALUES (
      p_workspace_id, p_domain_id, v_apex_domain, v_candidate
    ) ON CONFLICT (hostname) DO NOTHING;

    IF FOUND THEN
      RETURN QUERY SELECT v_index, v_candidate, 'added'::TEXT;
    ELSE
      SELECT host.workspace_id, host.domain_id
        INTO v_existing_workspace, v_existing_domain
      FROM public.workspace_domain_hosts AS host
      WHERE host.hostname = v_candidate;
      IF v_existing_workspace = p_workspace_id AND v_existing_domain = p_domain_id THEN
        RETURN QUERY SELECT v_index, v_candidate, 'already_exists'::TEXT;
      ELSE
        RETURN QUERY SELECT v_index, v_candidate, 'conflict'::TEXT;
      END IF;
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION public.record_workspace_domain_host_verification(
  p_workspace_id UUID,
  p_domain_host_id UUID,
  p_technical_status TEXT,
  p_error_code TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_domain_id UUID;
  v_hostname TEXT;
  v_apex_domain TEXT;
BEGIN
  IF p_technical_status IS NULL OR p_technical_status NOT IN ('checking', 'ready', 'error')
     OR (p_technical_status = 'error' AND p_error_code NOT IN (
       'DNS_OR_HTTPS_UNAVAILABLE', 'TIMEOUT'
     ))
     OR (p_technical_status = 'error' AND p_error_code IS NULL)
     OR (p_technical_status <> 'error' AND p_error_code IS NOT NULL) THEN
    RAISE EXCEPTION 'Invalid domain verification result' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace_domain_hosts AS host
  SET technical_status = p_technical_status,
      technical_checked_at = CASE
        WHEN p_technical_status = 'checking' THEN NULL ELSE clock_timestamp()
      END,
      technical_error_code = p_error_code
  WHERE host.workspace_id = p_workspace_id
    AND host.id = p_domain_host_id
    AND host.status <> 'disabled'
  RETURNING host.domain_id, host.hostname, host.apex_domain
    INTO v_domain_id, v_hostname, v_apex_domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;

  IF v_hostname = v_apex_domain THEN
    UPDATE public.workspace_domains AS domain
    SET connection_status = CASE
      WHEN p_technical_status = 'ready' THEN 'active'
      WHEN p_technical_status = 'error' AND domain.connection_status <> 'active' THEN 'error'
      ELSE domain.connection_status
    END
    WHERE domain.workspace_id = p_workspace_id AND domain.id = v_domain_id;
  END IF;

  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_workspace_domain_host(
  p_workspace_id UUID,
  p_domain_host_id UUID,
  p_landing_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_reserved_landing_id UUID;
  v_domain_status TEXT;
  v_technical_status TEXT;
  v_checked_at TIMESTAMPTZ;
  v_current_version_id UUID;
BEGIN
  IF p_workspace_id IS NULL OR p_domain_host_id IS NULL OR p_landing_id IS NULL THEN
    RAISE EXCEPTION 'Workspace, host, and landing are required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_landings AS landing
    JOIN public.workspace_offers AS offer
      ON offer.workspace_id = landing.workspace_id AND offer.id = landing.offer_id
    WHERE landing.workspace_id = p_workspace_id
      AND landing.id = p_landing_id
      AND landing.deletion_started_at IS NULL
      AND offer.is_active
  ) THEN
    RAISE EXCEPTION 'Landing is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT host.status, host.reserved_landing_id, parent_domain.connection_status,
         host.technical_status, host.technical_checked_at,
         host.current_publication_version_id
    INTO v_status, v_reserved_landing_id, v_domain_status,
         v_technical_status, v_checked_at, v_current_version_id
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_domains AS parent_domain
    ON parent_domain.workspace_id = host.workspace_id AND parent_domain.id = host.domain_id
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
  FOR UPDATE OF host, parent_domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'reserved' AND v_reserved_landing_id = p_landing_id THEN
    RETURN TRUE;
  END IF;
  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'Domain address is already reserved or disabled' USING ERRCODE = '23505';
  END IF;
  IF v_current_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Published addresses require an explicit unpublish operation'
      USING ERRCODE = '23514';
  END IF;
  IF v_domain_status <> 'active' OR v_technical_status <> 'ready'
     OR v_checked_at IS NULL OR v_checked_at < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'A recent successful DNS and HTTPS check is required'
      USING ERRCODE = '23514';
  END IF;

  UPDATE public.workspace_domain_hosts AS host
  SET status = 'reserved', reserved_landing_id = p_landing_id
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
    AND host.status = 'available' AND host.current_publication_version_id IS NULL
    AND host.technical_status = 'ready'
    AND host.technical_checked_at >= now() - INTERVAL '5 minutes';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address reservation changed concurrently' USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.release_workspace_domain_host(
  p_workspace_id UUID,
  p_domain_host_id UUID,
  p_landing_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
  v_reserved_landing_id UUID;
  v_current_version_id UUID;
BEGIN
  IF p_workspace_id IS NULL OR p_domain_host_id IS NULL OR p_landing_id IS NULL THEN
    RAISE EXCEPTION 'Workspace, host, and landing are required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_landings AS landing
    WHERE landing.workspace_id = p_workspace_id AND landing.id = p_landing_id
  ) THEN
    RAISE EXCEPTION 'Landing is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT host.status, host.reserved_landing_id, host.current_publication_version_id
    INTO v_status, v_reserved_landing_id, v_current_version_id
  FROM public.workspace_domain_hosts AS host
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'available' AND v_current_version_id IS NULL THEN
    RETURN TRUE;
  END IF;
  IF v_current_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'A published address cannot be released without unpublishing it first'
      USING ERRCODE = '23514';
  END IF;
  IF v_status <> 'reserved' OR v_reserved_landing_id <> p_landing_id THEN
    RAISE EXCEPTION 'Reservation does not belong to this landing'
      USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM public.landing_form_allowed_origins AS allowed_origin
  WHERE allowed_origin.workspace_id = p_workspace_id
    AND allowed_origin.domain_host_id = p_domain_host_id;
  UPDATE public.workspace_domain_hosts AS host
  SET status = 'available', reserved_landing_id = NULL
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.switch_landing_publication_version(
  p_workspace_id UUID,
  p_domain_host_id UUID,
  p_publication_version_id UUID,
  p_expected_current_version_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_current_version_id UUID;
  v_domain_status TEXT;
  v_technical_status TEXT;
  v_checked_at TIMESTAMPTZ;
BEGIN
  IF p_workspace_id IS NULL OR p_domain_host_id IS NULL OR p_publication_version_id IS NULL THEN
    RAISE EXCEPTION 'Workspace, host, and publication version are required' USING ERRCODE = '22023';
  END IF;

  SELECT host.current_publication_version_id, parent_domain.connection_status,
         host.technical_status, host.technical_checked_at
    INTO v_current_version_id, v_domain_status, v_technical_status, v_checked_at
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_domains AS parent_domain
    ON parent_domain.workspace_id = host.workspace_id AND parent_domain.id = host.domain_id
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
  FOR UPDATE OF host, parent_domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_domain_status <> 'active' OR v_technical_status <> 'ready'
     OR v_checked_at IS NULL OR v_checked_at < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'A recent successful DNS and HTTPS check is required before publication'
      USING ERRCODE = '23514';
  END IF;
  IF v_current_version_id IS DISTINCT FROM p_expected_current_version_id THEN
    RAISE EXCEPTION 'Current publication changed; reload before switching versions'
      USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_domain_hosts AS host
    JOIN public.landing_publication_versions AS version
      ON version.workspace_id = host.workspace_id
     AND version.domain_host_id = host.id
     AND version.landing_id = host.reserved_landing_id
     AND version.id = p_publication_version_id
    JOIN public.workspace_landings AS landing
      ON landing.workspace_id = version.workspace_id AND landing.id = version.landing_id
    JOIN public.workspace_offers AS offer
      ON offer.workspace_id = landing.workspace_id AND offer.id = landing.offer_id
    WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
      AND host.status = 'reserved' AND host.reserved_landing_id IS NOT NULL
      AND landing.deletion_started_at IS NULL AND offer.is_active
  ) THEN
    RAISE EXCEPTION 'Publication version does not belong to the reserved landing'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace_domain_hosts AS host
  SET current_publication_version_id = p_publication_version_id
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
    AND host.current_publication_version_id IS NOT DISTINCT FROM p_expected_current_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current publication changed; reload before switching versions'
      USING ERRCODE = '40001';
  END IF;
  RETURN p_publication_version_id;
END;
$$;

REVOKE INSERT, UPDATE, DELETE ON public.workspace_domains,
  public.workspace_domain_hosts FROM service_role;
GRANT SELECT ON public.workspace_domains, public.workspace_domain_hosts TO service_role;

REVOKE ALL ON FUNCTION public.create_workspace_domain_with_root_host(UUID, TEXT, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.add_workspace_domain_hosts(UUID, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_workspace_domain_host_verification(UUID, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_workspace_domain_host(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.release_workspace_domain_host(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.switch_landing_publication_version(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.create_workspace_domain_with_root_host(UUID, TEXT, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.add_workspace_domain_hosts(UUID, UUID, TEXT[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.record_workspace_domain_host_verification(UUID, UUID, TEXT, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_workspace_domain_host(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.release_workspace_domain_host(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.switch_landing_publication_version(UUID, UUID, UUID, UUID)
  TO service_role;

COMMENT ON COLUMN public.workspace_domain_hosts.technical_status IS
  'Technical DNS/HTTPS state. ready is written only by the service-only verification RPC after a live HTTPS probe.';
COMMENT ON FUNCTION public.record_workspace_domain_host_verification(UUID, UUID, TEXT, TEXT) IS
  'Service-only record of the result of a real server-side HTTPS probe; error codes are allowlisted.';
COMMENT ON FUNCTION public.release_workspace_domain_host(UUID, UUID, UUID) IS
  'Service-only idempotent release of a same-workspace reservation when no publication is active.';

NOTIFY pgrst, 'reload schema';
COMMIT;
