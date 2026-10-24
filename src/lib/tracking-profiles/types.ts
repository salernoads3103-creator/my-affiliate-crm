export type TrackingPlatform = "tiktok" | "google_ads";

export type TrackingProfile = {
  id: string;
  workspace_id: string;
  name: string;
  platform: TrackingPlatform;
  tiktok_pixel_id: string | null;
  google_ads_conversion_id: string | null;
  google_ads_conversion_label: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
};

export type TrackingProfileWriteInput =
  | {
      name: string;
      platform: "tiktok";
      tiktokPixelId: string;
      isActive: boolean;
    }
  | {
      name: string;
      platform: "google_ads";
      googleAdsConversionId: string;
      googleAdsConversionLabel: string;
      isActive: boolean;
    };

export type LandingTrackingSelection = {
  tiktokProfileId: string | null;
  googleAdsProfileId: string | null;
  tiktokPixelId: string | null;
  googleAdsConversionId: string | null;
  googleAdsConversionLabel: string | null;
  tiktokProfileActive: boolean;
  googleAdsProfileActive: boolean;
  legacyTikTokPixelId: string | null;
  legacyGoogleAdsConversionId: string | null;
  legacyGoogleAdsConversionLabel: string | null;
  legacyTikTokConfigured: boolean;
  legacyGoogleAdsConfigured: boolean;
  needsRepublish: boolean;
};

export type LandingTrackingConfiguration = LandingTrackingSelection & {
  allowedOrigin: string | null;
  formActive: boolean;
  readiness: {
    api: "ready" | "missing" | "invalid";
    originConfigured: boolean;
    offerActive: boolean;
    tiktokProfileActive: boolean;
    googleAdsProfileActive: boolean;
    zipCurrent: boolean;
    zipReady: boolean;
  };
};
