-- Workspace-scoped domains, immutable publication history, and exact published
-- origins. This is schema preparation only; it does not configure DNS, R2, or a Worker.
BEGIN;

ALTER TABLE public.workspace_landings
  ADD CONSTRAINT workspace_landings_workspace_id_id_unique
    UNIQUE (workspace_id, id),
  ADD CONSTRAINT workspace_landings_workspace_id_offer_composite_unique
    UNIQUE (workspace_id, id, offer_id);

ALTER TABLE public.landing_form_integrations
  ADD CONSTRAINT landing_form_integrations_workspace_id_offer_composite_unique
    UNIQUE (workspace_id, id, offer_id);

CREATE TABLE public.workspace_domains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  domain_name TEXT NOT NULL,
  connection_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (connection_status IN ('pending', 'active', 'error')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_domains_name_check CHECK (
    char_length(domain_name) BETWEEN 3 AND 253
    AND domain_name = lower(domain_name)
    AND domain_name ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT workspace_domains_name_unique UNIQUE (domain_name),
  CONSTRAINT workspace_domains_workspace_id_name_unique
    UNIQUE (workspace_id, id, domain_name)
);

CREATE INDEX workspace_domains_workspace_status_idx
  ON public.workspace_domains(workspace_id, connection_status, domain_name);

CREATE TRIGGER workspace_domains_updated_at
  BEFORE UPDATE ON public.workspace_domains
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.workspace_domain_hosts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  domain_id UUID NOT NULL,
  apex_domain TEXT NOT NULL,
  hostname TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'disabled')),
  reserved_landing_id UUID,
  current_publication_version_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_domain_hosts_domain_fk
    FOREIGN KEY (workspace_id, domain_id, apex_domain)
    REFERENCES public.workspace_domains(workspace_id, id, domain_name) ON DELETE RESTRICT,
  CONSTRAINT workspace_domain_hosts_landing_fk
    FOREIGN KEY (workspace_id, reserved_landing_id)
    REFERENCES public.workspace_landings(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_domain_hosts_name_check CHECK (
    char_length(hostname) BETWEEN 3 AND 253
    AND hostname = lower(hostname)
    AND hostname ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    AND hostname <> apex_domain
    AND right(hostname, char_length(apex_domain) + 1) = '.' || apex_domain
  ),
  CONSTRAINT workspace_domain_hosts_reservation_state_check CHECK (
    (status = 'reserved') = (reserved_landing_id IS NOT NULL)
  ),
  CONSTRAINT workspace_domain_hosts_publication_state_check CHECK (
    current_publication_version_id IS NULL OR status = 'reserved'
  ),
  CONSTRAINT workspace_domain_hosts_hostname_unique UNIQUE (hostname),
  CONSTRAINT workspace_domain_hosts_workspace_domain_hostname_unique
    UNIQUE (workspace_id, domain_id, hostname),
  CONSTRAINT workspace_domain_hosts_workspace_id_unique UNIQUE (workspace_id, id),
  CONSTRAINT workspace_domain_hosts_reservation_hostname_unique
    UNIQUE (workspace_id, id, reserved_landing_id, hostname)
);

CREATE INDEX workspace_domain_hosts_domain_status_idx
  ON public.workspace_domain_hosts(workspace_id, domain_id, status, hostname);
CREATE INDEX workspace_domain_hosts_reserved_landing_idx
  ON public.workspace_domain_hosts(workspace_id, reserved_landing_id)
  WHERE reserved_landing_id IS NOT NULL;

CREATE TABLE public.landing_publication_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  domain_host_id UUID NOT NULL,
  landing_id UUID NOT NULL,
  version_number BIGINT NOT NULL CHECK (version_number > 0),
  zip_fingerprint TEXT NOT NULL CHECK (zip_fingerprint ~ '^[0-9a-f]{64}$'),
  build_fingerprint TEXT NOT NULL CHECK (build_fingerprint ~ '^[0-9a-f]{64}$'),
  r2_prefix TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT landing_publication_versions_host_fk
    FOREIGN KEY (workspace_id, domain_host_id)
    REFERENCES public.workspace_domain_hosts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT landing_publication_versions_landing_fk
    FOREIGN KEY (workspace_id, landing_id)
    REFERENCES public.workspace_landings(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT landing_publication_versions_r2_prefix_check CHECK (
    r2_prefix = 'crmonia/landing-sites/' || workspace_id::TEXT || '/'
      || domain_host_id::TEXT || '/' || id::TEXT || '/'
  ),
  CONSTRAINT landing_publication_versions_host_version_unique
    UNIQUE (domain_host_id, version_number),
  CONSTRAINT landing_publication_versions_r2_prefix_unique UNIQUE (r2_prefix),
  CONSTRAINT landing_publication_versions_pointer_target_unique
    UNIQUE (workspace_id, domain_host_id, landing_id, id)
);

CREATE INDEX landing_publication_versions_landing_history_idx
  ON public.landing_publication_versions(workspace_id, landing_id, created_at DESC);

ALTER TABLE public.workspace_domain_hosts
  ADD CONSTRAINT workspace_domain_hosts_current_version_fk
    FOREIGN KEY (
      workspace_id, id, reserved_landing_id, current_publication_version_id
    )
    REFERENCES public.landing_publication_versions(
      workspace_id, domain_host_id, landing_id, id
    ) ON DELETE RESTRICT;

CREATE TABLE public.landing_form_allowed_origins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  integration_id UUID NOT NULL,
  offer_id UUID NOT NULL,
  landing_id UUID NOT NULL,
  domain_host_id UUID NOT NULL,
  hostname TEXT NOT NULL,
  origin TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT landing_form_allowed_origins_form_fk
    FOREIGN KEY (workspace_id, integration_id, offer_id)
    REFERENCES public.landing_form_integrations(workspace_id, id, offer_id)
    ON DELETE RESTRICT,
  CONSTRAINT landing_form_allowed_origins_landing_fk
    FOREIGN KEY (workspace_id, landing_id, offer_id)
    REFERENCES public.workspace_landings(workspace_id, id, offer_id)
    ON DELETE RESTRICT,
  CONSTRAINT landing_form_allowed_origins_host_fk
    FOREIGN KEY (workspace_id, domain_host_id, landing_id, hostname)
    REFERENCES public.workspace_domain_hosts(
      workspace_id, id, reserved_landing_id, hostname
    ) ON DELETE RESTRICT,
  CONSTRAINT landing_form_allowed_origins_exact_https_check
    CHECK (origin = 'https://' || hostname),
  CONSTRAINT landing_form_allowed_origins_origin_unique UNIQUE (origin),
  CONSTRAINT landing_form_allowed_origins_integration_origin_unique
    UNIQUE (integration_id, origin),
  CONSTRAINT landing_form_allowed_origins_host_unique UNIQUE (domain_host_id)
);

CREATE INDEX landing_form_allowed_origins_workspace_offer_idx
  ON public.landing_form_allowed_origins(workspace_id, offer_id);

CREATE FUNCTION public.guard_landing_publication_version_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_domain_hosts AS host
    JOIN public.workspace_landings AS landing
      ON landing.workspace_id = host.workspace_id
     AND landing.id = host.reserved_landing_id
    JOIN public.workspace_offers AS offer
      ON offer.workspace_id = landing.workspace_id
     AND offer.id = landing.offer_id
    WHERE host.workspace_id = NEW.workspace_id
      AND host.id = NEW.domain_host_id
      AND host.status = 'reserved'
      AND host.reserved_landing_id = NEW.landing_id
      AND landing.adapter_status = 'prepared'
      AND landing.adapted_build_fingerprint = NEW.build_fingerprint
      AND landing.deletion_started_at IS NULL
      AND offer.is_active
  ) THEN
    RAISE EXCEPTION 'Publication version must match a prepared landing reserved to this host'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER landing_publication_version_insert_guard
  BEFORE INSERT ON public.landing_publication_versions
  FOR EACH ROW EXECUTE FUNCTION public.guard_landing_publication_version_insert();

CREATE FUNCTION public.prevent_landing_publication_version_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'Publication versions are immutable'
    USING ERRCODE = '42501';
  RETURN NULL;
END;
$$;

CREATE TRIGGER landing_publication_versions_immutable
  BEFORE UPDATE OR DELETE ON public.landing_publication_versions
  FOR EACH ROW EXECUTE FUNCTION public.prevent_landing_publication_version_mutation();

CREATE FUNCTION public.landing_form_domain_host_is_published(
  p_integration_id UUID,
  p_origin TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.landing_form_integrations AS form
    JOIN public.workspace_landings AS landing
      ON landing.workspace_id = form.workspace_id
     AND landing.offer_id = form.offer_id
     AND landing.intake_public_id = form.public_id
    JOIN public.workspace_offers AS offer
      ON offer.workspace_id = form.workspace_id
     AND offer.id = form.offer_id
    JOIN public.workspace_domain_hosts AS host
      ON host.workspace_id = landing.workspace_id
     AND host.reserved_landing_id = landing.id
    JOIN public.workspace_domains AS parent_domain
      ON parent_domain.workspace_id = host.workspace_id
     AND parent_domain.id = host.domain_id
     AND parent_domain.domain_name = host.apex_domain
    JOIN public.landing_publication_versions AS version
      ON version.workspace_id = host.workspace_id
     AND version.domain_host_id = host.id
     AND version.landing_id = landing.id
     AND version.id = host.current_publication_version_id
    WHERE form.id = p_integration_id
      AND form.is_active
      AND offer.is_active
      AND host.status = 'reserved'
      AND parent_domain.connection_status = 'active'
      AND p_origin = 'https://' || host.hostname
  );
$$;

CREATE FUNCTION public.landing_form_domain_origin_is_allowed(
  p_integration_id UUID,
  p_origin TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.landing_form_allowed_origins AS allowed_origin
    WHERE allowed_origin.integration_id = p_integration_id
      AND allowed_origin.origin = p_origin
      AND public.landing_form_domain_host_is_published(p_integration_id, p_origin)
  );
$$;

CREATE FUNCTION public.guard_landing_form_allowed_origin_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.landing_form_domain_host_is_published(NEW.integration_id, NEW.origin) THEN
    RAISE EXCEPTION 'Only an active published hostname can be allowed for landing intake'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER landing_form_allowed_origins_insert_guard
  BEFORE INSERT ON public.landing_form_allowed_origins
  FOR EACH ROW EXECUTE FUNCTION public.guard_landing_form_allowed_origin_insert();

CREATE FUNCTION public.reserve_workspace_domain_host(
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
BEGIN
  IF p_workspace_id IS NULL OR p_domain_host_id IS NULL OR p_landing_id IS NULL THEN
    RAISE EXCEPTION 'Workspace, host, and landing are required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_landings AS landing
    JOIN public.workspace_offers AS offer
      ON offer.workspace_id = landing.workspace_id
     AND offer.id = landing.offer_id
    WHERE landing.workspace_id = p_workspace_id
      AND landing.id = p_landing_id
      AND landing.deletion_started_at IS NULL
      AND offer.is_active
  ) THEN
    RAISE EXCEPTION 'Landing is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT host.status, host.reserved_landing_id, parent_domain.connection_status
    INTO v_status, v_reserved_landing_id, v_domain_status
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_domains AS parent_domain
    ON parent_domain.workspace_id = host.workspace_id
   AND parent_domain.id = host.domain_id
  WHERE host.workspace_id = p_workspace_id
    AND host.id = p_domain_host_id
  FOR UPDATE OF host;

  IF NOT FOUND OR v_domain_status = 'error' THEN
    RAISE EXCEPTION 'Domain host is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'reserved' AND v_reserved_landing_id = p_landing_id THEN
    RETURN TRUE;
  END IF;

  IF v_status <> 'available' THEN
    RAISE EXCEPTION 'Domain host is already reserved or disabled' USING ERRCODE = '23505';
  END IF;

  UPDATE public.workspace_domain_hosts AS host
  SET status = 'reserved', reserved_landing_id = p_landing_id
  WHERE host.workspace_id = p_workspace_id
    AND host.id = p_domain_host_id
    AND host.status = 'available'
    AND host.current_publication_version_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain host reservation changed concurrently' USING ERRCODE = '40001';
  END IF;

  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.switch_landing_publication_version(
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
BEGIN
  IF p_workspace_id IS NULL OR p_domain_host_id IS NULL OR p_publication_version_id IS NULL THEN
    RAISE EXCEPTION 'Workspace, host, and publication version are required' USING ERRCODE = '22023';
  END IF;

  SELECT host.current_publication_version_id, parent_domain.connection_status
    INTO v_current_version_id, v_domain_status
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_domains AS parent_domain
    ON parent_domain.workspace_id = host.workspace_id
   AND parent_domain.id = host.domain_id
  WHERE host.workspace_id = p_workspace_id
    AND host.id = p_domain_host_id
  FOR UPDATE OF host, parent_domain;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain host is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_domain_status <> 'active' THEN
    RAISE EXCEPTION 'Domain must be active before publication' USING ERRCODE = '23514';
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
      ON landing.workspace_id = version.workspace_id
     AND landing.id = version.landing_id
    WHERE host.workspace_id = p_workspace_id
      AND host.id = p_domain_host_id
      AND host.status = 'reserved'
      AND host.reserved_landing_id IS NOT NULL
      AND landing.deletion_started_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Publication version does not belong to the reserved landing'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace_domain_hosts AS host
  SET current_publication_version_id = p_publication_version_id
  WHERE host.workspace_id = p_workspace_id
    AND host.id = p_domain_host_id
    AND host.current_publication_version_id IS NOT DISTINCT FROM p_expected_current_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Current publication changed; reload before switching versions'
      USING ERRCODE = '40001';
  END IF;

  RETURN p_publication_version_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_landing_origin_allowed(p_origin TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.landing_form_integrations AS form
    WHERE form.allowed_origin = p_origin
  ) OR EXISTS (
    SELECT 1
    FROM public.landing_form_allowed_origins AS allowed_origin
    WHERE allowed_origin.origin = p_origin
      AND public.landing_form_domain_origin_is_allowed(
        allowed_origin.integration_id, p_origin
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_landing_form_origin_allowed(
  p_public_id UUID,
  p_origin TEXT
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.landing_form_integrations AS form
    WHERE form.public_id = p_public_id
      AND form.allowed_origin = p_origin
  ) OR EXISTS (
    SELECT 1
    FROM public.landing_form_integrations AS form
    JOIN public.landing_form_allowed_origins AS allowed_origin
      ON allowed_origin.integration_id = form.id
    WHERE form.public_id = p_public_id
      AND allowed_origin.origin = p_origin
      AND public.landing_form_domain_origin_is_allowed(form.id, p_origin)
  );
$$;

-- Preserve the existing service-role intake RPC contract; only add exact,
-- currently published domain origins alongside the legacy single origin.
CREATE OR REPLACE FUNCTION public.create_public_landing_lead_with_click_ids(
  p_public_id UUID,
  p_request_key_hash TEXT,
  p_ip_hash TEXT,
  p_origin TEXT,
  p_name TEXT,
  p_phone TEXT,
  p_phone_normalized TEXT,
  p_email TEXT,
  p_utm_source TEXT,
  p_utm_medium TEXT,
  p_utm_campaign TEXT,
  p_utm_content TEXT,
  p_utm_term TEXT,
  p_ttclid TEXT,
  p_gclid TEXT,
  p_gbraid TEXT,
  p_wbraid TEXT,
  p_sub_id TEXT,
  p_delivery_type TEXT,
  p_city_ref TEXT,
  p_city_name TEXT,
  p_warehouse_ref TEXT,
  p_warehouse_name TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_form public.landing_form_integrations%ROWTYPE;
  v_lead_id UUID;
  v_window TIMESTAMPTZ := date_trunc('minute', now());
  v_hits INTEGER;
BEGIN
  IF p_public_id IS NULL
     OR p_request_key_hash IS NULL OR p_request_key_hash !~ '^[0-9a-f]{64}$'
     OR p_ip_hash IS NULL OR p_ip_hash !~ '^[0-9a-f]{64}$'
     OR p_name IS NULL OR char_length(btrim(p_name)) NOT BETWEEN 1 AND 120
     OR p_phone IS NULL OR char_length(btrim(p_phone)) NOT BETWEEN 1 AND 40
     OR p_phone_normalized IS NULL OR p_phone_normalized !~ '^\+380[0-9]{9}$'
     OR p_email IS NOT NULL AND char_length(p_email) > 255
     OR p_utm_source IS NOT NULL AND char_length(p_utm_source) > 200
     OR p_utm_medium IS NOT NULL AND char_length(p_utm_medium) > 200
     OR p_utm_campaign IS NOT NULL AND char_length(p_utm_campaign) > 200
     OR p_utm_content IS NOT NULL AND char_length(p_utm_content) > 200
     OR p_utm_term IS NOT NULL AND char_length(p_utm_term) > 200
     OR p_ttclid IS NOT NULL AND char_length(p_ttclid) > 500
     OR p_gclid IS NOT NULL AND char_length(p_gclid) > 500
     OR p_gbraid IS NOT NULL AND char_length(p_gbraid) > 500
     OR p_wbraid IS NOT NULL AND char_length(p_wbraid) > 500
     OR p_sub_id IS NOT NULL AND char_length(p_sub_id) > 200
     OR p_delivery_type IS NOT NULL AND p_delivery_type NOT IN ('warehouse', 'postomat', 'address')
     OR p_city_ref IS NOT NULL AND char_length(p_city_ref) > 120
     OR p_city_name IS NOT NULL AND char_length(p_city_name) > 200
     OR p_warehouse_ref IS NOT NULL AND char_length(p_warehouse_ref) > 120
     OR p_warehouse_name IS NOT NULL AND char_length(p_warehouse_name) > 200 THEN
    RAISE EXCEPTION 'Invalid landing lead data' USING ERRCODE = '22023';
  END IF;

  SELECT form.* INTO v_form
  FROM public.landing_form_integrations AS form
  JOIN public.workspace_offers AS offer
    ON offer.workspace_id = form.workspace_id
   AND offer.id = form.offer_id
  WHERE form.public_id = p_public_id
    AND form.is_active
    AND offer.is_active
    AND (
      p_origin IS NULL
      OR form.allowed_origin = p_origin
      OR public.landing_form_domain_origin_is_allowed(form.id, p_origin)
    );
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_form.id::TEXT || ':' || p_request_key_hash, 0));
  SELECT request.lead_id INTO v_lead_id
  FROM public.landing_intake_requests AS request
  WHERE request.integration_id = v_form.id
    AND request.request_key_hash = p_request_key_hash;
  IF FOUND THEN RETURN 'accepted'; END IF;

  INSERT INTO public.landing_intake_rate_limits AS rate_limit (
    rate_key, window_start, request_count
  ) VALUES ('form:' || v_form.id::TEXT || ':' || p_ip_hash, v_window, 1)
  ON CONFLICT (rate_key, window_start) DO UPDATE
  SET request_count = rate_limit.request_count + 1
  RETURNING request_count INTO v_hits;
  IF v_hits > 5 THEN RETURN 'rate_limited'; END IF;

  INSERT INTO public.leads (
    workspace_id, team_id, operator_id, offer_id,
    user_id, created_by_user_id, created_via, lead_status,
    name, email, phone, phone_normalized, traffic_source,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, ttclid,
    gclid, gbraid, wbraid, sub_id,
    delivery_provider, delivery_type, delivery_city_ref, delivery_city_name,
    delivery_warehouse_ref, delivery_warehouse_name
  ) VALUES (
    v_form.workspace_id, NULL, NULL, v_form.offer_id,
    NULL, NULL, 'landing', 'New',
    btrim(p_name), NULLIF(btrim(p_email), ''), btrim(p_phone), p_phone_normalized,
    'landing', NULLIF(btrim(p_utm_source), ''), NULLIF(btrim(p_utm_medium), ''),
    NULLIF(btrim(p_utm_campaign), ''), NULLIF(btrim(p_utm_content), ''),
    NULLIF(btrim(p_utm_term), ''), NULLIF(btrim(p_ttclid), ''),
    NULLIF(btrim(p_gclid), ''), NULLIF(btrim(p_gbraid), ''), NULLIF(btrim(p_wbraid), ''),
    NULLIF(btrim(p_sub_id), ''),
    CASE WHEN p_delivery_type IS NOT NULL OR p_city_ref IS NOT NULL
      OR p_city_name IS NOT NULL OR p_warehouse_ref IS NOT NULL
      OR p_warehouse_name IS NOT NULL THEN 'nova_poshta' ELSE NULL END,
    p_delivery_type, NULLIF(btrim(p_city_ref), ''), NULLIF(btrim(p_city_name), ''),
    NULLIF(btrim(p_warehouse_ref), ''), NULLIF(btrim(p_warehouse_name), '')
  ) RETURNING id INTO v_lead_id;

  INSERT INTO public.landing_intake_requests (integration_id, request_key_hash, lead_id)
  VALUES (v_form.id, p_request_key_hash, v_lead_id);

  DELETE FROM public.landing_intake_requests
  WHERE created_at < now() - interval '30 days';
  DELETE FROM public.landing_intake_rate_limits
  WHERE window_start < now() - interval '2 days';

  RETURN 'accepted';
END;
$$;

ALTER TABLE public.workspace_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_domain_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_publication_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_form_allowed_origins ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspace_domains_read_authorized
  ON public.workspace_domains FOR SELECT TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'landing_pages.read', NULL, NULL, NULL)
    OR public.has_workspace_permission(workspace_id, 'landing_pages.manage', NULL, NULL, NULL)
  );

CREATE POLICY workspace_domain_hosts_read_authorized
  ON public.workspace_domain_hosts FOR SELECT TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'landing_pages.read', NULL, NULL, NULL)
    OR public.has_workspace_permission(workspace_id, 'landing_pages.manage', NULL, NULL, NULL)
  );

CREATE POLICY landing_publication_versions_read_authorized
  ON public.landing_publication_versions FOR SELECT TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'landing_pages.read', NULL, NULL, NULL)
    OR public.has_workspace_permission(workspace_id, 'landing_pages.manage', NULL, NULL, NULL)
  );

CREATE POLICY landing_form_allowed_origins_read_authorized
  ON public.landing_form_allowed_origins FOR SELECT TO authenticated
  USING (
    public.has_workspace_permission(workspace_id, 'landing_pages.read', NULL, NULL, NULL)
    OR public.has_workspace_permission(workspace_id, 'landing_pages.manage', NULL, NULL, NULL)
  );

REVOKE ALL ON public.workspace_domains,
  public.workspace_domain_hosts,
  public.landing_publication_versions,
  public.landing_form_allowed_origins
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON public.workspace_domains,
  public.workspace_domain_hosts,
  public.landing_publication_versions,
  public.landing_form_allowed_origins TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.workspace_domains TO service_role;
GRANT SELECT, INSERT ON public.workspace_domain_hosts,
  public.landing_publication_versions TO service_role;
GRANT SELECT, INSERT, DELETE ON public.landing_form_allowed_origins TO service_role;

REVOKE ALL ON FUNCTION public.guard_landing_publication_version_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.prevent_landing_publication_version_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.landing_form_domain_host_is_published(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.landing_form_domain_origin_is_allowed(UUID, TEXT)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.guard_landing_form_allowed_origin_insert()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.reserve_workspace_domain_host(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.switch_landing_publication_version(UUID, UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.is_landing_origin_allowed(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_landing_form_origin_allowed(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_public_landing_lead_with_click_ids(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.landing_form_domain_host_is_published(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.landing_form_domain_origin_is_allowed(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_workspace_domain_host(UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.switch_landing_publication_version(UUID, UUID, UUID, UUID)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.is_landing_origin_allowed(TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.is_landing_form_origin_allowed(UUID, TEXT)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.create_public_landing_lead_with_click_ids(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON TABLE public.workspace_domains IS
  'Workspace-owned apex domains; DNS and HTTPS status is managed by a future server-side publication flow.';
COMMENT ON TABLE public.workspace_domain_hosts IS
  'Exact hostnames under a workspace domain. Hostnames are globally unique and reserved independently of offers.';
COMMENT ON TABLE public.landing_publication_versions IS
  'Immutable private R2 publication artifacts. Current host pointer changes are the atomic publish and rollback operation.';
COMMENT ON TABLE public.landing_form_allowed_origins IS
  'Exact HTTPS origins allowed for an active published landing form; legacy landing_form_integrations.allowed_origin remains supported.';
COMMENT ON COLUMN public.workspace_domain_hosts.current_publication_version_id IS
  'Atomic active-version pointer; composite foreign key requires the version to match the reserved workspace, host, and landing.';
COMMENT ON COLUMN public.landing_publication_versions.r2_prefix IS
  'Private R2 key prefix. It contains immutable version artifacts and never stores Cloudflare credentials.';
COMMENT ON FUNCTION public.switch_landing_publication_version(UUID, UUID, UUID, UUID) IS
  'Service-role-only compare-and-swap of a host publication pointer; pass the current version as expected value for atomic publish or rollback.';
COMMENT ON FUNCTION public.reserve_workspace_domain_host(UUID, UUID, UUID) IS
  'Service-role-only atomic reservation of an available hostname for a same-workspace landing after API RBAC checks.';
COMMENT ON FUNCTION public.is_landing_origin_allowed(TEXT) IS
  'Service-role-only origin check preserving legacy configured origins and allowing new origins only for active published hosts.';

NOTIFY pgrst, 'reload schema';
COMMIT;
