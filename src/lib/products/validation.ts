import { z } from "zod";
import { parseUahToMinorUnits } from "./money";

const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => value || null)
    .optional()
    .transform((value) => value ?? null);

const price = z
  .string()
  .trim()
  .transform((value, context) => {
    try {
      return parseUahToMinorUnits(value);
    } catch {
      context.addIssue({ code: "custom", message: "Enter a valid UAH amount" });
      return z.NEVER;
    }
  });

const optionalCostPrice = z
  .string()
  .trim()
  .transform((value, context) => {
    if (!value) return null;
    try {
      return parseUahToMinorUnits(value, true);
    } catch {
      context.addIssue({ code: "custom", message: "Enter a valid UAH amount" });
      return z.NEVER;
    }
  })
  .optional();

const photoUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    if (!value) return true;
    try {
      const parsed = new URL(value);
      return parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      return false;
    }
  }, "Enter a valid image URL")
  .transform((value) => value || null)
  .optional()
  .transform((value) => value ?? null);

const ProductFieldsSchema = z.object({
  name: z.string().trim().min(1, "Product name is required").max(200),
  sku: optionalText(100),
  salePrice: price,
  costPrice: optionalCostPrice,
  photoUrl,
  weightGrams: z
    .union([z.number(), z.string()])
    .optional()
    .transform((value, context) => {
      if (value === undefined || value === "") return null;
      const parsed = typeof value === "number" ? value : Number(value);
      if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        context.addIssue({ code: "custom", message: "Enter a weight in whole grams" });
        return z.NEVER;
      }
      return parsed;
    }),
  supplierName: optionalText(200),
  isActive: z.boolean().default(true),
});

export const CreateProductSchema = ProductFieldsSchema;
export const UpdateProductSchema = ProductFieldsSchema;

export type ProductInput = z.infer<typeof ProductFieldsSchema>;
