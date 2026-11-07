-- Keep authorized orders readable after their lead is hidden from active lead access.
-- The helper applies the same scoped lead/order permissions while bypassing the
-- leads SELECT policy solely for this existence/authorization check.
BEGIN;

CREATE FUNCTION public.can_read_workspace_order(
  p_workspace_id UUID,
  p_lead_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT p_workspace_id IS NOT NULL
    AND p_lead_id IS NOT NULL
    AND auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.leads AS lead
      WHERE lead.workspace_id = p_workspace_id
        AND lead.id = p_lead_id
        AND public.has_workspace_permission(
          lead.workspace_id, 'leads.read', lead.team_id, lead.operator_id, lead.offer_id
        )
        AND (
          public.has_workspace_permission(
            lead.workspace_id, 'orders.read', lead.team_id, lead.operator_id, lead.offer_id
          )
          OR public.has_workspace_permission(
            lead.workspace_id, 'orders.manage', lead.team_id, lead.operator_id, lead.offer_id
          )
        )
    );
$$;

REVOKE ALL ON FUNCTION public.can_read_workspace_order(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.can_read_workspace_order(UUID, UUID)
  TO authenticated;

DROP POLICY IF EXISTS workspace_orders_read_authorized ON public.workspace_orders;
CREATE POLICY workspace_orders_read_authorized
  ON public.workspace_orders FOR SELECT TO authenticated
  USING (
    public.can_read_workspace_order(workspace_id, lead_id)
  );

COMMENT ON FUNCTION public.can_read_workspace_order(UUID, UUID) IS
  'Checks scoped lead and order read permissions for an order, including when its lead is hidden.';

NOTIFY pgrst, 'reload schema';
COMMIT;
