import { z } from "zod";

export const MAX_LANDING_ARCHIVE_BYTES = 25 * 1024 * 1024;
export const MAX_LANDING_MULTIPART_BYTES = MAX_LANDING_ARCHIVE_BYTES + 1024 * 1024;

export const LandingCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    offerId: z.string().uuid(),
  })
  .strict();

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
      .array(z.enum(["meta", "tiktok", "google_analytics", "google_tag_manager"]))
      .max(4),
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
    analysis: LandingArchiveAnalysisSchema,
  })
  .strict();
