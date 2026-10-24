-- Nova Poshta delivery preparation and guarded waybill operations.
-- Apply only after review against a disposable local Supabase database.
BEGIN;

INSERT INTO public.workspace_permission_catalog (permission_key, description)
VALUES ('shipping.manage', 'Manage workspace delivery settings and create waybills for authorized orders')
ON CONFLICT (permission_key) DO NOTHING;

CREATE UNIQUE INDEX workspace_orders_workspace_id_id_uidx
  ON public.workspace_orders(workspace_id, id);

CREATE TABLE public.workspace_nova_poshta_settings (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  api_version TEXT NOT NULL DEFAULT 'v2.0' CHECK (api_version = 'v2.0'),
  encrypted_api_key TEXT NOT NULL,
  sender_name TEXT,
  sender_phone TEXT CHECK (sender_phone IS NULL OR sender_phone ~ '^380[0-9]{9}$'),
  sender_email TEXT,
  sender_company_name TEXT,
  sender_company_tin TEXT,
  sender_counterparty_ref TEXT,
  sender_counterparty_name TEXT,
  sender_contact_ref TEXT,
  sender_contact_name TEXT,
  sender_city_ref TEXT,
  sender_city_name TEXT,
  sender_branch_ref TEXT,
  sender_branch_name TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_nova_poshta_settings_text_check CHECK (
    (sender_name IS NULL OR char_length(btrim(sender_name)) BETWEEN 1 AND 100)
    AND (sender_email IS NULL OR char_length(btrim(sender_email)) <= 254)
    AND (sender_company_name IS NULL OR char_length(btrim(sender_company_name)) <= 100)
    AND (sender_company_tin IS NULL OR char_length(btrim(sender_company_tin)) <= 20)
    AND (sender_counterparty_ref IS NULL OR char_length(btrim(sender_counterparty_ref)) BETWEEN 36 AND 100)
    AND (sender_counterparty_name IS NULL OR char_length(btrim(sender_counterparty_name)) BETWEEN 1 AND 200)
    AND (sender_contact_ref IS NULL OR char_length(btrim(sender_contact_ref)) BETWEEN 36 AND 100)
    AND (sender_contact_name IS NULL OR char_length(btrim(sender_contact_name)) BETWEEN 1 AND 200)
    AND (sender_city_ref IS NULL OR char_length(btrim(sender_city_ref)) BETWEEN 36 AND 100)
    AND (sender_city_name IS NULL OR char_length(btrim(sender_city_name)) BETWEEN 1 AND 200)
    AND (sender_branch_ref IS NULL OR char_length(btrim(sender_branch_ref)) BETWEEN 36 AND 100)
    AND (sender_branch_name IS NULL OR char_length(btrim(sender_branch_name)) BETWEEN 1 AND 500)
    AND ((sender_counterparty_ref IS NULL) = (sender_counterparty_name IS NULL))
    AND ((sender_contact_ref IS NULL) = (sender_contact_name IS NULL))
    AND (sender_counterparty_ref IS NULL OR sender_counterparty_ref ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    AND (sender_contact_ref IS NULL OR sender_contact_ref ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    AND (sender_city_ref IS NULL OR sender_city_ref ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    AND (sender_branch_ref IS NULL OR sender_branch_ref ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  )
);

CREATE TRIGGER workspace_nova_poshta_settings_updated_at
  BEFORE UPDATE ON public.workspace_nova_poshta_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_nova_poshta_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_nova_poshta_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_nova_poshta_settings TO service_role;

CREATE TABLE public.workspace_order_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  order_id UUID NOT NULL,
  provider TEXT NOT NULL DEFAULT 'nova_poshta' CHECK (provider = 'nova_poshta'),
  provider_api_version TEXT NOT NULL DEFAULT 'v2.0' CHECK (provider_api_version = 'v2.0'),
  delivery_type TEXT CHECK (delivery_type IS NULL OR delivery_type IN ('warehouse', 'postomat', 'address')),
  recipient_city_ref TEXT,
  recipient_city_name TEXT,
  recipient_branch_ref TEXT,
  recipient_branch_name TEXT,
  weight_grams INTEGER CHECK (weight_grams IS NULL OR weight_grams BETWEEN 1 AND 30000),
  length_mm INTEGER CHECK (length_mm IS NULL OR length_mm BETWEEN 1 AND 3000),
  width_mm INTEGER CHECK (width_mm IS NULL OR width_mm BETWEEN 1 AND 3000),
  height_mm INTEGER CHECK (height_mm IS NULL OR height_mm BETWEEN 1 AND 3000),
  declared_value_minor BIGINT CHECK (declared_value_minor IS NULL OR declared_value_minor BETWEEN 101 AND 999999999),
  delivery_payer TEXT CHECK (delivery_payer IS NULL OR delivery_payer IN ('Sender', 'Recipient', 'ThirdPerson')),
  delivery_payment_method TEXT CHECK (delivery_payment_method IS NULL OR delivery_payment_method IN ('Cash', 'NonCash')),
  cod_service TEXT CHECK (cod_service IS NULL OR cod_service IN ('novapay', 'payment_control')),
  cod_amount_minor BIGINT CHECK (cod_amount_minor IS NULL OR cod_amount_minor BETWEEN 1 AND 99999999999),
  operation_status TEXT NOT NULL DEFAULT 'draft'
    CHECK (operation_status IN ('draft', 'creating', 'unknown', 'created', 'failed')),
  operation_id UUID,
  operation_started_at TIMESTAMPTZ,
  shipment_ref TEXT,
  tracking_number TEXT,
  waybill_created_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT workspace_order_shipments_workspace_order_fkey
    FOREIGN KEY (workspace_id, order_id)
    REFERENCES public.workspace_orders(workspace_id, id) ON DELETE RESTRICT,
  CONSTRAINT workspace_order_shipments_one_per_order UNIQUE (workspace_id, order_id),
  CONSTRAINT workspace_order_shipments_ref_name_pairs CHECK (
    (recipient_city_ref IS NULL) = (recipient_city_name IS NULL)
    AND (recipient_branch_ref IS NULL) = (recipient_branch_name IS NULL)
  ),
  CONSTRAINT workspace_order_shipments_cod_pair CHECK (
    (cod_amount_minor IS NULL) = (cod_service IS NULL)
  ),
  CONSTRAINT workspace_order_shipments_v2_refs_check CHECK (
    (recipient_city_ref IS NULL OR recipient_city_ref ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
    AND (recipient_branch_ref IS NULL OR recipient_branch_ref ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$')
  ),
  CONSTRAINT workspace_order_shipments_created_result_check CHECK (
    operation_status <> 'created'
    OR (shipment_ref IS NOT NULL AND tracking_number IS NOT NULL AND waybill_created_at IS NOT NULL)
  ),
  CONSTRAINT workspace_order_shipments_operation_check CHECK (
    operation_status NOT IN ('creating', 'unknown')
    OR (operation_id IS NOT NULL AND operation_started_at IS NOT NULL)
  )
);

CREATE INDEX workspace_order_shipments_workspace_status_idx
  ON public.workspace_order_shipments(workspace_id, operation_status, updated_at DESC);

CREATE TRIGGER workspace_order_shipments_updated_at
  BEFORE UPDATE ON public.workspace_order_shipments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.workspace_order_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_order_shipments_read_authorized
  ON public.workspace_order_shipments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_orders AS order_row
      JOIN public.leads AS lead
        ON lead.workspace_id = order_row.workspace_id AND lead.id = order_row.lead_id
      WHERE order_row.workspace_id = workspace_order_shipments.workspace_id
        AND order_row.id = workspace_order_shipments.order_id
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
    )
  );
REVOKE ALL ON public.workspace_order_shipments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.workspace_order_shipments TO authenticated;
GRANT ALL ON public.workspace_order_shipments TO service_role;

CREATE FUNCTION public.get_workspace_order_delivery_prefill(
  p_workspace_id UUID,
  p_lead_id UUID
)
RETURNS TABLE (
  delivery_type TEXT,
  city_ref TEXT,
  city_name TEXT,
  branch_ref TEXT,
  branch_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'leads.read', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT lead.delivery_type::TEXT,
         lead.delivery_city_ref,
         lead.delivery_city_name,
         lead.delivery_warehouse_ref,
         lead.delivery_warehouse_name
  FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = p_lead_id;
END;
$$;

CREATE FUNCTION public.save_workspace_order_delivery(
  p_workspace_id UUID,
  p_order_id UUID,
  p_delivery_type TEXT,
  p_city_ref TEXT,
  p_city_name TEXT,
  p_branch_ref TEXT,
  p_branch_name TEXT,
  p_weight_grams INTEGER,
  p_length_mm INTEGER,
  p_width_mm INTEGER,
  p_height_mm INTEGER,
  p_declared_value_minor BIGINT,
  p_delivery_payer TEXT,
  p_delivery_payment_method TEXT,
  p_cod_service TEXT,
  p_cod_amount_minor BIGINT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.workspace_orders%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_shipment public.workspace_order_shipments%ROWTYPE;
BEGIN
  SELECT order_row.* INTO v_order
  FROM public.workspace_orders AS order_row
  WHERE order_row.workspace_id = p_workspace_id AND order_row.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT lead.* INTO v_lead
  FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = v_order.lead_id;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'shipping.manage', NULL, NULL, NULL
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'Delivery cannot be edited for a cancelled order' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_shipment
  FROM public.workspace_order_shipments AS shipment
  WHERE shipment.workspace_id = p_workspace_id AND shipment.order_id = p_order_id
  FOR UPDATE;
  IF FOUND AND v_shipment.operation_status IN ('creating', 'unknown', 'created') THEN
    RAISE EXCEPTION 'Delivery cannot be edited while a waybill operation is unresolved' USING ERRCODE = '23514';
  END IF;

  IF p_delivery_type IS NOT NULL AND p_delivery_type NOT IN ('warehouse', 'postomat', 'address')
     OR p_city_ref IS NOT NULL AND char_length(btrim(p_city_ref)) NOT BETWEEN 1 AND 100
     OR p_city_name IS NOT NULL AND char_length(btrim(p_city_name)) NOT BETWEEN 1 AND 200
     OR p_branch_ref IS NOT NULL AND char_length(btrim(p_branch_ref)) NOT BETWEEN 1 AND 100
     OR p_branch_name IS NOT NULL AND char_length(btrim(p_branch_name)) NOT BETWEEN 1 AND 500
     OR p_weight_grams IS NOT NULL AND p_weight_grams NOT BETWEEN 1 AND 30000
     OR p_length_mm IS NOT NULL AND p_length_mm NOT BETWEEN 1 AND 3000
     OR p_width_mm IS NOT NULL AND p_width_mm NOT BETWEEN 1 AND 3000
     OR p_height_mm IS NOT NULL AND p_height_mm NOT BETWEEN 1 AND 3000
     OR p_declared_value_minor IS NOT NULL AND p_declared_value_minor NOT BETWEEN 101 AND 999999999
     OR p_delivery_payer IS NOT NULL AND p_delivery_payer NOT IN ('Sender', 'Recipient', 'ThirdPerson')
     OR p_delivery_payment_method IS NOT NULL AND p_delivery_payment_method NOT IN ('Cash', 'NonCash')
     OR p_cod_service IS NOT NULL AND p_cod_service NOT IN ('novapay', 'payment_control')
     OR p_cod_amount_minor IS NOT NULL AND p_cod_amount_minor NOT BETWEEN 1 AND 99999999999 THEN
    RAISE EXCEPTION 'Invalid delivery data' USING ERRCODE = '22023';
  END IF;
  IF (p_city_ref IS NULL) <> (p_city_name IS NULL)
     OR (p_branch_ref IS NULL) <> (p_branch_name IS NULL)
     OR (p_cod_amount_minor IS NULL) <> (p_cod_service IS NULL) THEN
    RAISE EXCEPTION 'Directory reference and label must be provided together' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.workspace_order_shipments (
    workspace_id, order_id, delivery_type,
    recipient_city_ref, recipient_city_name, recipient_branch_ref, recipient_branch_name,
    weight_grams, length_mm, width_mm, height_mm, declared_value_minor,
    delivery_payer, delivery_payment_method, cod_service, cod_amount_minor,
    operation_status, created_by_user_id, updated_by_user_id
  ) VALUES (
    p_workspace_id, p_order_id, p_delivery_type,
    NULLIF(btrim(p_city_ref), ''), NULLIF(btrim(p_city_name), ''),
    NULLIF(btrim(p_branch_ref), ''), NULLIF(btrim(p_branch_name), ''),
    p_weight_grams, p_length_mm, p_width_mm, p_height_mm, p_declared_value_minor,
    p_delivery_payer, p_delivery_payment_method,
    p_cod_service, p_cod_amount_minor, 'draft', auth.uid(), auth.uid()
  )
  ON CONFLICT (workspace_id, order_id) DO UPDATE
    SET delivery_type = EXCLUDED.delivery_type,
        recipient_city_ref = EXCLUDED.recipient_city_ref,
        recipient_city_name = EXCLUDED.recipient_city_name,
        recipient_branch_ref = EXCLUDED.recipient_branch_ref,
        recipient_branch_name = EXCLUDED.recipient_branch_name,
        weight_grams = EXCLUDED.weight_grams,
        length_mm = EXCLUDED.length_mm,
        width_mm = EXCLUDED.width_mm,
        height_mm = EXCLUDED.height_mm,
        declared_value_minor = EXCLUDED.declared_value_minor,
        delivery_payer = EXCLUDED.delivery_payer,
        delivery_payment_method = EXCLUDED.delivery_payment_method,
        cod_service = EXCLUDED.cod_service,
        cod_amount_minor = EXCLUDED.cod_amount_minor,
        operation_status = 'draft',
        operation_id = NULL,
        operation_started_at = NULL,
        last_error_code = NULL,
        updated_by_user_id = auth.uid();

  RETURN p_order_id;
END;
$$;

CREATE FUNCTION public.claim_workspace_order_waybill(
  p_workspace_id UUID,
  p_order_id UUID,
  p_operation_id UUID
)
RETURNS TABLE (claimed BOOLEAN, operation_status TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.workspace_orders%ROWTYPE;
  v_lead public.leads%ROWTYPE;
  v_shipment public.workspace_order_shipments%ROWTYPE;
BEGIN
  SELECT order_row.* INTO v_order
  FROM public.workspace_orders AS order_row
  WHERE order_row.workspace_id = p_workspace_id AND order_row.id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT lead.* INTO v_lead FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = v_order.lead_id;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'shipping.manage', NULL, NULL, NULL
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF v_order.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed orders can have a waybill' USING ERRCODE = '23514';
  END IF;
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'Operation id is required' USING ERRCODE = '22023';
  END IF;

  SELECT shipment.* INTO v_shipment
  FROM public.workspace_order_shipments AS shipment
  WHERE shipment.workspace_id = p_workspace_id AND shipment.order_id = p_order_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery details are required' USING ERRCODE = '22023';
  END IF;
  IF v_shipment.delivery_type NOT IN ('warehouse', 'postomat')
     OR v_shipment.recipient_city_ref IS NULL
     OR v_shipment.recipient_branch_ref IS NULL
     OR v_shipment.weight_grams IS NULL
     OR v_shipment.length_mm IS NULL
     OR v_shipment.width_mm IS NULL
     OR v_shipment.height_mm IS NULL
     OR v_shipment.declared_value_minor IS NULL
     OR v_shipment.delivery_payer IS NULL
     OR v_shipment.delivery_payment_method IS NULL
     OR v_shipment.declared_value_minor NOT BETWEEN 101 AND 999999999 THEN
    RAISE EXCEPTION 'Required delivery details are incomplete' USING ERRCODE = '22023';
  END IF;

  IF v_shipment.operation_status NOT IN ('draft', 'failed') THEN
    RETURN QUERY SELECT FALSE, v_shipment.operation_status;
    RETURN;
  END IF;

  UPDATE public.workspace_order_shipments AS shipment
  SET operation_status = 'creating',
      operation_id = p_operation_id,
      operation_started_at = now(),
      last_error_code = NULL,
      updated_by_user_id = auth.uid()
  WHERE shipment.workspace_id = p_workspace_id AND shipment.order_id = p_order_id;
  RETURN QUERY SELECT TRUE, 'creating'::TEXT;
END;
$$;

CREATE FUNCTION public.finish_workspace_order_waybill(
  p_workspace_id UUID,
  p_order_id UUID,
  p_operation_id UUID,
  p_operation_status TEXT,
  p_shipment_ref TEXT,
  p_tracking_number TEXT,
  p_error_code TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_order public.workspace_orders%ROWTYPE;
  v_lead public.leads%ROWTYPE;
BEGIN
  SELECT order_row.* INTO v_order
  FROM public.workspace_orders AS order_row
  WHERE order_row.workspace_id = p_workspace_id AND order_row.id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT lead.* INTO v_lead FROM public.leads AS lead
  WHERE lead.workspace_id = p_workspace_id AND lead.id = v_order.lead_id;
  IF NOT public.has_workspace_permission(
    p_workspace_id, 'shipping.manage', NULL, NULL, NULL
  ) OR NOT public.has_workspace_permission(
    p_workspace_id, 'orders.manage', v_lead.team_id, v_lead.operator_id, v_lead.offer_id
  ) THEN
    RAISE EXCEPTION 'Permission denied' USING ERRCODE = '42501';
  END IF;
  IF p_operation_status NOT IN ('created', 'failed', 'unknown') THEN
    RAISE EXCEPTION 'Invalid waybill operation state' USING ERRCODE = '22023';
  END IF;
  IF p_operation_status = 'created'
     AND (p_shipment_ref IS NULL OR char_length(p_shipment_ref) > 100
       OR p_tracking_number IS NULL OR char_length(p_tracking_number) NOT BETWEEN 1 AND 40) THEN
    RAISE EXCEPTION 'Waybill result is incomplete' USING ERRCODE = '22023';
  END IF;

  UPDATE public.workspace_order_shipments AS shipment
  SET operation_status = p_operation_status,
      shipment_ref = CASE WHEN p_operation_status = 'created' THEN p_shipment_ref ELSE NULL END,
      tracking_number = CASE WHEN p_operation_status = 'created' THEN p_tracking_number ELSE NULL END,
      waybill_created_at = CASE WHEN p_operation_status = 'created' THEN now() ELSE NULL END,
      last_error_code = CASE WHEN p_operation_status = 'created' THEN NULL ELSE p_error_code END,
      updated_by_user_id = auth.uid()
  WHERE shipment.workspace_id = p_workspace_id
    AND shipment.order_id = p_order_id
    AND shipment.operation_id = p_operation_id
    AND shipment.operation_status = 'creating';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Waybill attempt is no longer active' USING ERRCODE = '23514';
  END IF;
  RETURN p_order_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_workspace_order_delivery_prefill(UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_workspace_order_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, BIGINT)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_workspace_order_waybill(UUID, UUID, UUID)
  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finish_workspace_order_waybill(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_workspace_order_delivery_prefill(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_workspace_order_delivery(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER, INTEGER, INTEGER, BIGINT, TEXT, TEXT, TEXT, BIGINT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workspace_order_waybill(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_workspace_order_waybill(UUID, UUID, UUID, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

COMMENT ON TABLE public.workspace_nova_poshta_settings IS
  'Workspace Nova Poshta sender profile. The API key is application-encrypted and inaccessible to browser roles.';
COMMENT ON TABLE public.workspace_order_shipments IS
  'Delivery details and guarded waybill operation state, kept separate from the order lifecycle.';
COMMENT ON COLUMN public.workspace_nova_poshta_settings.api_version IS
  'Fixed API contract version; all stored Nova Poshta references in this row use v2.0 UUID Ref values.';
COMMENT ON COLUMN public.workspace_order_shipments.provider_api_version IS
  'API contract used for the stored directory references and resulting shipment Ref.';
COMMENT ON COLUMN public.workspace_order_shipments.cod_service IS
  'Distinguishes NovaPay post-payment from the separately contracted Payment Control service.';
COMMENT ON COLUMN public.workspace_order_shipments.cod_amount_minor IS
  'Cash-on-delivery amount in UAH minor units; API adapter maps only the selected service.';
COMMENT ON COLUMN public.workspace_order_shipments.operation_status IS
  'unknown blocks automatic retries because the carrier may have created a waybill despite a lost response.';

COMMIT;
