import type { TrackingProfile, TrackingPlatform } from "./types";

export type ResolvedTrackingConfig = {
  tiktokProfileId: string | null;
  googleAdsProfileId: string | null;
  tiktokPixelId: string | null;
  googleAdsConversionId: string | null;
  googleAdsConversionLabel: string | null;
};

export function resolveProfile(
  profile: TrackingProfile | null,
  expectedWorkspaceId: string,
  expectedPlatform: TrackingPlatform,
): ResolvedTrackingConfig {
  if (!profile) {
    return {
      tiktokProfileId: null,
      googleAdsProfileId: null,
      tiktokPixelId: null,
      googleAdsConversionId: null,
      googleAdsConversionLabel: null,
    };
  }
  if (profile.workspace_id !== expectedWorkspaceId || profile.platform !== expectedPlatform) {
    throw new Error("Tracking profile is outside the requested workspace or platform");
  }
  if (!profile.is_active) throw new Error("Tracking profile is inactive");

  return expectedPlatform === "tiktok"
    ? {
        tiktokProfileId: profile.id,
        googleAdsProfileId: null,
        tiktokPixelId: profile.tiktok_pixel_id,
        googleAdsConversionId: null,
        googleAdsConversionLabel: null,
      }
    : {
        tiktokProfileId: null,
        googleAdsProfileId: profile.id,
        tiktokPixelId: null,
        googleAdsConversionId: profile.google_ads_conversion_id,
        googleAdsConversionLabel: profile.google_ads_conversion_label,
      };
}

export async function trackingFingerprint(config: ResolvedTrackingConfig): Promise<string> {
  const stableValue = JSON.stringify([
    config.tiktokProfileId,
    config.tiktokPixelId,
    config.googleAdsProfileId,
    config.googleAdsConversionId,
    config.googleAdsConversionLabel,
  ]);
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableValue),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function needsTrackingRepublish(
  hasPreparedArchive: boolean,
  preparedFingerprint: string | null,
  currentFingerprint: string,
): boolean {
  return Boolean(
    hasPreparedArchive && preparedFingerprint && preparedFingerprint !== currentFingerprint,
  );
}
