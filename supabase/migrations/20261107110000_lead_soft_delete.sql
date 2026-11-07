-- Preserve order-linked leads while removing them from everyday CRM lists.
-- Unlinked leads keep the existing physical-delete behavior.
BEGIN;

ALTER TABLE public.leads
  ADD COLUMN deleted_at TIMESTAMPTZ;

CREATE INDEX leads_workspace_active_created_idx
  ON public.leads(workspace_id, created_at DESC)
  WHERE deleted_at IS NULL;

DROP POLICY IF EXISTS leads_read_authorized ON public.leads;
CREATE POLICY leads_read_authorized
  ON public.leads FOR SELECT TO authenticated
  USING (
    (
      deleted_at IS NULL
      AND public.has_workspace_permission(
        workspace_id, 'leads.read', team_id, operator_id, offer_id
      )
    ) OR (
      deleted_at IS NOT NULL
      AND public.has_workspace_permission(
        workspace_id, 'leads.read', team_id, operator_id, offer_id
      )
      AND (
        public.is_super_admin(auth.uid())
        OR EXISTS (
          SELECT 1
          FROM public.workspace_memberships AS membership
          WHERE membership.workspace_id = leads.workspace_id
            AND membership.user_id = auth.uid()
            AND membership.role = 'admin'
            AND membership.status = 'active'
        )
      )
    )
  );

DROP POLICY IF EXISTS leads_update_authorized ON public.leads;
CREATE POLICY leads_update_authorized
  ON public.leads FOR UPDATE TO authenticated
  USING (
    deleted_at IS NULL
    AND public.has_workspace_permission(
      workspace_id, 'leads.update', team_id, operator_id, offer_id
    )
  )
  WITH CHECK (
    deleted_at IS NULL
    AND public.has_workspace_permission(
      workspace_id, 'leads.update', team_id, operator_id, offer_id
    )
  );

-- All lead removals now pass through an atomic workspace- and scope-aware RPC.
-- The retained order FK remains ON DELETE RESTRICT as a final integrity guard.
DROP POLICY IF EXISTS leads_delete_authorized ON public.leads;
REVOKE DELETE ON public.leads FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.remove_workspace_lead(p_workspace_id UUID, p_lead_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'Workspace and lead are required' USING ERRCODE = '22023';
  END IF;

  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'leads.delete', v_lead.team_id,
    v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  IF v_lead.deleted_at IS NOT NULL THEN
    RETURN 'hidden';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.workspace_orders AS order_row
    WHERE order_row.workspace_id = v_lead.workspace_id
      AND order_row.lead_id = v_lead.id
  ) THEN
    UPDATE public.leads AS lead
    SET deleted_at = now()
    WHERE lead.workspace_id = v_lead.workspace_id AND lead.id = v_lead.id;
    RETURN 'hidden';
  END IF;

  DELETE FROM public.leads AS lead
  WHERE lead.workspace_id = v_lead.workspace_id AND lead.id = v_lead.id;
  RETURN 'deleted';
END;
$$;

CREATE FUNCTION public.restore_workspace_lead(p_workspace_id UUID, p_lead_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
BEGIN
  IF p_workspace_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'Workspace and lead are required' USING ERRCODE = '22023';
  END IF;

  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_super_admin(auth.uid()) AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_memberships AS membership
    WHERE membership.workspace_id = v_lead.workspace_id
      AND membership.user_id = auth.uid()
      AND membership.role = 'admin'
      AND membership.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Workspace administrator access required' USING ERRCODE = '42501';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'leads.read', v_lead.team_id,
    v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  UPDATE public.leads AS lead
  SET deleted_at = NULL
  WHERE lead.workspace_id = v_lead.workspace_id AND lead.id = v_lead.id;
  RETURN v_lead.id;
END;
$$;

REVOKE ALL ON FUNCTION public.remove_workspace_lead(UUID, UUID)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.restore_workspace_lead(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.remove_workspace_lead(UUID, UUID)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_workspace_lead(UUID, UUID)
  TO authenticated;

COMMENT ON COLUMN public.leads.deleted_at IS
  'When set, the lead is hidden from active lists; related orders and history remain unchanged.';
COMMENT ON FUNCTION public.remove_workspace_lead(UUID, UUID) IS
  'Deletes a lead with no orders or soft-hides it when an order exists; checks scoped leads.delete permission.';
COMMENT ON FUNCTION public.restore_workspace_lead(UUID, UUID) IS
  'Restores a hidden lead for an active workspace administrator with leads.read permission.';

NOTIFY pgrst, 'reload schema';
COMMIT;
