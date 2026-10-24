import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ApiError } from "@/lib/api-error";
import type { AccessContext } from "@/lib/access/access.server";
import { decryptNovaPoshtaApiKey, encryptNovaPoshtaApiKey } from "./credentials.server";
import {
  createNovaPoshtaWaybill,
  NovaPoshtaRejectedError,
  NovaPoshtaUnsupportedOperationError,
  searchNovaPoshtaDirectory,
  validateNovaPoshtaReferences,
} from "./nova-poshta.server";
import type {
  DirectoryOption,
  NovaPoshtaDirectoryKind,
  NovaPoshtaDirectoryPurpose,
  NovaPoshtaSettings,
  OrderDelivery,
} from "./types";
import type { NovaPoshtaSettingsInputType } from "./validation";
import { getWaybillMissingFields } from "./validation";

type UserClient = SupabaseClient<Database>;
type SettingsRow = Database["public"]["Tables"]["workspace_nova_poshta_settings"]["Row"];

const settingsSelect =
  "workspace_id, api_version, encrypted_api_key, sender_name, sender_phone, sender_email, sender_company_name, sender_company_tin, sender_counterparty_ref, sender_counterparty_name, sender_contact_ref, sender_contact_name, sender_city_ref, sender_city_name, sender_branch_ref, sender_branch_name, created_at, updated_at, created_by_user_id, updated_by_user_id";

function toSettings(row: SettingsRow): NovaPoshtaSettings {
  return {
    apiKeyConfigured: Boolean(row.encrypted_api_key),
    senderName: row.sender_name ?? "",
    senderPhone: row.sender_phone ?? "",
    senderEmail: row.sender_email ?? "",
    senderCompanyName: row.sender_company_name ?? "",
    senderCompanyTin: row.sender_company_tin ?? "",
    senderCounterpartyRef: row.sender_counterparty_ref ?? "",
    senderCounterpartyName: row.sender_counterparty_name ?? "",
    senderContactRef: row.sender_contact_ref ?? "",
    senderContactName: row.sender_contact_name ?? "",
    senderCityRef: row.sender_city_ref ?? "",
    senderCityName: row.sender_city_name ?? "",
    senderBranchRef: row.sender_branch_ref ?? "",
    senderBranchName: row.sender_branch_name ?? "",
  };
}

async function readSettings(workspaceId: string): Promise<SettingsRow | null> {
  const { data, error } = await supabaseAdmin
    .from("workspace_nova_poshta_settings")
    .select(settingsSelect)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Delivery settings could not be loaded", "INTERNAL_ERROR");
  return data;
}

async function getDecryptedApiKey(settings: SettingsRow): Promise<string> {
  try {
    return await decryptNovaPoshtaApiKey(settings.encrypted_api_key);
  } catch {
    throw new ApiError(500, "Secure delivery credentials are unavailable", "INTERNAL_ERROR");
  }
}

export async function getNovaPoshtaSettings(
  workspaceId: string,
): Promise<NovaPoshtaSettings | null> {
  const row = await readSettings(workspaceId);
  return row ? toSettings(row) : null;
}

export async function saveNovaPoshtaSettings(
  workspaceId: string,
  userId: string,
  input: NovaPoshtaSettingsInputType,
): Promise<NovaPoshtaSettings> {
  const current = await readSettings(workspaceId);
  let encryptedApiKey = current?.encrypted_api_key;
  if (input.apiKey?.trim()) {
    try {
      encryptedApiKey = await encryptNovaPoshtaApiKey(input.apiKey.trim());
    } catch {
      throw new ApiError(500, "Secure credential storage is not configured", "INTERNAL_ERROR");
    }
  }
  if (!encryptedApiKey) {
    throw new ApiError(400, "Enter a Nova Poshta API key", "VALIDATION_ERROR");
  }

  const { data, error } = await supabaseAdmin
    .from("workspace_nova_poshta_settings")
    .upsert(
      {
        workspace_id: workspaceId,
        encrypted_api_key: encryptedApiKey,
        sender_name: input.senderName || null,
        sender_phone: input.senderPhone || null,
        sender_email: input.senderEmail || null,
        sender_company_name: input.senderCompanyName || null,
        sender_company_tin: input.senderCompanyTin || null,
        sender_counterparty_ref: input.senderCounterpartyRef || null,
        sender_counterparty_name: input.senderCounterpartyName || null,
        sender_contact_ref: input.senderContactRef || null,
        sender_contact_name: input.senderContactName || null,
        sender_city_ref: input.senderCityRef || null,
        sender_city_name: input.senderCityName || null,
        sender_branch_ref: input.senderBranchRef || null,
        sender_branch_name: input.senderBranchName || null,
        updated_by_user_id: userId,
        ...(current ? {} : { created_by_user_id: userId }),
      },
      { onConflict: "workspace_id" },
    )
    .select(settingsSelect)
    .single();
  if (error || !data) {
    throw new ApiError(500, "Delivery settings could not be saved", "INTERNAL_ERROR");
  }
  return toSettings(data);
}

export async function getNovaPoshtaDirectory(
  workspaceId: string,
  kind: NovaPoshtaDirectoryKind,
  search: string,
  cityRef: string | null,
  purpose: NovaPoshtaDirectoryPurpose,
  counterpartyRef: string | null,
): Promise<DirectoryOption[]> {
  const row = await readSettings(workspaceId);
  if (!row) throw new ApiError(409, "Save the Nova Poshta connection first", "CONFLICT");
  const apiKey = await getDecryptedApiKey(row);
  try {
    return await searchNovaPoshtaDirectory(apiKey, kind, search, cityRef, purpose, counterpartyRef);
  } catch (error) {
    if (error instanceof NovaPoshtaRejectedError) {
      throw new ApiError(502, "Nova Poshta rejected the directory request", "INTERNAL_ERROR");
    }
    throw new ApiError(502, "Nova Poshta directory is temporarily unavailable", "INTERNAL_ERROR");
  }
}

export async function saveOrderDelivery(
  client: UserClient,
  workspaceId: string,
  orderId: string,
  input: {
    deliveryType: string | null;
    cityRef: string | null;
    cityName: string | null;
    branchRef: string | null;
    branchName: string | null;
    weightGrams: number | null;
    lengthMm: number | null;
    widthMm: number | null;
    heightMm: number | null;
    declaredValueMinor: number | null;
    payer: string | null;
    paymentMethod: string | null;
    codAmountMinor: number | null;
    codService: string | null;
  },
): Promise<{ id: string }> {
  const { data, error } = await client.rpc("save_workspace_order_delivery", {
    p_workspace_id: workspaceId,
    p_order_id: orderId,
    p_delivery_type: input.deliveryType,
    p_city_ref: input.cityRef,
    p_city_name: input.cityName,
    p_branch_ref: input.branchRef,
    p_branch_name: input.branchName,
    p_weight_grams: input.weightGrams,
    p_length_mm: input.lengthMm,
    p_width_mm: input.widthMm,
    p_height_mm: input.heightMm,
    p_declared_value_minor: input.declaredValueMinor,
    p_delivery_payer: input.payer,
    p_delivery_payment_method: input.paymentMethod,
    p_cod_service: input.codService,
    p_cod_amount_minor: input.codAmountMinor,
  });
  if (error) {
    if (error.code === "42501") throw new ApiError(403, "Insufficient workspace permissions");
    if (error.code === "P0002") throw new ApiError(404, "Order not found");
    if (error.code === "23514")
      throw new ApiError(409, "Delivery cannot be changed in its current state");
    if (error.code === "22023")
      throw new ApiError(400, "Invalid delivery data", "VALIDATION_ERROR");
    throw new ApiError(500, "Delivery details could not be saved", "INTERNAL_ERROR");
  }
  if (!data) throw new ApiError(500, "Delivery details could not be saved", "INTERNAL_ERROR");
  return { id: data };
}

export async function getOrderDelivery(
  client: UserClient,
  workspaceId: string,
  orderId: string,
): Promise<OrderDelivery | null> {
  const { data, error } = await client
    .from("workspace_order_shipments")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("order_id", orderId)
    .maybeSingle();
  if (error) throw new ApiError(500, "Delivery details could not be loaded", "INTERNAL_ERROR");
  return data;
}

async function finishAttempt(
  client: UserClient,
  workspaceId: string,
  orderId: string,
  operationId: string,
  status: "created" | "failed" | "unknown",
  shipmentRef: string | null = null,
  trackingNumber: string | null = null,
  errorCode: string | null = null,
): Promise<void> {
  const { error } = await client.rpc("finish_workspace_order_waybill", {
    p_workspace_id: workspaceId,
    p_order_id: orderId,
    p_operation_id: operationId,
    p_operation_status: status,
    p_shipment_ref: shipmentRef,
    p_tracking_number: trackingNumber,
    p_error_code: errorCode,
  });
  if (error)
    throw new ApiError(
      503,
      "Waybill state could not be saved; check Nova Poshta before retrying",
      "INTERNAL_ERROR",
    );
}

export async function createOrderWaybill(
  context: AccessContext,
  workspaceId: string,
  orderId: string,
): Promise<OrderDelivery> {
  const { data: order, error: orderError } = await context.client
    .from("workspace_orders")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("id", orderId)
    .maybeSingle();
  if (orderError) throw new ApiError(500, "Order could not be loaded", "INTERNAL_ERROR");
  if (!order) throw new ApiError(404, "Order not found");
  if (order.status !== "confirmed") {
    throw new ApiError(409, "Confirm the order before creating a waybill", "CONFLICT");
  }

  const [settingsRow, delivery] = await Promise.all([
    readSettings(workspaceId),
    getOrderDelivery(context.client, workspaceId, orderId),
  ]);
  if (!settingsRow)
    throw new ApiError(409, "Configure Nova Poshta in Administration first", "CONFLICT");
  if (!delivery)
    throw new ApiError(400, "Enter delivery details before creating a waybill", "VALIDATION_ERROR");
  const settings = toSettings(settingsRow);
  const missing = getWaybillMissingFields(
    deliveryInputFromRow(delivery),
    {
      name: order.buyer_name,
      phone: order.buyer_phone,
    },
    toSettings(settingsRow),
  );
  if (missing.length > 0) {
    if (missing.includes("novaPayPostPaymentUnverified")) {
      throw new ApiError(
        409,
        "NovaPay post-payment is blocked until its v2.0 API contract is verified",
        "CONFLICT",
      );
    }
    if (missing.includes("paymentControlUnverified")) {
      throw new ApiError(
        409,
        "Payment Control is blocked until its v2.0 API contract is verified",
        "CONFLICT",
      );
    }
    throw new ApiError(
      400,
      "Complete the required delivery details before creating a waybill",
      "VALIDATION_ERROR",
    );
  }

  const apiKey = await getDecryptedApiKey(settingsRow);
  try {
    const referencesAreValid = await validateNovaPoshtaReferences(apiKey, settings, delivery);
    if (!referencesAreValid) {
      throw new ApiError(
        400,
        "Refresh the selected Nova Poshta city or division",
        "VALIDATION_ERROR",
      );
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof NovaPoshtaRejectedError) {
      throw new ApiError(
        502,
        "Nova Poshta could not verify the selected references",
        "INTERNAL_ERROR",
      );
    }
    throw new ApiError(502, "Nova Poshta directory is temporarily unavailable", "INTERNAL_ERROR");
  }

  const operationId = crypto.randomUUID();
  const claim = await context.client.rpc("claim_workspace_order_waybill", {
    p_workspace_id: workspaceId,
    p_order_id: orderId,
    p_operation_id: operationId,
  });
  if (claim.error) {
    if (claim.error.code === "42501") throw new ApiError(403, "Insufficient workspace permissions");
    if (claim.error.code === "P0002") throw new ApiError(404, "Order not found");
    if (claim.error.code === "23514")
      throw new ApiError(409, "Only confirmed orders can have a waybill", "CONFLICT");
    if (claim.error.code === "22023")
      throw new ApiError(
        400,
        "Complete the required delivery details before creating a waybill",
        "VALIDATION_ERROR",
      );
    throw new ApiError(500, "Waybill creation could not be started", "INTERNAL_ERROR");
  }
  const claimResult = claim.data?.[0];
  if (!claimResult?.claimed) {
    const current = await getOrderDelivery(context.client, workspaceId, orderId);
    if (current?.operation_status === "created") return current;
    if (current?.operation_status === "unknown" || current?.operation_status === "creating") {
      throw new ApiError(
        409,
        "A waybill attempt is still unresolved. Check Nova Poshta before trying again.",
        "CONFLICT",
      );
    }
    throw new ApiError(409, "The waybill request is already being processed", "CONFLICT");
  }

  let waybillRequestStarted = false;
  try {
    const result = await createNovaPoshtaWaybill(apiKey, settings, delivery, order, fetch, () => {
      waybillRequestStarted = true;
    });
    await finishAttempt(
      context.client,
      workspaceId,
      orderId,
      operationId,
      "created",
      result.shipmentRef,
      result.trackingNumber,
    );
  } catch (error) {
    if (error instanceof NovaPoshtaUnsupportedOperationError) {
      await finishAttempt(
        context.client,
        workspaceId,
        orderId,
        operationId,
        "failed",
        null,
        null,
        error.code,
      );
      throw new ApiError(
        409,
        "This Nova Poshta operation is not verified for API v2.0",
        "CONFLICT",
      );
    }
    const state =
      error instanceof NovaPoshtaRejectedError || !waybillRequestStarted ? "failed" : "unknown";
    await finishAttempt(
      context.client,
      workspaceId,
      orderId,
      operationId,
      state,
      null,
      null,
      state === "unknown" ? "carrier_result_unknown" : "carrier_rejected",
    );
    if (state === "unknown") {
      throw new ApiError(
        409,
        "The result is unknown. Check Nova Poshta before retrying.",
        "CONFLICT",
      );
    }
    throw new ApiError(502, "Nova Poshta could not create the waybill", "INTERNAL_ERROR");
  }

  const saved = await getOrderDelivery(context.client, workspaceId, orderId);
  if (!saved)
    throw new ApiError(
      500,
      "Waybill was created but its details could not be loaded",
      "INTERNAL_ERROR",
    );
  return saved;
}

function deliveryInputFromRow(delivery: OrderDelivery) {
  return {
    deliveryType: delivery.delivery_type,
    cityRef: delivery.recipient_city_ref,
    cityName: delivery.recipient_city_name,
    branchRef: delivery.recipient_branch_ref,
    branchName: delivery.recipient_branch_name,
    weightGrams: delivery.weight_grams,
    lengthMm: delivery.length_mm,
    widthMm: delivery.width_mm,
    heightMm: delivery.height_mm,
    declaredValueMinor: delivery.declared_value_minor,
    payer: delivery.delivery_payer,
    paymentMethod: delivery.delivery_payment_method,
    codAmountMinor: delivery.cod_amount_minor,
    codService: delivery.cod_service,
  };
}
