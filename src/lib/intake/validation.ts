import { z } from "zod";
import { normalizeUkrainianPhone } from "@/lib/leads/phone";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => value || null);

export const PublicLeadIntakeSchema = z
  .object({
    formId: z.string().uuid(),
    website: z.string().max(200).optional(),
    name: z.string().trim().min(1).max(120),
    phone: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .refine((value) => normalizeUkrainianPhone(value) !== null),
    email: z.preprocess(
      (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
      z.string().trim().email().max(255).optional(),
    ),
    utmSource: optionalText(200),
    utmMedium: optionalText(200),
    utmCampaign: optionalText(200),
    utmContent: optionalText(200),
    utmTerm: optionalText(200),
    ttclid: optionalText(500),
    gclid: optionalText(500),
    gbraid: optionalText(500),
    wbraid: optionalText(500),
    subId: optionalText(200),
    deliveryType: z.enum(["warehouse", "postomat", "address"]).optional(),
    cityRef: optionalText(120),
    cityName: optionalText(200),
    warehouseRef: optionalText(120),
    warehouseName: optionalText(200),
  })
  .strict();

export type PublicLeadIntakeInput = z.infer<typeof PublicLeadIntakeSchema>;

export const LandingOriginSchema = z
  .string()
  .trim()
  .max(255)
  .transform((value, context) => {
    try {
      const url = new URL(value);
      const localHttp =
        url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
      if (
        (url.protocol !== "https:" && !localHttp) ||
        url.origin !== value ||
        url.username ||
        url.password
      ) {
        context.addIssue({ code: "custom", message: "Enter one exact HTTPS origin" });
        return z.NEVER;
      }
      return url.origin;
    } catch {
      context.addIssue({ code: "custom", message: "Enter one exact HTTPS origin" });
      return z.NEVER;
    }
  });

export function normalizeIntakeInput(input: PublicLeadIntakeInput) {
  const phoneNormalized = normalizeUkrainianPhone(input.phone);
  if (!phoneNormalized) throw new Error("Phone validation invariant failed");
  return {
    ...input,
    name: input.name.trim(),
    phone: input.phone.trim(),
    phoneNormalized,
    email: input.email ?? null,
  };
}
