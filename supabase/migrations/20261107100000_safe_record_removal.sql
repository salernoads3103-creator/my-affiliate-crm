-- Safe, workspace-scoped removal for unused catalog and domain records.
-- Historical records are retained through deactivation or existing draft cleanup.
BEGIN;

CREATE FUNCTION public.delete_workspace_product_if_unused(
  p_workspace_id UUID,
  p_product_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'Workspace and product are required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'products.manage', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.products AS product
  WHERE product.workspace_id = p_workspace_id AND product.id = p_product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workspace_offers AS offer
    WHERE offer.workspace_id = p_workspace_id AND offer.product_id = p_product_id
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_orders AS order_row
    WHERE order_row.workspace_id = p_workspace_id AND order_row.product_id = p_product_id
  ) THEN
    RAISE EXCEPTION 'Product is linked to an offer or order; deactivate it instead'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.products AS product
  WHERE product.workspace_id = p_workspace_id AND product.id = p_product_id;
  RETURN p_product_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_workspace_product_if_unused(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_workspace_product_if_unused(UUID, UUID)
  TO authenticated;

-- workspace_offers previously allowed direct authenticated DELETE. Remove that
-- path because the legacy intake-form FK cascades. An authorized RPC now checks
-- every durable relationship before removing an unused offer.
DROP POLICY IF EXISTS offers_delete_authorized ON public.workspace_offers;
REVOKE DELETE ON public.workspace_offers FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.delete_commercial_offer_if_unused(
  p_workspace_id UUID,
  p_offer_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_offer_id IS NULL THEN
    RAISE EXCEPTION 'Workspace and offer are required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, p_offer_id
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'products.read', NULL, NULL, NULL
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.workspace_offers AS offer
  WHERE offer.workspace_id = p_workspace_id AND offer.id = p_offer_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found' USING ERRCODE = 'P0002';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.leads AS lead
    WHERE lead.workspace_id = p_workspace_id AND lead.offer_id = p_offer_id
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_orders AS order_row
    WHERE order_row.workspace_id = p_workspace_id AND order_row.offer_id = p_offer_id
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_landings AS landing
    WHERE landing.workspace_id = p_workspace_id AND landing.offer_id = p_offer_id
  ) OR EXISTS (
    SELECT 1 FROM public.landing_form_integrations AS integration
    WHERE integration.workspace_id = p_workspace_id AND integration.offer_id = p_offer_id
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_offer_launch_workflows AS launch
    WHERE launch.workspace_id = p_workspace_id AND launch.offer_id = p_offer_id
  ) THEN
    RAISE EXCEPTION 'Offer has lead, order, landing, form, or launch history; deactivate it instead'
      USING ERRCODE = '23503';
  END IF;

  DELETE FROM public.workspace_offers AS offer
  WHERE offer.workspace_id = p_workspace_id AND offer.id = p_offer_id;
  RETURN p_offer_id;
END;
$$;

CREATE FUNCTION public.set_workspace_offer_active(
  p_workspace_id UUID,
  p_offer_id UUID,
  p_is_active BOOLEAN
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_workspace_id IS NULL OR p_offer_id IS NULL OR p_is_active IS NULL THEN
    RAISE EXCEPTION 'Workspace, offer, and status are required' USING ERRCODE = '22023';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'offers.manage', NULL, NULL, p_offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.workspace_offers AS offer
  SET is_active = p_is_active
  WHERE offer.workspace_id = p_workspace_id AND offer.id = p_offer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Offer not found' USING ERRCODE = 'P0002';
  END IF;
  RETURN p_offer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_commercial_offer_if_unused(UUID, UUID)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.set_workspace_offer_active(UUID, UUID, BOOLEAN)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.delete_commercial_offer_if_unused(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_workspace_offer_active(UUID, UUID, BOOLEAN)
  TO authenticated;

-- Domain mutations remain server-only. The API checks landing_pages.manage;
-- this RPC rejects reservations, active publication pointers, and any history.
CREATE FUNCTION public.delete_workspace_domain_address(
  p_workspace_id UUID,
  p_domain_host_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_domain_id UUID;
  v_hostname TEXT;
  v_apex_domain TEXT;
  v_status TEXT;
  v_reserved_landing_id UUID;
  v_current_version_id UUID;
BEGIN
  IF p_workspace_id IS NULL OR p_domain_host_id IS NULL THEN
    RAISE EXCEPTION 'Workspace and domain address are required' USING ERRCODE = '22023';
  END IF;

  SELECT host.domain_id, host.hostname, host.apex_domain, host.status,
         host.reserved_landing_id, host.current_publication_version_id
  INTO v_domain_id, v_hostname, v_apex_domain, v_status,
       v_reserved_landing_id, v_current_version_id
  FROM public.workspace_domain_hosts AS host
  WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Domain address not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status <> 'available' OR v_reserved_landing_id IS NOT NULL
     OR v_current_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Reserved or published addresses cannot be deleted'
      USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.landing_publication_versions AS version
    WHERE version.workspace_id = p_workspace_id AND version.domain_host_id = p_domain_host_id
  ) OR EXISTS (
    SELECT 1 FROM public.landing_form_allowed_origins AS allowed_origin
    WHERE allowed_origin.workspace_id = p_workspace_id
      AND allowed_origin.domain_host_id = p_domain_host_id
  ) OR EXISTS (
    SELECT 1 FROM public.landing_publication_operations AS operation
    WHERE operation.workspace_id = p_workspace_id AND operation.domain_host_id = p_domain_host_id
  ) OR EXISTS (
    SELECT 1 FROM public.workspace_offer_launch_workflows AS launch
    WHERE launch.workspace_id = p_workspace_id AND launch.domain_host_id = p_domain_host_id
  ) THEN
    RAISE EXCEPTION 'This address has publication or launch history and cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF v_hostname = v_apex_domain AND EXISTS (
    SELECT 1 FROM public.workspace_domain_hosts AS child_host
    WHERE child_host.workspace_id = p_workspace_id
      AND child_host.domain_id = v_domain_id
      AND child_host.id <> p_domain_host_id
  ) THEN
    RAISE EXCEPTION 'Remove subdomains before removing the main domain'
      USING ERRCODE = '23503';
  END IF;

  BEGIN
    DELETE FROM public.workspace_domain_hosts AS host
    WHERE host.workspace_id = p_workspace_id AND host.id = p_domain_host_id;
    IF v_hostname = v_apex_domain AND NOT EXISTS (
      SELECT 1 FROM public.workspace_domain_hosts AS remaining_host
      WHERE remaining_host.workspace_id = p_workspace_id
        AND remaining_host.domain_id = v_domain_id
    ) THEN
      DELETE FROM public.workspace_domains AS domain
      WHERE domain.workspace_id = p_workspace_id AND domain.id = v_domain_id;
    END IF;
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE EXCEPTION 'This address is still referenced and cannot be deleted'
      USING ERRCODE = '23514';
  END;
  RETURN v_hostname;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_workspace_domain_address(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.delete_workspace_domain_address(UUID, UUID)
  TO service_role;

COMMENT ON FUNCTION public.delete_workspace_product_if_unused(UUID, UUID) IS
  'Deletes a workspace product only when no offer or order depends on it; callers must have products.manage.';
COMMENT ON FUNCTION public.delete_commercial_offer_if_unused(UUID, UUID) IS
  'Deletes an offer only when it has no lead, order, form, landing, or launch history; callers must have offers.manage and products.read.';
COMMENT ON FUNCTION public.delete_workspace_domain_address(UUID, UUID) IS
  'Server-only removal of a free domain host with no reservation, publication, or launch history. Does not change DNS or Cloudflare.';

NOTIFY pgrst, 'reload schema';
COMMIT;
