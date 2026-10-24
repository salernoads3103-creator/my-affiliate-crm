export const DELIVERY_TYPES = ["warehouse", "postomat", "address"] as const;
export const DELIVERY_PAYERS = ["Sender", "Recipient", "ThirdPerson"] as const;
export const DELIVERY_PAYMENT_METHODS = ["Cash", "NonCash"] as const;
export const COD_SERVICES = ["novapay", "payment_control"] as const;

export type DeliveryType = (typeof DELIVERY_TYPES)[number];
export type DeliveryPayer = (typeof DELIVERY_PAYERS)[number];
export type DeliveryPaymentMethod = (typeof DELIVERY_PAYMENT_METHODS)[number];
export type CodService = (typeof COD_SERVICES)[number];
export type WaybillOperationStatus = "draft" | "creating" | "unknown" | "created" | "failed";

export type OrderDelivery = {
  id: string;
  workspace_id: string;
  order_id: string;
  provider: "nova_poshta";
  delivery_type: DeliveryType | null;
  recipient_city_ref: string | null;
  recipient_city_name: string | null;
  recipient_branch_ref: string | null;
  recipient_branch_name: string | null;
  weight_grams: number | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  declared_value_minor: number | null;
  delivery_payer: DeliveryPayer | null;
  delivery_payment_method: DeliveryPaymentMethod | null;
  cod_amount_minor: number | null;
  cod_service: CodService | null;
  operation_status: WaybillOperationStatus;
  operation_id: string | null;
  operation_started_at: string | null;
  shipment_ref: string | null;
  tracking_number: string | null;
  waybill_created_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderDeliveryInput = {
  deliveryType: DeliveryType | null;
  cityRef: string | null;
  cityName: string | null;
  branchRef: string | null;
  branchName: string | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  declaredValueMinor: number | null;
  payer: DeliveryPayer | null;
  paymentMethod: DeliveryPaymentMethod | null;
  codAmountMinor: number | null;
  codService: CodService | null;
};

export type DirectoryOption = {
  ref: string;
  description: string;
  detail?: string;
  cityRef?: string;
  cityName?: string;
  phone?: string;
};

export type NovaPoshtaSettings = {
  apiKeyConfigured: boolean;
  senderName: string;
  senderPhone: string;
  senderEmail: string;
  senderCompanyName: string;
  senderCompanyTin: string;
  senderCounterpartyRef: string;
  senderCounterpartyName: string;
  senderContactRef: string;
  senderContactName: string;
  senderCityRef: string;
  senderCityName: string;
  senderBranchRef: string;
  senderBranchName: string;
};

export type NovaPoshtaSettingsInput = Omit<NovaPoshtaSettings, "apiKeyConfigured"> & {
  apiKey?: string;
};

export type NovaPoshtaDirectoryKind =
  | "cities"
  | "divisions"
  | "senderProfiles"
  | "senderAddresses"
  | "senderContacts";
export type NovaPoshtaDirectoryPurpose = "sender" | "recipient";
