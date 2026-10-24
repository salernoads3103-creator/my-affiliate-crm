import { z } from "zod";
import { normalizeUkrainianPhone } from "@/lib/leads/phone";
import { ORDER_STATUSES } from "./types";

const MAX_UNIT_PRICE_MINOR = 99_999_999_999;
const uuidSchema = z.string().uuid("Invalid order data");
const phoneSchema = z
  .string()
  .trim()
  .min(1, "Phone is required")
  .max(40)
  .transform((value, context) => {
    const normalized = normalizeUkrainianPhone(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Invalid phone" });
      return z.NEVER;
    }
    return normalized;
  });
const optionalEmailSchema = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? null : value),
  z.string().trim().email("Invalid email").max(255).nullable(),
);
const optionalCommentSchema = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? null : value),
  z.string().trim().max(2000).nullable(),
);
function toMinorUnits(value: string): number {
  const [whole, fraction = ""] = value.replace(",", ".").split(".");
  return Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0") || "0"));
}

const priceTextSchema = z
  .string()
  .trim()
  .refine((value) => {
    if (!/^\d{1,9}(?:[.,]\d{1,2})?$/.test(value)) return false;
    const minor = BigInt(toMinorUnits(value));
    return minor > 0n && minor <= BigInt(MAX_UNIT_PRICE_MINOR);
  }, "Enter a valid UAH amount");

const orderContactFields = {
  buyerName: z.string().trim().min(1, "Name is required").max(120),
  buyerPhone: phoneSchema,
  buyerEmail: optionalEmailSchema,
  operatorComment: optionalCommentSchema,
};
const orderRequestFields = {
  quantity: z.number().int().min(1).max(9999),
  unitPriceUah: priceTextSchema,
  ...orderContactFields,
};

export const CreateOrderRequestSchema = z.object({
  leadId: uuidSchema,
  idempotencyKey: uuidSchema,
  ...orderRequestFields,
});
export const UpdateOrderDraftRequestSchema = z.object(orderRequestFields);
export const CreateOrderSchema = CreateOrderRequestSchema.transform(
  ({ unitPriceUah, ...input }) => ({ ...input, unitPriceMinor: toMinorUnits(unitPriceUah) }),
);
export const UpdateOrderDraftSchema = UpdateOrderDraftRequestSchema.transform(
  ({ unitPriceUah, ...input }) => ({ ...input, unitPriceMinor: toMinorUnits(unitPriceUah) }),
);
export const TransitionOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES),
});

export type CreateOrderInput = z.output<typeof CreateOrderSchema>;
export type UpdateOrderDraftInput = z.output<typeof UpdateOrderDraftSchema>;
export type CreateOrderRequest = z.output<typeof CreateOrderRequestSchema>;
export type UpdateOrderDraftRequest = z.output<typeof UpdateOrderDraftRequestSchema>;
export type TransitionOrderInput = z.output<typeof TransitionOrderSchema>;
