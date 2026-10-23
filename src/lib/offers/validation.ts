import { z } from "zod";
import { parseUahToMinorUnits } from "@/lib/products/money";

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

const landingUrl = z
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
  }, "Enter a valid landing page URL")
  .transform((value) => value || null);

export const OfferWriteSchema = z.object({
  productId: z.string().uuid("Choose a product"),
  name: z.string().trim().min(1, "Offer name is required").max(120),
  priceUah: price,
  landingUrl,
  isActive: z.boolean(),
});

export type OfferInput = z.infer<typeof OfferWriteSchema>;
