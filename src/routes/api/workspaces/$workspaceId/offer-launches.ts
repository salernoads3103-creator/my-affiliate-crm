import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import {
  LandingArchiveError,
  LandingAdapterError,
  analyzeLandingArchive,
  buildAdaptedLandingArchive,
  checkLandingAdapterCompatibility,
} from "@/lib/landings/archive";
import { parseLandingRouteId, readLandingForm } from "@/lib/landings/http.server";
import { LandingService } from "@/lib/landings/service";
import { parseUahToMinorUnits } from "@/lib/products/money";
import {
  OfferLaunchRepository,
  continueSavedOfferLaunch,
} from "@/lib/offer-launches/service.server";
import { launchRequestFingerprint } from "@/lib/offer-launches/workflow";
import { MAX_LANDING_ARCHIVE_BYTES } from "@/lib/landings/validation";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
import type { ResolvedTrackingConfig } from "@/lib/tracking-profiles/logic";

const launchFields = z
  .object({
    launchId: z.string().uuid(),
    productId: z.string().uuid(),
    offerName: z.string().trim().min(1).max(120),
    priceUah: z.string().trim().min(1).max(32),
    hostId: z.string().uuid(),
    tiktokProfileId: z.string().uuid().nullable(),
    googleAdsProfileId: z.string().uuid().nullable(),
  })
  .strict();

function readText(form: FormData, key: string): string {
  const value = form.get(key);
  if (typeof value !== "string") throw new ApiError(400, "Invalid launch form", "VALIDATION_ERROR");
  return value;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/workspaces/$workspaceId/offer-launches")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "offers.manage");
          await requireWorkspacePermission(context, workspaceId, "products.read");
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");

          const form = await readLandingForm(request);
          const expectedKeys = new Set([
            "launchId",
            "productId",
            "offerName",
            "priceUah",
            "hostId",
            "tiktokProfileId",
            "googleAdsProfileId",
            "archive",
          ]);
          const formKeys = Array.from(form.keys());
          if (
            formKeys.length !== expectedKeys.size ||
            formKeys.some((key) => !expectedKeys.has(key))
          ) {
            throw new ApiError(400, "Invalid launch form fields", "VALIDATION_ERROR");
          }
          const archive = form.get("archive");
          if (!(archive instanceof File)) {
            throw new ApiError(400, "Choose a ZIP archive", "VALIDATION_ERROR");
          }
          if (!archive.name.toLowerCase().endsWith(".zip")) {
            throw new ApiError(400, "Choose a ZIP archive", "VALIDATION_ERROR");
          }
          if (archive.size > MAX_LANDING_ARCHIVE_BYTES) {
            throw new ApiError(413, "The ZIP archive exceeds the 25 MB limit", "PAYLOAD_TOO_LARGE");
          }
          const parsed = launchFields.safeParse({
            launchId: readText(form, "launchId"),
            productId: readText(form, "productId"),
            offerName: readText(form, "offerName"),
            priceUah: readText(form, "priceUah"),
            hostId: readText(form, "hostId"),
            tiktokProfileId: readText(form, "tiktokProfileId") || null,
            googleAdsProfileId: readText(form, "googleAdsProfileId") || null,
          });
          if (!parsed.success) {
            throw new ApiError(
              400,
              "Check the offer details and selected options",
              "VALIDATION_ERROR",
            );
          }
          let offerPriceMinor: number;
          try {
            offerPriceMinor = parseUahToMinorUnits(parsed.data.priceUah);
          } catch {
            throw new ApiError(400, "Enter a valid UAH amount", "VALIDATION_ERROR");
          }
          if (archive.size <= 0)
            throw new ApiError(400, "The ZIP archive is empty", "VALIDATION_ERROR");

          const archiveBytes = new Uint8Array(await archive.arrayBuffer());
          const sourceArchiveSha256 = await sha256(archiveBytes);
          try {
            await analyzeLandingArchive(archiveBytes);
          } catch (error) {
            if (error instanceof LandingArchiveError) {
              throw new ApiError(
                400,
                "The ZIP archive is invalid or contains unsupported files",
                "VALIDATION_ERROR",
              );
            }
            throw error;
          }
          const compatibility = await checkLandingAdapterCompatibility(archiveBytes);
          if (compatibility) {
            throw new ApiError(409, "This landing needs adaptation before launch", "CONFLICT");
          }

          const repository = new OfferLaunchRepository();
          const existing = await repository.getRow(workspaceId, parsed.data.launchId);
          let tracking: ResolvedTrackingConfig;
          if (existing) {
            if (
              existing.tiktok_tracking_profile_id !== parsed.data.tiktokProfileId ||
              existing.google_ads_tracking_profile_id !== parsed.data.googleAdsProfileId
            ) {
              throw new ApiError(409, "This launch key belongs to a different request", "CONFLICT");
            }
            tracking = {
              tiktokProfileId: existing.tiktok_tracking_profile_id,
              tiktokPixelId: existing.tiktok_pixel_id,
              googleAdsProfileId: existing.google_ads_tracking_profile_id,
              googleAdsConversionId: existing.google_ads_conversion_id,
              googleAdsConversionLabel: existing.google_ads_conversion_label,
            };
          } else {
            tracking = await new TrackingProfileService().resolveSelection(
              workspaceId,
              {
                tiktokProfileId: parsed.data.tiktokProfileId,
                googleAdsProfileId: parsed.data.googleAdsProfileId,
              },
              {
                tiktokProfileId: null,
                tiktokPixelId: null,
                googleAdsProfileId: null,
                googleAdsConversionId: null,
                googleAdsConversionLabel: null,
              },
            );
            try {
              // Preflight uses the same production adapter on the uploaded source,
              // but with a throwaway form ID and no endpoint; its output is discarded.
              await buildAdaptedLandingArchive(archiveBytes, {
                publicFormId: "00000000-0000-4000-8000-000000000001",
                intakeEndpoint: null,
                tiktokPixelId: tracking.tiktokPixelId,
                googleAdsConversionId: tracking.googleAdsConversionId,
                googleAdsConversionLabel: tracking.googleAdsConversionLabel,
              });
            } catch (error) {
              if (error instanceof LandingAdapterError) {
                throw new ApiError(
                  409,
                  "The ZIP or selected tracking profiles conflict with automatic adaptation",
                  "CONFLICT",
                );
              }
              throw error;
            }
          }
          const requestFingerprint = await launchRequestFingerprint({
            workspaceId,
            productId: parsed.data.productId,
            offerName: parsed.data.offerName,
            offerPriceMinor,
            sourceArchiveSha256,
            tracking,
          });
          if (existing && existing.request_fingerprint !== requestFingerprint) {
            throw new ApiError(409, "This launch key belongs to a different request", "CONFLICT");
          }

          const landingService = new LandingService(context.client);
          const stagedArchivePath =
            existing?.stage === "published"
              ? existing.source_archive_path
              : await landingService.stageLaunchArchive(
                  workspaceId,
                  parsed.data.launchId,
                  sourceArchiveSha256,
                  new Blob([archiveBytes], { type: "application/zip" }),
                );
          if (existing && stagedArchivePath !== existing.source_archive_path) {
            throw new ApiError(
              409,
              "This launch key belongs to a different source archive",
              "CONFLICT",
            );
          }
          const sourceArchivePath = existing?.source_archive_path ?? stagedArchivePath;
          await repository.begin(context.client, {
            workspaceId,
            launchId: parsed.data.launchId,
            requestFingerprint,
            sourceArchivePath,
            sourceArchiveSha256,
            productId: parsed.data.productId,
            offerName: parsed.data.offerName,
            offerPriceMinor,
            hostId: parsed.data.hostId,
            tracking,
          });

          const status = await continueSavedOfferLaunch({
            client: context.client,
            workspaceId,
            launchId: parsed.data.launchId,
            requestHostId: parsed.data.hostId,
            processingToken: crypto.randomUUID(),
          });
          return accessSuccessResponse(status, status.isProcessing ? 202 : 200);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
