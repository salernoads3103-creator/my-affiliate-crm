-- Server-controlled, idempotent publication operations. R2 objects are
-- uploaded and verified before the database pointer changes; the Worker
-- manifest is switched only after the database transaction succeeds.
BEGIN;

CREATE TABLE public.landing_publication_operations (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  domain_host_id UUID NOT NULL,
  landing_id UUID NOT NULL,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('publish', 'rollback')),
  idempotency_key_hash TEXT NOT NULL CHECK (idempotency_key_hash ~ '^[0-9a-f]{64}$'),
  request_fingerprint TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  expected_current_version_id UUID,
  target_publication_version_id UUID NOT NULL,
  reservation_created BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'database_switched', 'completed', 'failed', 'recovery_required')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT landing_publication_operations_host_fk
    FOREIGN KEY (workspace_id, domain_host_id)
    REFERENCES public.workspace_domain_hosts(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT landing_publication_operations_landing_fk
    FOREIGN KEY (workspace_id, landing_id)
    REFERENCES public.workspace_landings(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT landing_publication_operations_target_fk
    FOREIGN KEY (workspace_id, domain_host_id, landing_id, target_publication_version_id)
    REFERENCES public.landing_publication_versions(
      workspace_id, domain_host_id, landing_id, id
    ) ON DELETE RESTRICT,
  CONSTRAINT landing_publication_operations_expected_fk
    FOREIGN KEY (workspace_id, domain_host_id, landing_id, expected_current_version_id)
    REFERENCES public.landing_publication_versions(
      workspace_id, domain_host_id, landing_id, id
    ) ON DELETE RESTRICT,
  CONSTRAINT landing_publication_operations_idempotency_unique
    UNIQUE (workspace_id, domain_host_id, idempotency_key_hash)
);

CREATE UNIQUE INDEX landing_publication_operations_one_unresolved_per_host
  ON public.landing_publication_operations(domain_host_id)
  WHERE status IN ('uploading', 'database_switched', 'recovery_required');
CREATE INDEX landing_publication_operations_landing_history_idx
  ON public.landing_publication_operations(workspace_id, landing_id, created_at DESC);
CREATE INDEX landing_publication_operations_target_idx
  ON public.landing_publication_operations(target_publication_version_id, status);

CREATE TRIGGER landing_publication_operations_updated_at
  BEFORE UPDATE ON public.landing_publication_operations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.landing_publication_operations ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.claim_landing_publication_operation(
  p_operation_id UUID,
  p_workspace_id UUID,
  p_domain_host_id UUID,
  p_landing_id UUID,
  p_operation_kind TEXT,
  p_idempotency_key_hash TEXT,
  p_request_fingerprint TEXT,
  p_expected_current_version_id UUID,
  p_build_fingerprint TEXT,
  p_zip_fingerprint TEXT,
  p_target_publication_version_id UUID,
  p_created_by_user_id UUID
)
RETURNS TABLE (
  operation_id UUID,
  target_publication_version_id UUID,
  target_prefix TEXT,
  version_number BIGINT,
  operation_status TEXT,
  was_replay BOOLEAN,
  reservation_created BOOLEAN,
  expected_current_version_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_host public.workspace_domain_hosts%ROWTYPE;
  v_domain_status TEXT;
  v_existing public.landing_publication_operations%ROWTYPE;
  v_version_id UUID;
  v_version_number BIGINT;
  v_prefix TEXT;
  v_reservation_created BOOLEAN := FALSE;
BEGIN
  IF p_operation_id IS NULL OR p_workspace_id IS NULL OR p_domain_host_id IS NULL
     OR p_landing_id IS NULL OR p_operation_kind IS NULL
     OR p_operation_kind NOT IN ('publish', 'rollback')
     OR p_idempotency_key_hash IS NULL OR p_idempotency_key_hash !~ '^[0-9a-f]{64}$'
     OR p_request_fingerprint IS NULL OR p_request_fingerprint !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid publication operation request' USING ERRCODE = '22023';
  END IF;

  SELECT host.* INTO v_host
  FROM public.workspace_domain_hosts AS host
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;

  SELECT operation.* INTO v_existing
  FROM public.landing_publication_operations AS operation
  WHERE operation.workspace_id = p_workspace_id
    AND operation.domain_host_id = p_domain_host_id
    AND operation.idempotency_key_hash = p_idempotency_key_hash
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_fingerprint <> p_request_fingerprint
       OR v_existing.landing_id <> p_landing_id
       OR v_existing.operation_kind <> p_operation_kind THEN
      RAISE EXCEPTION 'Idempotency key was already used for another publication request'
        USING ERRCODE = '23505';
    END IF;
    SELECT version.r2_prefix, version.version_number
      INTO v_prefix, v_version_number
    FROM public.landing_publication_versions AS version
    WHERE version.workspace_id = p_workspace_id
      AND version.domain_host_id = p_domain_host_id
      AND version.landing_id = p_landing_id
      AND version.id = v_existing.target_publication_version_id;
    RETURN QUERY SELECT v_existing.id, v_existing.target_publication_version_id,
      v_prefix, v_version_number, v_existing.status, TRUE,
      v_existing.reservation_created, v_existing.expected_current_version_id;
    RETURN;
  END IF;

  SELECT parent_domain.connection_status INTO v_domain_status
  FROM public.workspace_domains AS parent_domain
  WHERE parent_domain.workspace_id = p_workspace_id AND parent_domain.id = v_host.domain_id;
  IF v_domain_status <> 'active' OR v_host.technical_status <> 'ready'
     OR v_host.technical_checked_at IS NULL
     OR v_host.technical_checked_at < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'A recent successful DNS and HTTPS check is required'
      USING ERRCODE = '23514';
  END IF;
  IF v_host.current_publication_version_id IS DISTINCT FROM p_expected_current_version_id THEN
    RAISE EXCEPTION 'Current publication changed; reload before switching versions'
      USING ERRCODE = '40001';
  END IF;
  IF v_host.status = 'available' AND v_host.current_publication_version_id IS NULL THEN
    PERFORM public.reserve_workspace_domain_host(
      p_workspace_id, p_domain_host_id, p_landing_id
    );
    v_reservation_created := TRUE;
  ELSIF v_host.status <> 'reserved' OR v_host.reserved_landing_id <> p_landing_id THEN
    RAISE EXCEPTION 'Hostname is not reserved to this landing in this workspace'
      USING ERRCODE = '23505';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workspace_landings AS landing
    JOIN public.workspace_offers AS offer
      ON offer.workspace_id = landing.workspace_id AND offer.id = landing.offer_id
    JOIN public.landing_form_integrations AS form
      ON form.workspace_id = landing.workspace_id
     AND form.offer_id = landing.offer_id
     AND form.public_id = landing.intake_public_id
    WHERE landing.workspace_id = p_workspace_id
      AND landing.id = p_landing_id
      AND landing.status = 'draft'
      AND landing.deletion_started_at IS NULL
      AND landing.adapter_status = 'prepared'
      AND form.is_active
      AND form.allowed_origin <> 'https://pending.crmonia.invalid'
      AND offer.is_active
  ) THEN
    RAISE EXCEPTION 'A current, connected landing and active offer are required'
      USING ERRCODE = '23514';
  END IF;

  IF p_operation_kind = 'publish' THEN
    IF p_build_fingerprint IS NULL OR p_build_fingerprint !~ '^[0-9a-f]{64}$'
       OR p_zip_fingerprint IS NULL OR p_zip_fingerprint !~ '^[0-9a-f]{64}$'
       OR p_target_publication_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'Publication fingerprints are required' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.workspace_landings AS landing
      WHERE landing.workspace_id = p_workspace_id
        AND landing.id = p_landing_id
        AND landing.adapted_build_fingerprint = p_build_fingerprint
        AND landing.adapted_archive_path IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'The adapted ZIP is stale; prepare it again before publishing'
        USING ERRCODE = '23514';
    END IF;
    v_version_id := gen_random_uuid();
    SELECT COALESCE(max(version.version_number), 0) + 1 INTO v_version_number
    FROM public.landing_publication_versions AS version
    WHERE version.domain_host_id = p_domain_host_id;
    v_prefix := 'crmonia/landing-sites/' || p_workspace_id::TEXT || '/'
      || p_domain_host_id::TEXT || '/' || v_version_id::TEXT || '/';
    INSERT INTO public.landing_publication_versions (
      id, workspace_id, domain_host_id, landing_id, version_number,
      zip_fingerprint, build_fingerprint, r2_prefix, created_by_user_id
    ) VALUES (
      v_version_id, p_workspace_id, p_domain_host_id, p_landing_id, v_version_number,
      p_zip_fingerprint, p_build_fingerprint, v_prefix, p_created_by_user_id
    );
  ELSE
    IF p_target_publication_version_id IS NULL OR p_expected_current_version_id IS NULL
       OR p_build_fingerprint IS NOT NULL
       OR p_zip_fingerprint IS NOT NULL
       OR p_target_publication_version_id = p_expected_current_version_id
       OR NOT EXISTS (
         SELECT 1
         FROM public.landing_publication_versions AS version
         JOIN public.landing_publication_operations AS completed_operation
           ON completed_operation.target_publication_version_id = version.id
          AND completed_operation.status = 'completed'
          AND completed_operation.operation_kind = 'publish'
         WHERE version.workspace_id = p_workspace_id
           AND version.domain_host_id = p_domain_host_id
           AND version.landing_id = p_landing_id
           AND version.id = p_target_publication_version_id
       ) THEN
      RAISE EXCEPTION 'Rollback target must be a previously published version of this landing'
        USING ERRCODE = '22023';
    END IF;
    v_version_id := p_target_publication_version_id;
    SELECT version.r2_prefix, version.version_number
      INTO v_prefix, v_version_number
    FROM public.landing_publication_versions AS version
    WHERE version.workspace_id = p_workspace_id
      AND version.domain_host_id = p_domain_host_id
      AND version.landing_id = p_landing_id
      AND version.id = v_version_id;
  END IF;

  INSERT INTO public.landing_publication_operations (
    id, workspace_id, domain_host_id, landing_id, operation_kind,
    idempotency_key_hash, request_fingerprint, expected_current_version_id,
    target_publication_version_id, reservation_created, created_by_user_id
  ) VALUES (
    p_operation_id, p_workspace_id, p_domain_host_id, p_landing_id, p_operation_kind,
    p_idempotency_key_hash, p_request_fingerprint, p_expected_current_version_id,
    v_version_id, v_reservation_created, p_created_by_user_id
  );

  RETURN QUERY SELECT p_operation_id, v_version_id, v_prefix,
    v_version_number, 'uploading'::TEXT, FALSE, v_reservation_created,
    p_expected_current_version_id;
END;
$$;

CREATE FUNCTION public.advance_landing_publication_operation(p_operation_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_operation public.landing_publication_operations%ROWTYPE;
  v_hostname TEXT;
  v_form_id UUID;
  v_offer_id UUID;
  v_current_version_id UUID;
  v_technical_status TEXT;
  v_technical_checked_at TIMESTAMPTZ;
  v_domain_status TEXT;
BEGIN
  SELECT operation.* INTO v_operation
  FROM public.landing_publication_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publication operation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_operation.status = 'database_switched' OR v_operation.status = 'completed' THEN
    RETURN v_operation.status;
  END IF;
  IF v_operation.status NOT IN ('uploading', 'recovery_required') THEN
    RAISE EXCEPTION 'Publication operation cannot be advanced' USING ERRCODE = '23514';
  END IF;

  SELECT host.current_publication_version_id, host.technical_status,
         host.technical_checked_at, parent_domain.connection_status
    INTO v_current_version_id, v_technical_status, v_technical_checked_at, v_domain_status
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_domains AS parent_domain
    ON parent_domain.workspace_id = host.workspace_id
   AND parent_domain.id = host.domain_id
  WHERE host.workspace_id = v_operation.workspace_id
    AND host.id = v_operation.domain_host_id
  FOR UPDATE OF host, parent_domain;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address is unavailable in this workspace' USING ERRCODE = 'P0002';
  END IF;
  IF v_domain_status <> 'active' OR v_technical_status <> 'ready'
     OR v_technical_checked_at IS NULL
     OR v_technical_checked_at < now() - INTERVAL '5 minutes' THEN
    RAISE EXCEPTION 'A recent successful DNS and HTTPS check is required before activation'
      USING ERRCODE = '23514';
  END IF;
  IF v_current_version_id IS DISTINCT FROM v_operation.target_publication_version_id THEN
    IF v_operation.operation_kind = 'publish' THEN
      PERFORM 1
      FROM public.workspace_landings AS landing
      JOIN public.landing_publication_versions AS version
        ON version.workspace_id = landing.workspace_id
       AND version.landing_id = landing.id
       AND version.id = v_operation.target_publication_version_id
      WHERE landing.workspace_id = v_operation.workspace_id
        AND landing.id = v_operation.landing_id
        AND landing.adapter_status = 'prepared'
        AND landing.adapted_archive_path IS NOT NULL
        AND landing.adapted_build_fingerprint = version.build_fingerprint
        AND landing.deletion_started_at IS NULL
      FOR UPDATE OF landing;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'The adapted ZIP changed before publication activation'
          USING ERRCODE = '23514';
      END IF;
    END IF;
    PERFORM public.switch_landing_publication_version(
      v_operation.workspace_id, v_operation.domain_host_id,
      v_operation.target_publication_version_id, v_operation.expected_current_version_id
    );
  END IF;

  SELECT host.hostname, form.id, landing.offer_id
    INTO v_hostname, v_form_id, v_offer_id
  FROM public.workspace_domain_hosts AS host
  JOIN public.workspace_landings AS landing
    ON landing.workspace_id = host.workspace_id
   AND landing.id = host.reserved_landing_id
  JOIN public.landing_form_integrations AS form
    ON form.workspace_id = landing.workspace_id
   AND form.offer_id = landing.offer_id
   AND form.public_id = landing.intake_public_id
   AND form.is_active
  WHERE host.workspace_id = v_operation.workspace_id
    AND host.id = v_operation.domain_host_id
    AND landing.id = v_operation.landing_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active landing form integration is unavailable' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.landing_form_allowed_origins (
    workspace_id, integration_id, offer_id, landing_id, domain_host_id,
    hostname, origin
  ) VALUES (
    v_operation.workspace_id, v_form_id, v_offer_id, v_operation.landing_id,
    v_operation.domain_host_id, v_hostname, 'https://' || v_hostname
  )
  ON CONFLICT (domain_host_id) DO UPDATE
    SET integration_id = EXCLUDED.integration_id,
        offer_id = EXCLUDED.offer_id,
        landing_id = EXCLUDED.landing_id,
        hostname = EXCLUDED.hostname,
        origin = EXCLUDED.origin;

  UPDATE public.landing_publication_operations AS operation
  SET status = 'database_switched'
  WHERE operation.id = p_operation_id;
  RETURN 'database_switched';
END;
$$;

CREATE FUNCTION public.complete_landing_publication_operation(p_operation_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  UPDATE public.landing_publication_operations AS operation
  SET status = 'completed'
  WHERE operation.id = p_operation_id AND operation.status = 'database_switched'
  RETURNING operation.status INTO v_status;
  IF v_status IS NULL THEN
    SELECT operation.status INTO v_status
    FROM public.landing_publication_operations AS operation
    WHERE operation.id = p_operation_id;
  END IF;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Publication operation not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('completed', 'database_switched') THEN
    RAISE EXCEPTION 'Publication operation cannot be completed' USING ERRCODE = '23514';
  END IF;
  RETURN v_status;
END;
$$;

CREATE FUNCTION public.fail_landing_publication_operation(p_operation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_operation public.landing_publication_operations%ROWTYPE;
BEGIN
  SELECT operation.* INTO v_operation
  FROM public.landing_publication_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  IF v_operation.status = 'failed' THEN RETURN TRUE; END IF;
  IF v_operation.status = 'recovery_required' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.workspace_domain_hosts AS host
      WHERE host.workspace_id = v_operation.workspace_id
        AND host.id = v_operation.domain_host_id
        AND host.current_publication_version_id
          IS NOT DISTINCT FROM v_operation.expected_current_version_id
    ) THEN
      RETURN FALSE;
    END IF;
  ELSIF v_operation.status <> 'uploading' THEN
    RETURN FALSE;
  END IF;

  UPDATE public.landing_publication_operations AS operation
  SET status = 'failed'
  WHERE operation.id = p_operation_id;
  IF v_operation.reservation_created THEN
    UPDATE public.workspace_domain_hosts AS host
    SET status = 'available', reserved_landing_id = NULL
    WHERE host.workspace_id = v_operation.workspace_id
      AND host.id = v_operation.domain_host_id
      AND host.reserved_landing_id = v_operation.landing_id
      AND host.current_publication_version_id IS NULL;
  END IF;
  RETURN TRUE;
END;
$$;

CREATE FUNCTION public.require_landing_publication_recovery(p_operation_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  UPDATE public.landing_publication_operations AS operation
  SET status = 'recovery_required'
  WHERE operation.id = p_operation_id
    AND operation.status IN ('uploading', 'database_switched', 'recovery_required');
  RETURN FOUND;
END;
$$;

REVOKE ALL ON public.landing_publication_operations FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.landing_publication_operations TO service_role;
REVOKE INSERT, UPDATE, DELETE ON public.landing_publication_versions FROM service_role;
GRANT SELECT ON public.landing_publication_versions TO service_role;

REVOKE ALL ON FUNCTION public.claim_landing_publication_operation(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, UUID
) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.advance_landing_publication_operation(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.complete_landing_publication_operation(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.fail_landing_publication_operation(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.require_landing_publication_recovery(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.claim_landing_publication_operation(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, UUID
) TO service_role;
GRANT EXECUTE ON FUNCTION public.advance_landing_publication_operation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_landing_publication_operation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_landing_publication_operation(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.require_landing_publication_recovery(UUID) TO service_role;

COMMENT ON TABLE public.landing_publication_operations IS
  'Server-only idempotency and recovery state for the non-transactional R2/DB publication workflow.';
COMMENT ON FUNCTION public.claim_landing_publication_operation(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, UUID, UUID
) IS 'Atomically reserves one hostname publication operation and creates its immutable version record.';

COMMIT;
