-- Add Google Ads click attribution and landing conversion settings.
-- Apply only after review against a disposable database; this migration is not
-- applied to DEV or production by this change.
BEGIN;

ALTER TABLE public.leads
  ADD COLUMN gclid TEXT,
  ADD COLUMN gbraid TEXT,
  ADD COLUMN wbraid TEXT,
  ADD CONSTRAINT leads_gclid_length_check
    CHECK (gclid IS NULL OR char_length(gclid) <= 500),
  ADD CONSTRAINT leads_gbraid_length_check
    CHECK (gbraid IS NULL OR char_length(gbraid) <= 500),
  ADD CONSTRAINT leads_wbraid_length_check
    CHECK (wbraid IS NULL OR char_length(wbraid) <= 500);

ALTER TABLE public.workspace_landings
  ADD COLUMN google_ads_conversion_id TEXT,
  ADD COLUMN google_ads_conversion_label TEXT,
  ADD CONSTRAINT workspace_landings_google_ads_settings_check
    CHECK (
      (google_ads_conversion_id IS NULL AND google_ads_conversion_label IS NULL)
      OR (
        google_ads_conversion_id IS NOT NULL
        AND google_ads_conversion_label IS NOT NULL
        AND google_ads_conversion_id ~ '^AW-[0-9]{1,20}$'
        AND google_ads_conversion_label ~ '^[A-Za-z0-9_-]{1,128}$'
      )
    );

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
        OR NEW.tiktok_pixel_id IS DISTINCT FROM OLD.tiktok_pixel_id
        OR NEW.google_ads_conversion_id IS DISTINCT FROM OLD.google_ads_conversion_id
        OR NEW.google_ads_conversion_label IS DISTINCT FROM OLD.google_ads_conversion_label)
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
            OR NEW.tiktok_pixel_id IS DISTINCT FROM OLD.tiktok_pixel_id
            OR NEW.google_ads_conversion_id IS DISTINCT FROM OLD.google_ads_conversion_id
            OR NEW.google_ads_conversion_label IS DISTINCT FROM OLD.google_ads_conversion_label)
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
  google_ads_conversion_id TEXT,
  google_ads_conversion_label TEXT,
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
    landing.google_ads_conversion_id,
    landing.google_ads_conversion_label,
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

COMMENT ON COLUMN public.workspace_landings.google_ads_conversion_id IS
  'Public Google Ads conversion ID embedded in an adapted static landing archive; not a secret.';
COMMENT ON COLUMN public.workspace_landings.google_ads_conversion_label IS
  'Public Google Ads conversion label embedded in an adapted static landing archive; not a secret.';

CREATE FUNCTION public.create_public_landing_lead_with_click_ids(
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

-- Preserve the existing RPC contract for callers that do not send Google click IDs.
CREATE OR REPLACE FUNCTION public.create_public_landing_lead(
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
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT public.create_public_landing_lead_with_click_ids(
    p_public_id, p_request_key_hash, p_ip_hash, p_origin, p_name, p_phone,
    p_phone_normalized, p_email, p_utm_source, p_utm_medium, p_utm_campaign,
    p_utm_content, p_utm_term, p_ttclid, NULL, NULL, NULL, p_sub_id,
    p_delivery_type, p_city_ref, p_city_name, p_warehouse_ref, p_warehouse_name
  );
$$;

REVOKE ALL ON FUNCTION public.create_public_landing_lead_with_click_ids(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_landing_lead_with_click_ids(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

REVOKE ALL ON FUNCTION public.create_public_landing_lead(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_public_landing_lead(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) TO service_role;

COMMENT ON FUNCTION public.create_public_landing_lead_with_click_ids(
  UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT
) IS 'Service-role-only, idempotent landing intake with Google Ads click attribution.';

COMMIT;
