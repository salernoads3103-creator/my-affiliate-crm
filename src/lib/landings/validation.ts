import { z } from "zod";
import type { LandingAdapterReason, LandingAdapterStatus } from "./types";

export const MAX_LANDING_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const MAX_LANDING_MULTIPART_BYTES = MAX_LANDING_ARCHIVE_BYTES + 1024 * 1024;

export const LandingCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    offerId: z.string().uuid(),
  })
  .strict();

export const LandingUpdateSchema = LandingCreateSchema;

export const LandingAdapterStatusSchema = z.enum([
  "not_connected",
  "needs_adaptation",
  "configuration_required",
  "prepared",
  "error",
]) satisfies z.ZodType<LandingAdapterStatus>;

export const LandingAdapterReasonSchema = z.enum([
  "index_missing",
  "root_ambiguous",
  "form_missing",
  "multiple_forms",
  "name_field_missing",
  "name_field_ambiguous",
  "phone_field_missing",
  "phone_field_ambiguous",
  "custom_submit_handler",
  "external_script_unavailable",
  "third_party_form_action",
  "adapter_asset_collision",
  "invalid_html_encoding",
  "invalid_archive",
  "too_many_files",
  "archive_too_large",
  "api_url_not_configured",
  "landing_origin_not_configured",
  "tiktok_pixel_conflict",
  "google_ads_configuration_invalid",
  "google_ads_tag_conflict",
]) satisfies z.ZodType<LandingAdapterReason>;

export const LandingArchiveAnalysisSchema = z
  .object({
    hasIndexHtml: z.boolean(),
    siteRootPath: z.string().max(1024).nullable().optional(),
    fileCount: z.number().int().nonnegative().max(500),
    uncompressedBytes: z
      .number()
      .int()
      .nonnegative()
      .max(100 * 1024 * 1024),
    forms: z
      .array(
        z
          .object({
            index: z.number().int().positive(),
            action: z.string().nullable(),
            method: z.string(),
            fields: z
              .array(
                z
                  .object({
                    name: z.string().nullable(),
                    id: z.string().nullable(),
                    type: z.string().nullable(),
                    placeholder: z.string().nullable(),
                    isNameCandidate: z.boolean(),
                    isPhoneCandidate: z.boolean(),
                  })
                  .strict(),
              )
              .max(40),
            hasNameCandidate: z.boolean(),
            hasPhoneCandidate: z.boolean(),
          })
          .strict(),
      )
      .max(20),
    detectedPixels: z
      .array(
        z.enum([
          "meta",
          "tiktok",
          "google_analytics",
          "google_tag_manager",
          "google_tag",
          "google_ads",
        ]),
      )
      .max(6),
    hasJavaScript: z.boolean(),
    requiresAdaptation: z.boolean(),
    warnings: z
      .array(
        z.enum([
          "index_missing",
          "root_ambiguous",
          "form_missing",
          "name_field_missing",
          "phone_field_missing",
          "javascript_present",
          "scripts_not_scanned",
        ]),
      )
      .max(7),
  })
  .strict()
  .transform((analysis) => ({
    ...analysis,
    // Older saved analyses only recognized an index.html at the ZIP root.
    // Preserve that known meaning while allowing new archives to store a path.
    siteRootPath:
      analysis.siteRootPath === undefined
        ? analysis.hasIndexHtml
          ? ""
          : null
        : analysis.siteRootPath,
  }));

export const LandingPageSchema = z
  .object({
    id: z.string().uuid(),
    workspace_id: z.string().uuid(),
    name: z.string(),
    offer_id: z.string().uuid(),
    offer_name: z.string(),
    status: z.enum(["draft", "ready", "published", "error"]),
    published_url: z.string().nullable(),
    created_at: z.string().datetime({ offset: true }),
    created_by_user_id: z.string().uuid().nullable(),
    source_archive_path: z.string(),
    source_archive_bytes: z.number().int().positive().max(MAX_LANDING_ARCHIVE_BYTES).nullable(),
    deletion_started_at: z.string().datetime({ offset: true }).nullable(),
    adapted_archive_bytes: z.number().int().positive().max(MAX_LANDING_ARCHIVE_BYTES).nullable(),
    has_adapted_archive: z.boolean(),
    adapter_status: LandingAdapterStatusSchema,
    adapter_reason: LandingAdapterReasonSchema.nullable(),
    tiktok_pixel_id: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .nullable(),
    google_ads_conversion_id: z
      .string()
      .regex(/^AW-[0-9]{1,20}$/)
      .nullable(),
    google_ads_conversion_label: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,128}$/)
      .nullable(),
    analysis: LandingArchiveAnalysisSchema,
  })
  .strict();
