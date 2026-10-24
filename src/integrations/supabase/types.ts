export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      leads: {
        Row: {
          company_name: string | null;
          created_at: string;
          created_by_user_id: string | null;
          created_via: "manual" | "landing" | "api" | "import";
          delivery_city_name: string | null;
          delivery_city_ref: string | null;
          delivery_provider: string | null;
          delivery_type: "warehouse" | "postomat" | "address" | null;
          delivery_warehouse_name: string | null;
          delivery_warehouse_ref: string | null;
          email: string | null;
          gbraid: string | null;
          gclid: string | null;
          id: string;
          lead_status: Database["public"]["Enums"]["lead_status"];
          name: string;
          notes: string | null;
          offer_id: string | null;
          operator_id: string | null;
          phone: string | null;
          phone_normalized: string | null;
          sub_id: string | null;
          team_id: string | null;
          traffic_source: string | null;
          ttclid: string | null;
          wbraid: string | null;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_id: string | null;
          utm_medium: string | null;
          utm_source: string | null;
          utm_term: string | null;
          updated_at: string;
          user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          company_name?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          created_via?: "manual" | "landing" | "api" | "import";
          delivery_city_name?: string | null;
          delivery_city_ref?: string | null;
          delivery_provider?: string | null;
          delivery_type?: "warehouse" | "postomat" | "address" | null;
          delivery_warehouse_name?: string | null;
          delivery_warehouse_ref?: string | null;
          email?: string | null;
          gbraid?: string | null;
          gclid?: string | null;
          id?: string;
          lead_status?: Database["public"]["Enums"]["lead_status"];
          name: string;
          notes?: string | null;
          offer_id?: string | null;
          operator_id?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          sub_id?: string | null;
          team_id?: string | null;
          traffic_source?: string | null;
          ttclid?: string | null;
          wbraid?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_id?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          updated_at?: string;
          user_id?: string | null;
          workspace_id?: string;
        };
        Update: {
          company_name?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          created_via?: "manual" | "landing" | "api" | "import";
          delivery_city_name?: string | null;
          delivery_city_ref?: string | null;
          delivery_provider?: string | null;
          delivery_type?: "warehouse" | "postomat" | "address" | null;
          delivery_warehouse_name?: string | null;
          delivery_warehouse_ref?: string | null;
          email?: string | null;
          gbraid?: string | null;
          gclid?: string | null;
          id?: string;
          lead_status?: Database["public"]["Enums"]["lead_status"];
          name?: string;
          notes?: string | null;
          offer_id?: string | null;
          operator_id?: string | null;
          phone?: string | null;
          phone_normalized?: string | null;
          sub_id?: string | null;
          team_id?: string | null;
          traffic_source?: string | null;
          ttclid?: string | null;
          wbraid?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_id?: string | null;
          utm_medium?: string | null;
          utm_source?: string | null;
          utm_term?: string | null;
          updated_at?: string;
          user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          is_active: boolean;
          height_mm: number | null;
          length_mm: number | null;
          name: string;
          photo_url: string | null;
          sale_price_minor: number;
          sku: string | null;
          supplier_name: string | null;
          updated_at: string;
          weight_grams: number | null;
          width_mm: number | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          id?: string;
          is_active?: boolean;
          height_mm?: number | null;
          length_mm?: number | null;
          name: string;
          photo_url?: string | null;
          sale_price_minor: number;
          sku?: string | null;
          supplier_name?: string | null;
          updated_at?: string;
          weight_grams?: number | null;
          width_mm?: number | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          is_active?: boolean;
          height_mm?: number | null;
          length_mm?: number | null;
          name?: string;
          photo_url?: string | null;
          sale_price_minor?: number;
          sku?: string | null;
          supplier_name?: string | null;
          updated_at?: string;
          weight_grams?: number | null;
          width_mm?: number | null;
          workspace_id?: string;
        };
        Relationships: [];
      };
      product_costs: {
        Row: {
          cost_price_minor: number | null;
          product_id: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          cost_price_minor?: number | null;
          product_id: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          cost_price_minor?: number | null;
          product_id?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [];
      };
      workspace_offers: {
        Row: {
          created_at: string;
          currency: string;
          id: string;
          is_active: boolean;
          landing_url: string | null;
          name: string;
          offer_price_minor: number | null;
          product_id: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          currency?: string;
          id?: string;
          is_active?: boolean;
          landing_url?: string | null;
          name: string;
          offer_price_minor?: number | null;
          product_id?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          currency?: string;
          id?: string;
          is_active?: boolean;
          landing_url?: string | null;
          name?: string;
          offer_price_minor?: number | null;
          product_id?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [];
      };
      workspace_orders: {
        Row: {
          buyer_email: string | null;
          buyer_name: string;
          buyer_phone: string;
          cancelled_at: string | null;
          confirmed_at: string | null;
          created_at: string;
          created_by_user_id: string | null;
          currency: string;
          id: string;
          idempotency_key: string;
          lead_id: string;
          offer_id: string;
          offer_name_snapshot: string;
          operator_comment: string | null;
          product_height_mm_snapshot: number | null;
          product_id: string;
          product_length_mm_snapshot: number | null;
          product_name_snapshot: string;
          product_sku_snapshot: string | null;
          product_weight_grams_snapshot: number | null;
          product_width_mm_snapshot: number | null;
          quantity: number;
          status: "draft" | "confirmed" | "cancelled";
          total_amount_minor: number;
          unit_price_minor: number;
          updated_at: string;
          updated_by_user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          buyer_email?: string | null;
          buyer_name: string;
          buyer_phone: string;
          cancelled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          currency?: string;
          id?: string;
          idempotency_key: string;
          lead_id: string;
          offer_id: string;
          offer_name_snapshot: string;
          operator_comment?: string | null;
          product_height_mm_snapshot?: number | null;
          product_id: string;
          product_length_mm_snapshot?: number | null;
          product_name_snapshot: string;
          product_sku_snapshot?: string | null;
          product_weight_grams_snapshot?: number | null;
          product_width_mm_snapshot?: number | null;
          quantity?: number;
          status?: "draft" | "confirmed" | "cancelled";
          total_amount_minor?: never;
          unit_price_minor: number;
          updated_at?: string;
          updated_by_user_id?: string | null;
          workspace_id: string;
        };
        Update: {
          buyer_email?: string | null;
          buyer_name?: string;
          buyer_phone?: string;
          cancelled_at?: string | null;
          confirmed_at?: string | null;
          created_at?: string;
          created_by_user_id?: string | null;
          currency?: string;
          id?: string;
          idempotency_key?: string;
          lead_id?: string;
          offer_id?: string;
          offer_name_snapshot?: string;
          operator_comment?: string | null;
          product_height_mm_snapshot?: number | null;
          product_id?: string;
          product_length_mm_snapshot?: number | null;
          product_name_snapshot?: string;
          product_sku_snapshot?: string | null;
          product_weight_grams_snapshot?: number | null;
          product_width_mm_snapshot?: number | null;
          quantity?: number;
          status?: "draft" | "confirmed" | "cancelled";
          total_amount_minor?: never;
          unit_price_minor?: number;
          updated_at?: string;
          updated_by_user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [];
      };
      workspace_nova_poshta_settings: {
        Row: {
          api_version: "v2.0";
          created_at: string;
          created_by_user_id: string | null;
          encrypted_api_key: string;
          sender_branch_name: string | null;
          sender_branch_ref: string | null;
          sender_city_name: string | null;
          sender_city_ref: string | null;
          sender_contact_name: string | null;
          sender_contact_ref: string | null;
          sender_counterparty_name: string | null;
          sender_counterparty_ref: string | null;
          sender_company_name: string | null;
          sender_company_tin: string | null;
          sender_email: string | null;
          sender_name: string | null;
          sender_phone: string | null;
          updated_at: string;
          updated_by_user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          api_version?: "v2.0";
          created_at?: string;
          created_by_user_id?: string | null;
          encrypted_api_key: string;
          sender_branch_name?: string | null;
          sender_branch_ref?: string | null;
          sender_city_name?: string | null;
          sender_city_ref?: string | null;
          sender_contact_name?: string | null;
          sender_contact_ref?: string | null;
          sender_counterparty_name?: string | null;
          sender_counterparty_ref?: string | null;
          sender_company_name?: string | null;
          sender_company_tin?: string | null;
          sender_email?: string | null;
          sender_name?: string | null;
          sender_phone?: string | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          workspace_id: string;
        };
        Update: {
          api_version?: "v2.0";
          created_at?: string;
          created_by_user_id?: string | null;
          encrypted_api_key?: string;
          sender_branch_name?: string | null;
          sender_branch_ref?: string | null;
          sender_city_name?: string | null;
          sender_city_ref?: string | null;
          sender_contact_name?: string | null;
          sender_contact_ref?: string | null;
          sender_counterparty_name?: string | null;
          sender_counterparty_ref?: string | null;
          sender_company_name?: string | null;
          sender_company_tin?: string | null;
          sender_email?: string | null;
          sender_name?: string | null;
          sender_phone?: string | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [];
      };
      workspace_order_shipments: {
        Row: {
          cod_amount_minor: number | null;
          cod_service: "novapay" | "payment_control" | null;
          created_at: string;
          created_by_user_id: string | null;
          declared_value_minor: number | null;
          delivery_payer: "Sender" | "Recipient" | "ThirdPerson" | null;
          delivery_payment_method: "Cash" | "NonCash" | null;
          delivery_type: "warehouse" | "postomat" | "address" | null;
          id: string;
          length_mm: number | null;
          last_error_code: string | null;
          operation_id: string | null;
          operation_started_at: string | null;
          operation_status: "draft" | "creating" | "unknown" | "created" | "failed";
          order_id: string;
          provider: "nova_poshta";
          provider_api_version: "v2.0";
          recipient_branch_name: string | null;
          recipient_branch_ref: string | null;
          recipient_city_name: string | null;
          recipient_city_ref: string | null;
          shipment_ref: string | null;
          tracking_number: string | null;
          width_mm: number | null;
          height_mm: number | null;
          updated_at: string;
          updated_by_user_id: string | null;
          waybill_created_at: string | null;
          weight_grams: number | null;
          workspace_id: string;
        };
        Insert: {
          cod_amount_minor?: number | null;
          cod_service?: "novapay" | "payment_control" | null;
          created_at?: string;
          created_by_user_id?: string | null;
          declared_value_minor?: number | null;
          delivery_payer?: "Sender" | "Recipient" | "ThirdPerson" | null;
          delivery_payment_method?: "Cash" | "NonCash" | null;
          delivery_type?: "warehouse" | "postomat" | "address" | null;
          id?: string;
          length_mm?: number | null;
          last_error_code?: string | null;
          operation_id?: string | null;
          operation_started_at?: string | null;
          operation_status?: "draft" | "creating" | "unknown" | "created" | "failed";
          order_id: string;
          provider?: "nova_poshta";
          provider_api_version?: "v2.0";
          recipient_branch_name?: string | null;
          recipient_branch_ref?: string | null;
          recipient_city_name?: string | null;
          recipient_city_ref?: string | null;
          shipment_ref?: string | null;
          tracking_number?: string | null;
          width_mm?: number | null;
          height_mm?: number | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          waybill_created_at?: string | null;
          weight_grams?: number | null;
          workspace_id: string;
        };
        Update: {
          cod_amount_minor?: number | null;
          cod_service?: "novapay" | "payment_control" | null;
          created_at?: string;
          created_by_user_id?: string | null;
          declared_value_minor?: number | null;
          delivery_payer?: "Sender" | "Recipient" | "ThirdPerson" | null;
          delivery_payment_method?: "Cash" | "NonCash" | null;
          delivery_type?: "warehouse" | "postomat" | "address" | null;
          id?: string;
          length_mm?: number | null;
          last_error_code?: string | null;
          operation_id?: string | null;
          operation_started_at?: string | null;
          operation_status?: "draft" | "creating" | "unknown" | "created" | "failed";
          order_id?: string;
          provider?: "nova_poshta";
          provider_api_version?: "v2.0";
          recipient_branch_name?: string | null;
          recipient_branch_ref?: string | null;
          recipient_city_name?: string | null;
          recipient_city_ref?: string | null;
          shipment_ref?: string | null;
          tracking_number?: string | null;
          width_mm?: number | null;
          height_mm?: number | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          waybill_created_at?: string | null;
          weight_grams?: number | null;
          workspace_id?: string;
        };
        Relationships: [];
      };
      landing_form_integrations: {
        Row: {
          allowed_origin: string;
          created_at: string;
          created_by_user_id: string | null;
          id: string;
          is_active: boolean;
          offer_id: string;
          public_id: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          allowed_origin: string;
          created_at?: string;
          created_by_user_id?: string | null;
          id?: string;
          is_active?: boolean;
          offer_id: string;
          public_id?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          allowed_origin?: string;
          created_at?: string;
          created_by_user_id?: string | null;
          id?: string;
          is_active?: boolean;
          offer_id?: string;
          public_id?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [];
      };
      workspace_landings: {
        Row: {
          adapted_archive_bytes: number | null;
          adapted_archive_path: string | null;
          adapted_build_fingerprint: string | null;
          adapted_tracking_fingerprint: string | null;
          adapter_reason: string | null;
          adapter_status: string;
          analysis: Json;
          created_at: string;
          created_by_user_id: string | null;
          deletion_started_at: string | null;
          google_ads_conversion_id: string | null;
          google_ads_conversion_label: string | null;
          id: string;
          intake_public_id: string | null;
          google_ads_tracking_profile_id: string | null;
          name: string;
          offer_id: string;
          published_url: string | null;
          source_archive_path: string;
          source_archive_bytes: number | null;
          status: "draft" | "ready" | "published" | "error";
          tiktok_pixel_id: string | null;
          tiktok_tracking_profile_id: string | null;
          workspace_id: string;
        };
        Insert: {
          adapted_archive_bytes?: number | null;
          adapted_archive_path?: string | null;
          adapted_build_fingerprint?: string | null;
          adapted_tracking_fingerprint?: string | null;
          adapter_reason?: string | null;
          adapter_status?: string;
          analysis: Json;
          created_at?: string;
          created_by_user_id?: string | null;
          deletion_started_at?: string | null;
          google_ads_conversion_id?: string | null;
          google_ads_conversion_label?: string | null;
          id?: string;
          intake_public_id?: string | null;
          google_ads_tracking_profile_id?: string | null;
          name: string;
          offer_id: string;
          published_url?: string | null;
          source_archive_path: string;
          source_archive_bytes?: number | null;
          status?: "draft" | "ready" | "published" | "error";
          tiktok_pixel_id?: string | null;
          tiktok_tracking_profile_id?: string | null;
          workspace_id: string;
        };
        Update: {
          adapted_archive_bytes?: number | null;
          adapted_archive_path?: string | null;
          adapted_build_fingerprint?: string | null;
          adapted_tracking_fingerprint?: string | null;
          adapter_reason?: string | null;
          adapter_status?: string;
          analysis?: Json;
          created_at?: string;
          created_by_user_id?: string | null;
          deletion_started_at?: string | null;
          google_ads_conversion_id?: string | null;
          google_ads_conversion_label?: string | null;
          id?: string;
          intake_public_id?: string | null;
          google_ads_tracking_profile_id?: string | null;
          name?: string;
          offer_id?: string;
          published_url?: string | null;
          source_archive_path?: string;
          source_archive_bytes?: number | null;
          status?: "draft" | "ready" | "published" | "error";
          tiktok_pixel_id?: string | null;
          tiktok_tracking_profile_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [];
      };
      workspace_tracking_profiles: {
        Row: {
          created_at: string;
          created_by_user_id: string | null;
          google_ads_conversion_id: string | null;
          google_ads_conversion_label: string | null;
          id: string;
          is_active: boolean;
          name: string;
          platform: "tiktok" | "google_ads";
          tiktok_pixel_id: string | null;
          updated_at: string;
          updated_by_user_id: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          created_by_user_id?: string | null;
          google_ads_conversion_id?: string | null;
          google_ads_conversion_label?: string | null;
          id?: string;
          is_active?: boolean;
          name: string;
          platform: "tiktok" | "google_ads";
          tiktok_pixel_id?: string | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          created_by_user_id?: string | null;
          google_ads_conversion_id?: string | null;
          google_ads_conversion_label?: string | null;
          id?: string;
          is_active?: boolean;
          name?: string;
          platform?: "tiktok" | "google_ads";
          tiktok_pixel_id?: string | null;
          updated_at?: string;
          updated_by_user_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      accept_workspace_invitation: {
        Args: { p_token_hash: string };
        Returns: string;
      };
      create_workspace_invitation: {
        Args: {
          p_email: string;
          p_role: string;
          p_token_hash: string;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_product: {
        Args: {
          p_cost_price_minor: number | null;
          p_is_active: boolean;
          p_name: string;
          p_photo_url: string | null;
          p_sale_price_minor: number;
          p_sku: string | null;
          p_supplier_name: string | null;
          p_weight_grams: number | null;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_product_with_shipping_dimensions: {
        Args: {
          p_cost_price_minor: number | null;
          p_height_mm: number | null;
          p_is_active: boolean;
          p_length_mm: number | null;
          p_name: string;
          p_photo_url: string | null;
          p_sale_price_minor: number;
          p_sku: string | null;
          p_supplier_name: string | null;
          p_weight_grams: number | null;
          p_width_mm: number | null;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_workspace_order: {
        Args: {
          p_buyer_email: string | null;
          p_buyer_name: string;
          p_buyer_phone: string;
          p_idempotency_key: string;
          p_lead_id: string;
          p_operator_comment: string | null;
          p_quantity: number;
          p_unit_price_minor: number;
          p_workspace_id: string;
        };
        Returns: string;
      };
      update_product: {
        Args: {
          p_cost_price_minor: number | null;
          p_is_active: boolean;
          p_name: string;
          p_photo_url: string | null;
          p_product_id: string;
          p_sale_price_minor: number;
          p_sku: string | null;
          p_supplier_name: string | null;
          p_update_cost: boolean;
          p_weight_grams: number | null;
        };
        Returns: string;
      };
      update_product_with_shipping_dimensions: {
        Args: {
          p_cost_price_minor: number | null;
          p_height_mm: number | null;
          p_is_active: boolean;
          p_length_mm: number | null;
          p_name: string;
          p_photo_url: string | null;
          p_product_id: string;
          p_sale_price_minor: number;
          p_sku: string | null;
          p_supplier_name: string | null;
          p_update_cost: boolean;
          p_weight_grams: number | null;
          p_width_mm: number | null;
        };
        Returns: string;
      };
      get_workspace_offer_catalog: {
        Args: { p_search: string | null; p_workspace_id: string };
        Returns: {
          created_at: string;
          currency: string;
          id: string;
          is_active: boolean;
          landing_url: string | null;
          name: string;
          offer_price_minor: number | null;
          product_currency: string | null;
          product_id: string | null;
          product_name: string | null;
          product_photo_url: string | null;
          product_sale_price_minor: number | null;
          product_sku: string | null;
          updated_at: string;
          workspace_id: string;
        }[];
      };
      get_workspace_order_context: {
        Args: { p_lead_id: string; p_workspace_id: string };
        Returns: {
          buyer_email: string | null;
          buyer_phone: string | null;
          lead_id: string;
          lead_name: string;
          offer_id: string | null;
          offer_name: string | null;
          offer_price_minor: number | null;
          product_id: string | null;
          product_name: string | null;
          product_sale_price_minor: number | null;
          product_sku: string | null;
        }[];
      };
      get_workspace_order_context_v2: {
        Args: { p_lead_id: string; p_workspace_id: string };
        Returns: {
          buyer_email: string | null;
          buyer_phone: string | null;
          lead_id: string;
          lead_name: string;
          offer_id: string | null;
          offer_name: string | null;
          offer_price_minor: number | null;
          product_height_mm: number | null;
          product_id: string | null;
          product_length_mm: number | null;
          product_name: string | null;
          product_sale_price_minor: number | null;
          product_sku: string | null;
          product_weight_grams: number | null;
          product_width_mm: number | null;
        }[];
      };
      get_workspace_order_delivery_prefill: {
        Args: { p_lead_id: string; p_workspace_id: string };
        Returns: {
          branch_name: string | null;
          branch_ref: string | null;
          city_name: string | null;
          city_ref: string | null;
          delivery_type: string | null;
        }[];
      };
      save_workspace_order_delivery: {
        Args: {
          p_branch_name: string | null;
          p_branch_ref: string | null;
          p_city_name: string | null;
          p_city_ref: string | null;
          p_cod_amount_minor: number | null;
          p_cod_service: string | null;
          p_declared_value_minor: number | null;
          p_delivery_payer: string | null;
          p_delivery_payment_method: string | null;
          p_delivery_type: string | null;
          p_order_id: string;
          p_length_mm: number | null;
          p_width_mm: number | null;
          p_height_mm: number | null;
          p_weight_grams: number | null;
          p_workspace_id: string;
        };
        Returns: string;
      };
      claim_workspace_order_waybill: {
        Args: { p_operation_id: string; p_order_id: string; p_workspace_id: string };
        Returns: { claimed: boolean; operation_status: string }[];
      };
      finish_workspace_order_waybill: {
        Args: {
          p_error_code: string | null;
          p_operation_id: string;
          p_operation_status: string;
          p_order_id: string;
          p_shipment_ref: string | null;
          p_tracking_number: string | null;
          p_workspace_id: string;
        };
        Returns: string;
      };
      transition_workspace_order: {
        Args: { p_order_id: string; p_status: string; p_workspace_id: string };
        Returns: string;
      };
      update_workspace_order_draft: {
        Args: {
          p_buyer_email: string | null;
          p_buyer_name: string;
          p_buyer_phone: string;
          p_operator_comment: string | null;
          p_order_id: string;
          p_quantity: number;
          p_unit_price_minor: number;
          p_workspace_id: string;
        };
        Returns: string;
      };
      get_workspace_landings: {
        Args: { p_search: string | null; p_workspace_id: string };
        Returns: {
          adapted_archive_bytes: number | null;
          adapter_reason: string | null;
          adapter_status: string;
          analysis: Json;
          created_at: string;
          created_by_user_id: string | null;
          deletion_started_at: string | null;
          id: string;
          has_adapted_archive: boolean;
          name: string;
          offer_id: string;
          offer_name: string;
          published_url: string | null;
          source_archive_path: string;
          source_archive_bytes: number | null;
          status: string;
          tiktok_pixel_id: string | null;
          google_ads_conversion_id: string | null;
          google_ads_conversion_label: string | null;
          workspace_id: string;
        }[];
      };
      create_commercial_offer: {
        Args: {
          p_is_active: boolean;
          p_landing_url: string | null;
          p_name: string;
          p_offer_price_minor: number;
          p_product_id: string;
          p_workspace_id: string;
        };
        Returns: string;
      };
      get_landing_form_config: {
        Args: { p_offer_id: string; p_workspace_id: string };
        Returns: { allowed_origin: string; is_active: boolean; public_id: string }[];
      };
      create_landing_form_config: {
        Args: { p_allowed_origin: string; p_offer_id: string; p_workspace_id: string };
        Returns: { allowed_origin: string; is_active: boolean; public_id: string }[];
      };
      deactivate_landing_form_config: {
        Args: { p_offer_id: string; p_workspace_id: string };
        Returns: boolean;
      };
      ensure_landing_form_config_for_adapter: {
        Args: { p_landing_id: string; p_workspace_id: string };
        Returns: { allowed_origin: string; is_active: boolean; public_id: string }[];
      };
      configure_landing_form_origin_for_adapter: {
        Args: { p_allowed_origin: string; p_landing_id: string; p_workspace_id: string };
        Returns: { allowed_origin: string; is_active: boolean; public_id: string }[];
      };
      is_landing_origin_allowed: {
        Args: { p_origin: string };
        Returns: boolean;
      };
      is_landing_form_origin_allowed: {
        Args: { p_origin: string; p_public_id: string };
        Returns: boolean;
      };
      consume_landing_intake_ip_limit: {
        Args: { p_ip_hash: string };
        Returns: boolean;
      };
      create_public_landing_lead: {
        Args: {
          p_city_name: string | null;
          p_city_ref: string | null;
          p_delivery_type: string | null;
          p_email: string | null;
          p_ip_hash: string;
          p_name: string;
          p_origin: string | null;
          p_phone: string;
          p_phone_normalized: string;
          p_public_id: string;
          p_request_key_hash: string;
          p_sub_id: string | null;
          p_ttclid: string | null;
          p_utm_campaign: string | null;
          p_utm_content: string | null;
          p_utm_medium: string | null;
          p_utm_source: string | null;
          p_utm_term: string | null;
          p_warehouse_name: string | null;
          p_warehouse_ref: string | null;
        };
        Returns: string;
      };
      create_public_landing_lead_with_click_ids: {
        Args: {
          p_city_name: string | null;
          p_city_ref: string | null;
          p_delivery_type: string | null;
          p_email: string | null;
          p_gbraid: string | null;
          p_gclid: string | null;
          p_ip_hash: string;
          p_name: string;
          p_origin: string | null;
          p_phone: string;
          p_phone_normalized: string;
          p_public_id: string;
          p_request_key_hash: string;
          p_sub_id: string | null;
          p_ttclid: string | null;
          p_utm_campaign: string | null;
          p_utm_content: string | null;
          p_utm_medium: string | null;
          p_utm_source: string | null;
          p_utm_term: string | null;
          p_wbraid: string | null;
          p_warehouse_name: string | null;
          p_warehouse_ref: string | null;
        };
        Returns: string;
      };
      update_commercial_offer: {
        Args: {
          p_is_active: boolean;
          p_landing_url: string | null;
          p_name: string;
          p_offer_id: string;
          p_offer_price_minor: number;
          p_product_id: string;
          p_workspace_id: string;
        };
        Returns: string;
      };
      create_workspace_offer: {
        Args: { p_name: string; p_workspace_id: string };
        Returns: string;
      };
      create_workspace_team: {
        Args: { p_name: string; p_workspace_id: string };
        Returns: string;
      };
      get_workspace_invitations: {
        Args: { p_workspace_id: string };
        Returns: {
          created_at: string;
          email: string;
          expires_at: string;
          id: string;
          invited_by: string | null;
          role: string;
          status: string;
        }[];
      };
      get_workspace_access_audit: {
        Args: { p_limit: number; p_workspace_id: string };
        Returns: {
          action: string;
          actor_id: string | null;
          created_at: string;
          details: Json;
          id: number;
          subject_user_id: string | null;
        }[];
      };
      get_workspace_offers: {
        Args: { p_workspace_id: string };
        Returns: { created_at: string; id: string; name: string }[];
      };
      get_workspace_teams: {
        Args: { p_workspace_id: string };
        Returns: { created_at: string; id: string; name: string }[];
      };
      get_workspace_member_permissions: {
        Args: { p_user_id: string; p_workspace_id: string };
        Returns: {
          allowed: boolean;
          delegable: boolean;
          permission_key: string;
          scope_id: string | null;
          scope_type: string;
        }[];
      };
      get_workspace_members: {
        Args: { p_workspace_id: string };
        Returns: {
          created_at: string;
          email: string | null;
          role: string;
          status: string;
          user_id: string;
        }[];
      };
      has_workspace_permission: {
        Args: {
          p_offer_id: string | null;
          p_operator_id: string | null;
          p_permission_key: string;
          p_team_id: string | null;
          p_workspace_id: string;
        };
        Returns: boolean;
      };
      main_workspace_id: {
        Args: Record<PropertyKey, never>;
        Returns: string;
      };
      my_workspaces: {
        Args: Record<PropertyKey, never>;
        Returns: {
          id: string;
          is_super_admin: boolean;
          name: string;
          role: string;
          slug: string;
        }[];
      };
      permission_scope_matches: {
        Args: {
          p_actor_id: string;
          p_offer_id: string | null;
          p_operator_id: string | null;
          p_scope_id: string | null;
          p_scope_type: Database["public"]["Enums"]["workspace_scope_type"];
          p_team_id: string | null;
          p_workspace_id: string;
        };
        Returns: boolean;
      };
      revoke_workspace_invitation: {
        Args: { p_invitation_id: string; p_workspace_id: string };
        Returns: boolean;
      };
      set_workspace_member_permission: {
        Args: {
          p_allowed: boolean | null;
          p_delegable: boolean;
          p_permission_key: string;
          p_scope_id: string | null;
          p_scope_type: string;
          p_user_id: string;
          p_workspace_id: string;
        };
        Returns: boolean;
      };
      set_workspace_member_role: {
        Args: { p_role: string; p_user_id: string; p_workspace_id: string };
        Returns: boolean;
      };
      validate_workspace_invitation: {
        Args: { p_token_hash: string };
        Returns: {
          email: string;
          expires_at: string;
          role: string;
          workspace_name: string;
        }[];
      };
    };
    Enums: {
      lead_status: "New" | "Contacted" | "Qualified" | "Converted" | "Lost";
      workspace_member_role: "admin" | "operator" | "viewer";
      workspace_permission_authority: "super_admin" | "admin";
      workspace_scope_type: "workspace" | "team" | "operator" | "offer";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      lead_status: ["New", "Contacted", "Qualified", "Converted", "Lost"],
      workspace_member_role: ["admin", "operator", "viewer"],
      workspace_permission_authority: ["super_admin", "admin"],
      workspace_scope_type: ["workspace", "team", "operator", "offer"],
    },
  },
} as const;
