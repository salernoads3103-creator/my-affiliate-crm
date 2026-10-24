import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { PublicIntakeBackend } from "./handler";

type IntakeClient = SupabaseClient<Database>;

export class LandingIntakeService implements PublicIntakeBackend {
  constructor(private readonly client: IntakeClient) {}

  async consumeIpRateLimit(ipHash: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("consume_landing_intake_ip_limit", {
      p_ip_hash: ipHash,
    });
    if (error) throw error;
    return data === true;
  }

  async isOriginAllowed(origin: string, publicFormId?: string): Promise<boolean> {
    const result = publicFormId
      ? await this.client.rpc("is_landing_form_origin_allowed", {
          p_public_id: publicFormId,
          p_origin: origin,
        })
      : await this.client.rpc("is_landing_origin_allowed", { p_origin: origin });
    if (result.error) throw result.error;
    return result.data === true;
  }

  async submit(input: Parameters<PublicIntakeBackend["submit"]>[0]) {
    const { payload } = input;
    const { data, error } = await this.client.rpc("create_public_landing_lead_with_click_ids", {
      p_public_id: input.formId,
      p_request_key_hash: input.requestKeyHash,
      p_ip_hash: input.ipHash,
      p_origin: input.origin,
      p_name: payload.name,
      p_phone: payload.phone,
      p_phone_normalized: payload.phoneNormalized,
      p_email: payload.email,
      p_utm_source: payload.utmSource ?? null,
      p_utm_medium: payload.utmMedium ?? null,
      p_utm_campaign: payload.utmCampaign ?? null,
      p_utm_content: payload.utmContent ?? null,
      p_utm_term: payload.utmTerm ?? null,
      p_ttclid: payload.ttclid ?? null,
      p_gclid: payload.gclid ?? null,
      p_gbraid: payload.gbraid ?? null,
      p_wbraid: payload.wbraid ?? null,
      p_sub_id: payload.subId ?? null,
      p_delivery_type: payload.deliveryType ?? null,
      p_city_ref: payload.cityRef ?? null,
      p_city_name: payload.cityName ?? null,
      p_warehouse_ref: payload.warehouseRef ?? null,
      p_warehouse_name: payload.warehouseName ?? null,
    });
    if (error) throw error;
    if (data === "accepted" || data === "rate_limited" || data === "unavailable") return data;
    throw new Error("Unexpected landing intake response");
  }
}
