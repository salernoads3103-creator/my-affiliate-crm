-- Landing Adapter metadata and inactive intake setup for drafts without a domain.
-- Source ZIPs remain unchanged; adapted ZIPs are private server-managed objects.
BEGIN;

ALTER TABLE public.workspace_landings
  ADD COLUMN adapted_archive_path TEXT,
  ADD COLUMN adapted_archive_bytes BIGINT,
  ADD COLUMN adapter_status TEXT NOT NULL DEFAULT 'not_connected',
  ADD COLUMN adapter_reason TEXT,
  ADD COLUMN intake_public_id UUID,
  ADD CONSTRAINT workspace_landings_adapter_status_check
    CHECK (adapter_status IN (
      'not_connected', 'needs_adaptation', 'configuration_required', 'prepared', 'error'
    )),
  ADD CONSTRAINT workspace_landings_adapted_archive_path_check
    CHECK (
      adapted_archive_path IS NULL
      OR adapted_archive_path ~ (
        '^' || workspace_id::TEXT || '/' || id::TEXT
        || '/adapted-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]zip$'
      )
    ),
  ADD CONSTRAINT workspace_landings_adapted_archive_bytes_check
    CHECK (adapted_archive_bytes IS NULL OR adapted_archive_bytes BETWEEN 1 AND 26214400),
  ADD CONSTRAINT workspace_landings_adapted_archive_pair_check
    CHECK ((adapted_archive_path IS NULL) = (adapted_archive_bytes IS NULL)),
  ADD CONSTRAINT workspace_landings_adapter_archive_state_check
    CHECK (
      adapter_status NOT IN ('configuration_required', 'prepared')
      OR (adapted_archive_path IS NOT NULL AND intake_public_id IS NOT NULL)
    ),
  ADD CONSTRAINT workspace_landings_adapter_reason_check
    CHECK (adapter_status NOT IN ('needs_adaptation', 'error') OR adapter_reason IS NOT NULL);

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
        OR NEW.intake_public_id IS DISTINCT FROM OLD.intake_public_id)
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
            OR NEW.intake_public_id IS DISTINCT FROM OLD.intake_public_id)
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

CREATE FUNCTION public.ensure_landing_form_config_for_adapter(
  p_workspace_id UUID,
  p_landing_id UUID
)
RETURNS TABLE (public_id UUID, allowed_origin TEXT, is_active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_offer_id UUID;
  v_form public.landing_form_integrations%ROWTYPE;
  v_inserted INTEGER;
BEGIN
  SELECT landing.offer_id INTO v_offer_id
  FROM public.workspace_landings AS landing
  JOIN public.workspace_offers AS offer
    ON offer.workspace_id = landing.workspace_id AND offer.id = landing.offer_id
  WHERE landing.workspace_id = p_workspace_id
    AND landing.id = p_landing_id
    AND landing.status = 'draft'
    AND landing.deletion_started_at IS NULL
    AND offer.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Landing draft or active offer not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'landing_pages.manage', NULL, NULL, v_offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  SELECT form.* INTO v_form
  FROM public.landing_form_integrations AS form
  WHERE form.workspace_id = p_workspace_id AND form.offer_id = v_offer_id;
  IF NOT FOUND THEN
    INSERT INTO public.landing_form_integrations (
      workspace_id, offer_id, public_id, allowed_origin, is_active, created_by_user_id
    ) VALUES (
      p_workspace_id, v_offer_id, gen_random_uuid(), 'https://pending.crmonia.invalid', FALSE, v_actor
    )
    ON CONFLICT (workspace_id, offer_id) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      SELECT form.* INTO v_form
      FROM public.landing_form_integrations AS form
      WHERE form.workspace_id = p_workspace_id AND form.offer_id = v_offer_id;
      INSERT INTO public.workspace_access_audit (workspace_id, actor_id, action, details)
      VALUES (
        p_workspace_id,
        v_actor,
        'Landing form prepared',
        jsonb_build_object('offer_id', v_offer_id, 'public_id', v_form.public_id)
      );
    END IF;
    SELECT form.* INTO v_form
    FROM public.landing_form_integrations AS form
    WHERE form.workspace_id = p_workspace_id AND form.offer_id = v_offer_id;
  END IF;

  RETURN QUERY SELECT v_form.public_id, v_form.allowed_origin, v_form.is_active;
END;
$$;

CREATE FUNCTION public.configure_landing_form_origin_for_adapter(
  p_workspace_id UUID,
  p_landing_id UUID,
  p_allowed_origin TEXT
)
RETURNS TABLE (public_id UUID, allowed_origin TEXT, is_active BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_offer_id UUID;
  v_form public.landing_form_integrations%ROWTYPE;
BEGIN
  SELECT landing.offer_id INTO v_offer_id
  FROM public.workspace_landings AS landing
  JOIN public.workspace_offers AS offer
    ON offer.workspace_id = landing.workspace_id AND offer.id = landing.offer_id
  WHERE landing.workspace_id = p_workspace_id
    AND landing.id = p_landing_id
    AND landing.status = 'draft'
    AND landing.deletion_started_at IS NULL
    AND offer.is_active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Landing draft or active offer not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'landing_pages.manage', NULL, NULL, v_offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_allowed_origin IS NULL OR char_length(p_allowed_origin) > 255
     OR p_allowed_origin !~* '^https://[a-z0-9.-]+(:[0-9]{1,5})?$'
     AND p_allowed_origin !~* '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?$' THEN
    RAISE EXCEPTION 'Invalid origin' USING ERRCODE = '22023';
  END IF;

  SELECT form.* INTO v_form
  FROM public.landing_form_integrations AS form
  WHERE form.workspace_id = p_workspace_id AND form.offer_id = v_offer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Landing form is not initialized' USING ERRCODE = 'P0002';
  END IF;
  IF v_form.allowed_origin <> 'https://pending.crmonia.invalid'
     AND v_form.allowed_origin <> p_allowed_origin THEN
    RAISE EXCEPTION 'This offer already uses a different landing origin' USING ERRCODE = '23505';
  END IF;

  UPDATE public.landing_form_integrations AS form
  SET allowed_origin = p_allowed_origin, is_active = TRUE, created_by_user_id = v_actor
  WHERE form.workspace_id = p_workspace_id AND form.offer_id = v_offer_id
  RETURNING form.* INTO v_form;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Landing form is not initialized' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.workspace_access_audit (workspace_id, actor_id, action, details)
  VALUES (
    p_workspace_id,
    v_actor,
    'Landing form origin configured',
    jsonb_build_object('offer_id', v_offer_id, 'public_id', v_form.public_id)
  );

  RETURN QUERY SELECT v_form.public_id, v_form.allowed_origin, v_form.is_active;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_landing_form_config_for_adapter(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.configure_landing_form_origin_for_adapter(UUID, UUID, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_landing_form_config_for_adapter(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.configure_landing_form_origin_for_adapter(UUID, UUID, TEXT)
  TO authenticated;

COMMENT ON COLUMN public.workspace_landings.adapted_archive_path IS
  'Private server-managed adapted ZIP path; never returned to browsers.';
COMMENT ON COLUMN public.workspace_landings.adapter_status IS
  'Landing Adapter state, independent of the landing draft workflow status.';
COMMENT ON FUNCTION public.ensure_landing_form_config_for_adapter(UUID, UUID) IS
  'Creates an inactive pending form integration when needed; it cannot accept leads until an exact origin is configured.';
COMMENT ON FUNCTION public.configure_landing_form_origin_for_adapter(UUID, UUID, TEXT) IS
  'Activates a pending form without rotating its public ID; an existing configured offer origin cannot be changed through this landing action.';

NOTIFY pgrst, 'reload schema';
COMMIT;
