-- Repair the PL/pgSQL output-column ambiguity in the batch hostname RPC.
-- The function returns a column named `hostname`, so ON CONFLICT (hostname)
-- is ambiguous inside PL/pgSQL. Keep the existing global uniqueness guarantee
-- by targeting the table's declared unique constraint explicitly.
CREATE OR REPLACE FUNCTION public.add_workspace_domain_hosts(
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
    ) ON CONFLICT ON CONSTRAINT workspace_domain_hosts_hostname_unique DO NOTHING;

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

-- CREATE OR REPLACE preserves existing ACLs, but state them explicitly so the
-- service-role-only mutation contract remains clear and reviewable.
REVOKE ALL ON FUNCTION public.add_workspace_domain_hosts(UUID, UUID, TEXT[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.add_workspace_domain_hosts(UUID, UUID, TEXT[])
  TO service_role;
