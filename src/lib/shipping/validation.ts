import { z } from "zod";
import type { NovaPoshtaSettings } from "./types";
import { COD_SERVICES, DELIVERY_PAYMENT_METHODS, DELIVERY_PAYERS, DELIVERY_TYPES } from "./types";

const novaPoshtaRef = z
  .string()
  .trim()
  .regex(/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i);
const nullableRef = novaPoshtaRef.nullable();
const nullableName = z.string().trim().min(1).max(500).nullable();
const nullableMoney = z.number().int().min(1).max(99_999_999_999).nullable();
const nullableDeclaredValue = z.number().int().min(101).max(999_999_999).nullable();

export const OrderDeliverySchema = z
  .object({
    deliveryType: z.enum(DELIVERY_TYPES).nullable(),
    cityRef: nullableRef,
    cityName: nullableName,
    branchRef: nullableRef,
    branchName: nullableName,
    weightGrams: z.number().int().min(1).max(30_000).nullable(),
    lengthMm: z.number().int().min(1).max(3_000).nullable(),
    widthMm: z.number().int().min(1).max(3_000).nullable(),
    heightMm: z.number().int().min(1).max(3_000).nullable(),
    declaredValueMinor: nullableDeclaredValue,
    payer: z.enum(DELIVERY_PAYERS).nullable(),
    paymentMethod: z.enum(DELIVERY_PAYMENT_METHODS).nullable(),
    codAmountMinor: nullableMoney,
    codService: z.enum(COD_SERVICES).nullable(),
  })
  .superRefine((value, context) => {
    if ((value.cityRef === null) !== (value.cityName === null)) {
      context.addIssue({ code: "custom", path: ["cityRef"], message: "Invalid delivery data" });
    }
    if ((value.branchRef === null) !== (value.branchName === null)) {
      context.addIssue({ code: "custom", path: ["branchRef"], message: "Invalid delivery data" });
    }
    if ((value.codAmountMinor === null) !== (value.codService === null)) {
      context.addIssue({ code: "custom", path: ["codService"], message: "Invalid delivery data" });
    }
  });

export const NovaPoshtaSettingsSchema = z
  .object({
    apiKey: z.string().trim().max(500).optional(),
    senderName: z.string().trim().max(100),
    senderPhone: z
      .string()
      .trim()
      .transform((value) => value.replace(/\D/g, ""))
      .refine(
        (value) => value.length === 0 || /^380\d{9}$/.test(value),
        "Enter a valid Ukrainian phone number",
      ),
    senderEmail: z
      .string()
      .trim()
      .max(254)
      .refine((value) => value === "" || z.string().email().safeParse(value).success),
    senderCompanyName: z.string().trim().max(100),
    senderCompanyTin: z.string().trim().max(20),
    senderCounterpartyRef: z.string().trim().max(100),
    senderCounterpartyName: z.string().trim().max(200),
    senderContactRef: z.string().trim().max(100),
    senderContactName: z.string().trim().max(200),
    senderCityRef: z.string().trim().max(100),
    senderCityName: z.string().trim().max(200),
    senderBranchRef: z.string().trim().max(100),
    senderBranchName: z.string().trim().max(500),
  })
  .superRefine((value, context) => {
    for (const field of [
      "senderCounterpartyRef",
      "senderContactRef",
      "senderCityRef",
      "senderBranchRef",
    ] as const) {
      const ref = value[field];
      if (ref !== "" && !novaPoshtaRef.safeParse(ref).success) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: "Select a valid Nova Poshta reference",
        });
      }
    }
    if ((value.senderCounterpartyRef === "") !== (value.senderCounterpartyName === "")) {
      context.addIssue({
        code: "custom",
        path: ["senderCounterpartyRef"],
        message: "Select a sender profile",
      });
    }
    if ((value.senderContactRef === "") !== (value.senderContactName === "")) {
      context.addIssue({
        code: "custom",
        path: ["senderContactRef"],
        message: "Select a contact person",
      });
    }
    if ((value.senderCityRef === "") !== (value.senderCityName === "")) {
      context.addIssue({
        code: "custom",
        path: ["senderCityRef"],
        message: "Select a sender city",
      });
    }
    if ((value.senderBranchRef === "") !== (value.senderBranchName === "")) {
      context.addIssue({
        code: "custom",
        path: ["senderBranchRef"],
        message: "Select a sender branch",
      });
    }
  });

export type OrderDeliveryInputType = z.infer<typeof OrderDeliverySchema>;
export type NovaPoshtaSettingsInputType = z.infer<typeof NovaPoshtaSettingsSchema>;

export function getWaybillMissingFields(
  delivery: OrderDeliveryInputType,
  buyer: { name: string; phone: string },
  settings: NovaPoshtaSettings | null,
): string[] {
  const missing: string[] = [];
  if (!settings?.apiKeyConfigured) missing.push("apiKey");
  if (!settings?.senderCounterpartyRef || !settings.senderCounterpartyName)
    missing.push("senderProfile");
  if (!settings?.senderContactRef || !settings.senderContactName) missing.push("senderContact");
  if (!settings?.senderName) missing.push("senderName");
  if (!settings?.senderPhone || !/^380\d{9}$/.test(settings.senderPhone))
    missing.push("senderPhone");
  if (!settings?.senderCityRef || !settings.senderCityName) missing.push("senderCity");
  if (!settings?.senderBranchRef || !settings.senderBranchName) missing.push("senderBranch");
  if (!buyer.name.trim()) missing.push("recipientName");
  if (!/^\+380\d{9}$/.test(buyer.phone)) missing.push("recipientPhone");
  if (delivery.deliveryType === null) {
    missing.push("deliveryType");
  } else if (delivery.deliveryType !== "warehouse" && delivery.deliveryType !== "postomat") {
    missing.push("unsupportedDeliveryType");
  }
  if (!delivery.cityRef || !delivery.cityName) missing.push("city");
  if (!delivery.branchRef || !delivery.branchName) missing.push("branch");
  if (!delivery.weightGrams) missing.push("weightGrams");
  if (!delivery.lengthMm) missing.push("lengthMm");
  if (!delivery.widthMm) missing.push("widthMm");
  if (!delivery.heightMm) missing.push("heightMm");
  if (delivery.declaredValueMinor === null) {
    missing.push("declaredValueMinor");
  }
  if (!delivery.payer) missing.push("payer");
  if (!delivery.paymentMethod) missing.push("paymentMethod");
  if (delivery.codAmountMinor !== null && delivery.codService === "novapay") {
    missing.push("novaPayPostPaymentUnverified");
  }
  if (delivery.codAmountMinor !== null && delivery.codService === "payment_control") {
    missing.push("paymentControlUnverified");
  }
  if (delivery.payer === "ThirdPerson") {
    missing.push("thirdPartyPayerNotSupported");
  }
  return missing;
}
