import { z } from "zod";

const ProfileNameSchema = z.string().trim().min(1).max(120);
const TikTokPixelIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,64}$/);
const GoogleAdsIdSchema = z
  .string()
  .trim()
  .regex(/^AW-[0-9]{1,20}$/);
const GoogleAdsLabelSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,128}$/);

export const TrackingProfileWriteSchema = z.discriminatedUnion("platform", [
  z
    .object({
      name: ProfileNameSchema,
      platform: z.literal("tiktok"),
      tiktokPixelId: TikTokPixelIdSchema,
      isActive: z.boolean(),
    })
    .strict(),
  z
    .object({
      name: ProfileNameSchema,
      platform: z.literal("google_ads"),
      googleAdsConversionId: GoogleAdsIdSchema,
      googleAdsConversionLabel: GoogleAdsLabelSchema,
      isActive: z.boolean(),
    })
    .strict(),
]);

export const TrackingProfileSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    name: ProfileNameSchema,
    platform: z.enum(["tiktok", "google_ads"]),
    tiktok_pixel_id: TikTokPixelIdSchema.nullable(),
    google_ads_conversion_id: GoogleAdsIdSchema.nullable(),
    google_ads_conversion_label: GoogleAdsLabelSchema.nullable(),
    is_active: z.boolean(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    created_by_user_id: z.string().uuid().nullable(),
    updated_by_user_id: z.string().uuid().nullable(),
  })
  .strict();

export const TrackingProfileListSchema = z.array(TrackingProfileSchema);

export const TrackingProfileIdSchema = z.string().uuid();
