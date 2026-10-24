import type { ResolvedTrackingConfig } from "@/lib/tracking-profiles/logic";

export type LandingBuildFingerprintInput = {
  sourceArchiveSha256: string;
  workspaceId: string;
  offer: {
    id: string;
    name: string;
    priceMinor: number | null;
    productId: string | null;
    isActive: boolean;
    landingUrl: string | null;
  };
  formId: string | null;
  allowedOrigin: string | null;
  formActive: boolean;
  intakeEndpoint: string | null;
  tracking: ResolvedTrackingConfig & {
    tiktokProfileActive: boolean;
    googleAdsProfileActive: boolean;
  };
};

export async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", value.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function landingBuildFingerprint(
  input: LandingBuildFingerprintInput,
): Promise<string> {
  // Bump the version whenever generated ZIP contents or their meaning changes.
  const canonicalInput = JSON.stringify({
    adapterVersion: 1,
    sourceArchiveSha256: input.sourceArchiveSha256,
    workspaceId: input.workspaceId,
    offer: input.offer,
    formId: input.formId,
    allowedOrigin: input.allowedOrigin,
    formActive: input.formActive,
    intakeEndpoint: input.intakeEndpoint,
    tiktokProfileId: input.tracking.tiktokProfileId,
    tiktokPixelId: input.tracking.tiktokPixelId,
    tiktokProfileActive: input.tracking.tiktokProfileActive,
    googleAdsProfileId: input.tracking.googleAdsProfileId,
    googleAdsConversionId: input.tracking.googleAdsConversionId,
    googleAdsConversionLabel: input.tracking.googleAdsConversionLabel,
    googleAdsProfileActive: input.tracking.googleAdsProfileActive,
  });
  return sha256Hex(new TextEncoder().encode(canonicalInput));
}

export function needsLandingReprepare(
  hasPreparedArchive: boolean,
  preparedFingerprint: string | null,
  currentFingerprint: string,
): boolean {
  return Boolean(
    hasPreparedArchive && (!preparedFingerprint || preparedFingerprint !== currentFingerprint),
  );
}
