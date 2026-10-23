-- Controlled public intake for owned HTML landing pages.
-- No anonymous role can insert directly into leads or access integration data.
BEGIN;

CREATE TABLE public.landing_form_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL,
  offer_id UUID NOT NULL,
  public_id UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  allowed_origin TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT landing_form_offer_scope_fk
    FOREIGN KEY (workspace_id, offer_id)
    REFERENCES public.workspace_offers(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT landing_form_one_per_offer UNIQUE (workspace_id, offer_id),
  CONSTRAINT landing_form_origin_check CHECK (
    allowed_origin !~ '\*'
    AND (
      allowed_origin ~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'
      OR allowed_origin ~* '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$'
    )
  )
);

CREATE INDEX landing_form_public_active_idx
  ON public.landing_form_integrations(public_id)
  WHERE is_active;

CREATE TABLE public.landing_intake_requests (
  integration_id UUID NOT NULL REFERENCES public.landing_form_integrations(id) ON DELETE CASCADE,
  request_key_hash TEXT NOT NULL CHECK (request_key_hash ~ '^[0-9a-f]{64}$'),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (integration_id, request_key_hash)
);

CREATE INDEX landing_intake_requests_created_idx
  ON public.landing_intake_requests(created_at);

CREATE TABLE public.landing_intake_rate_limits (
  rate_key TEXT NOT NULL CHECK (char_length(rate_key) BETWEEN 1 AND 140),
  window_start TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL CHECK (request_count > 0),
  PRIMARY KEY (rate_key, window_start)
);

ALTER TABLE public.landing_form_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_intake_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.landing_intake_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.landing_form_integrations,
  public.landing_intake_requests, public.landing_intake_rate_limits
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER landing_form_integrations_updated_at
  BEFORE UPDATE ON public.landing_form_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE FUNCTION public.get_landing_form_config(
  p_workspace_id UUID,
  p_offer_id UUID
)
RETURNS TABLE (public_id UUID, allowed_origin TEXT, is_active BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, p_offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT f.public_id, f.allowed_origin, f.is_active
  FROM public.landing_form_integrations AS f
  WHERE f.workspace_id = p_workspace_id AND f.offer_id = p_offer_id;
END;
$$;

CREATE FUNCTION public.create_landing_form_config(
  p_workspace_id UUID,
  p_offer_id UUID,
  p_allowed_origin TEXT
)
RETURNS TABLE (public_id UUID, allowed_origin TEXT, is_active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_form public.landing_form_integrations%ROWTYPE;
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, p_offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_allowed_origin IS NULL OR char_length(p_allowed_origin) > 255
     OR p_allowed_origin !~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'
     AND p_allowed_origin !~* '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$' THEN
    RAISE EXCEPTION 'Invalid origin' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspace_offers AS o
    WHERE o.id = p_offer_id AND o.workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Offer not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.landing_form_integrations AS f (
    workspace_id, offer_id, public_id, allowed_origin,
    is_active, created_by_user_id
  ) VALUES (
    p_workspace_id, p_offer_id, gen_random_uuid(), p_allowed_origin, TRUE, v_actor
  )
  ON CONFLICT (workspace_id, offer_id) DO UPDATE
  SET public_id = gen_random_uuid(), allowed_origin = EXCLUDED.allowed_origin,
      is_active = TRUE, created_by_user_id = v_actor
  RETURNING f.* INTO v_form;

  INSERT INTO public.workspace_access_audit (workspace_id, actor_id, action, details)
  VALUES (
    p_workspace_id, v_actor, 'Landing form created',
    jsonb_build_object('offer_id', p_offer_id, 'public_id', v_form.public_id)
  );

  RETURN QUERY SELECT v_form.public_id, v_form.allowed_origin, v_form.is_active;
END;
$$;

CREATE FUNCTION public.deactivate_landing_form_config(
  p_workspace_id UUID,
  p_offer_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_public_id UUID;
BEGIN
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, p_offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.landing_form_integrations AS f
  SET is_active = FALSE
  WHERE f.workspace_id = p_workspace_id AND f.offer_id = p_offer_id
  RETURNING f.public_id INTO v_public_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Landing form not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.workspace_access_audit (workspace_id, actor_id, action, details)
  VALUES (
    p_workspace_id, v_actor, 'Landing form deactivated',
    jsonb_build_object('offer_id', p_offer_id, 'public_id', v_public_id)
  );
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.is_landing_origin_allowed(p_origin TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.landing_form_integrations AS f
    WHERE f.allowed_origin = p_origin
  );
$$;

CREATE FUNCTION public.is_landing_form_origin_allowed(
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
    FROM public.landing_form_integrations AS f
    WHERE f.public_id = p_public_id AND f.allowed_origin = p_origin
  );
$$;

CREATE FUNCTION public.consume_landing_intake_ip_limit(p_ip_hash TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_window TIMESTAMPTZ := date_trunc('minute', now());
  v_hits INTEGER;
BEGIN
  IF p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid client fingerprint' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.landing_intake_rate_limits AS r (rate_key, window_start, request_count)
  VALUES ('ip:' || p_ip_hash, v_window, 1)
  ON CONFLICT (rate_key, window_start) DO UPDATE
  SET request_count = r.request_count + 1
  RETURNING request_count INTO v_hits;
  IF v_hits = 100 THEN
    DELETE FROM public.landing_intake_rate_limits
    WHERE window_start < now() - interval '2 days';
  END IF;
  RETURN v_hits <= 60;
END;
$$;

CREATE FUNCTION public.create_public_landing_lead(
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
     OR p_sub_id IS NOT NULL AND char_length(p_sub_id) > 200
     OR p_delivery_type IS NOT NULL AND p_delivery_type NOT IN ('warehouse', 'postomat', 'address')
     OR p_city_ref IS NOT NULL AND char_length(p_city_ref) > 120
     OR p_city_name IS NOT NULL AND char_length(p_city_name) > 200
     OR p_warehouse_ref IS NOT NULL AND char_length(p_warehouse_ref) > 120
     OR p_warehouse_name IS NOT NULL AND char_length(p_warehouse_name) > 200 THEN
    RAISE EXCEPTION 'Invalid landing lead data' USING ERRCODE = '22023';
  END IF;

  SELECT f.* INTO v_form
  FROM public.landing_form_integrations AS f
  JOIN public.workspace_offers AS o
    ON o.workspace_id = f.workspace_id AND o.id = f.offer_id
  WHERE f.public_id = p_public_id AND f.is_active AND o.is_active
    AND (p_origin IS NULL OR f.allowed_origin = p_origin);
  IF NOT FOUND THEN RETURN 'unavailable'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_form.id::TEXT || ':' || p_request_key_hash, 0));
  SELECT r.lead_id INTO v_lead_id
  FROM public.landing_intake_requests AS r
  WHERE r.integration_id = v_form.id AND r.request_key_hash = p_request_key_hash;
  IF FOUND THEN RETURN 'accepted'; END IF;

  INSERT INTO public.landing_intake_rate_limits AS r (rate_key, window_start, request_count)
  VALUES ('form:' || v_form.id::TEXT || ':' || p_ip_hash, v_window, 1)
  ON CONFLICT (rate_key, window_start) DO UPDATE
  SET request_count = r.request_count + 1
  RETURNING request_count INTO v_hits;
  IF v_hits > 5 THEN RETURN 'rate_limited'; END IF;

  INSERT INTO public.leads (
    workspace_id, team_id, operator_id, offer_id,
    user_id, created_by_user_id, created_via, lead_status,
    name, email, phone, phone_normalized, traffic_source,
    utm_source, utm_medium, utm_campaign, utm_content, utm_term, ttclid, sub_id,
    delivery_provider, delivery_type, delivery_city_ref, delivery_city_name,
    delivery_warehouse_ref, delivery_warehouse_name
  ) VALUES (
    v_form.workspace_id, NULL, NULL, v_form.offer_id,
    NULL, NULL, 'landing', 'New',
    btrim(p_name), NULLIF(btrim(p_email), ''), btrim(p_phone), p_phone_normalized,
    'landing', NULLIF(btrim(p_utm_source), ''), NULLIF(btrim(p_utm_medium), ''),
    NULLIF(btrim(p_utm_campaign), ''), NULLIF(btrim(p_utm_content), ''),
    NULLIF(btrim(p_utm_term), ''), NULLIF(btrim(p_ttclid), ''), NULLIF(btrim(p_sub_id), ''),
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

REVOKE ALL ON FUNCTION public.get_landing_form_config(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_landing_form_config(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.deactivate_landing_form_config(UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_landing_origin_allowed(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.is_landing_form_origin_allowed(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_landing_intake_ip_limit(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_public_landing_lead(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.get_landing_form_config(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_landing_form_config(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deactivate_landing_form_config(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_landing_origin_allowed(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_landing_form_origin_allowed(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_landing_intake_ip_limit(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_public_landing_lead(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON TABLE public.landing_form_integrations IS
  'Server-managed connection from one workspace offer to one explicitly allowed landing-page origin.';
COMMENT ON FUNCTION public.create_public_landing_lead(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Service-role-only, rate-limited landing intake. Public API callers cannot insert directly into leads.';

COMMIT;
