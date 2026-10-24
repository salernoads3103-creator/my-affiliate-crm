import { describe, expect, it } from "bun:test";
import {
  needsTrackingRepublish,
  resolveProfile,
  trackingFingerprint,
} from "../src/lib/tracking-profiles/logic";
import { TrackingProfileWriteSchema } from "../src/lib/tracking-profiles/validation";
import type { TrackingProfile } from "../src/lib/tracking-profiles/types";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const tiktokProfileId = "22222222-2222-4222-8222-222222222222";

function profile(overrides: Partial<TrackingProfile> = {}): TrackingProfile {
  return {
    id: tiktokProfileId,
    workspace_id: workspaceId,
    name: "TikTok primary",
    platform: "tiktok",
    tiktok_pixel_id: "TikTokPixel123",
    google_ads_conversion_id: null,
    google_ads_conversion_label: null,
    is_active: true,
    created_at: "2026-10-24T10:00:00.000Z",
    updated_at: "2026-10-24T10:00:00.000Z",
    created_by_user_id: null,
    updated_by_user_id: null,
    ...overrides,
  };
}

describe("workspace tracking profiles", () => {
  it("validates platform-specific public tracking identifiers", () => {
    const initialTikTokProfile = {
      name: "TikTok primary",
      platform: "tiktok" as const,
      tiktokPixelId: "TikTokPixel123",
      isActive: true,
    };
    expect(TrackingProfileWriteSchema.safeParse(initialTikTokProfile).success).toBe(true);
    expect(
      TrackingProfileWriteSchema.safeParse({
        ...initialTikTokProfile,
        name: "TikTok primary updated",
        tiktokPixelId: "TikTokPixel456",
        isActive: false,
      }).success,
    ).toBe(true);
    expect(
      TrackingProfileWriteSchema.safeParse({
        name: "Google purchase",
        platform: "google_ads",
        googleAdsConversionId: "AW-123456789",
        googleAdsConversionLabel: "abc_123",
        isActive: true,
      }).success,
    ).toBe(true);
    expect(
      TrackingProfileWriteSchema.safeParse({
        name: "Invalid",
        platform: "tiktok",
        tiktokPixelId: "javascript:alert(1)",
        isActive: true,
      }).success,
    ).toBe(false);
  });

  it("resolves only an active profile for its own workspace and platform", () => {
    expect(resolveProfile(profile(), workspaceId, "tiktok")).toMatchObject({
      tiktokProfileId,
      tiktokPixelId: "TikTokPixel123",
      googleAdsProfileId: null,
    });
    expect(() =>
      resolveProfile(profile(), "33333333-3333-4333-8333-333333333333", "tiktok"),
    ).toThrow("outside the requested workspace");
    expect(() =>
      resolveProfile(profile({ platform: "google_ads" }), workspaceId, "tiktok"),
    ).toThrow("outside the requested workspace");
    expect(() => resolveProfile(profile({ is_active: false }), workspaceId, "tiktok")).toThrow(
      "inactive",
    );
    expect(
      resolveProfile(
        profile({
          id: "33333333-3333-4333-8333-333333333333",
          name: "Google purchase",
          platform: "google_ads",
          tiktok_pixel_id: null,
          google_ads_conversion_id: "AW-123456789",
          google_ads_conversion_label: "conversion-label",
        }),
        workspaceId,
        "google_ads",
      ),
    ).toMatchObject({
      googleAdsProfileId: "33333333-3333-4333-8333-333333333333",
      googleAdsConversionId: "AW-123456789",
      googleAdsConversionLabel: "conversion-label",
      tiktokPixelId: null,
    });
  });

  it("keeps tracking fingerprints stable but changes them when a selected ID changes", async () => {
    const first = {
      tiktokProfileId,
      tiktokPixelId: "TikTokPixel123",
      googleAdsProfileId: null,
      googleAdsConversionId: null,
      googleAdsConversionLabel: null,
    };
    expect(await trackingFingerprint(first)).toBe(await trackingFingerprint({ ...first }));
    expect(await trackingFingerprint(first)).not.toBe(
      await trackingFingerprint({ ...first, tiktokPixelId: "TikTokPixel456" }),
    );
  });

  it("flags changed tracking only when an adapted ZIP exists", () => {
    expect(needsTrackingRepublish(true, "old-fingerprint", "new-fingerprint")).toBe(true);
    expect(needsTrackingRepublish(true, "same-fingerprint", "same-fingerprint")).toBe(false);
    expect(needsTrackingRepublish(false, "old-fingerprint", "new-fingerprint")).toBe(false);
    expect(needsTrackingRepublish(true, null, "new-fingerprint")).toBe(false);
  });
});
