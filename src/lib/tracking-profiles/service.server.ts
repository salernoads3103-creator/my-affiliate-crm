import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import {
  needsTrackingRepublish,
  resolveProfile,
  trackingFingerprint,
  type ResolvedTrackingConfig,
} from "./logic";
import { TrackingProfileListSchema, TrackingProfileSchema } from "./validation";
import type { LandingTrackingSelection, TrackingProfile, TrackingProfileWriteInput } from "./types";

function mapDatabaseError(error: { code?: string }): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "23505") {
    return new ApiError(409, "A tracking profile with this name already exists", "CONFLICT");
  }
  if (["22023", "22P02", "23502", "23503", "23514"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid tracking profile", "VALIDATION_ERROR");
  }
  return new ApiError(500, "The tracking profile request could not be completed", "INTERNAL_ERROR");
}

function profileWriteRow(
  workspaceId: string,
  userId: string,
  input: TrackingProfileWriteInput,
): Database["public"]["Tables"]["workspace_tracking_profiles"]["Insert"] {
  return {
    workspace_id: workspaceId,
    created_by_user_id: userId,
    updated_by_user_id: userId,
    name: input.name,
    platform: input.platform,
    is_active: input.isActive,
    tiktok_pixel_id: input.platform === "tiktok" ? input.tiktokPixelId : null,
    google_ads_conversion_id: input.platform === "google_ads" ? input.googleAdsConversionId : null,
    google_ads_conversion_label:
      input.platform === "google_ads" ? input.googleAdsConversionLabel : null,
  };
}

export type TrackingSelectionInput = {
  tiktokProfileId?: string | null;
  googleAdsProfileId?: string | null;
  tiktokPixelId?: string | null;
  googleAdsConversionId?: string | null;
  googleAdsConversionLabel?: string | null;
};

export class TrackingProfileService {
  async list(workspaceId: string): Promise<TrackingProfile[]> {
    const { data, error } = await supabaseAdmin
      .from("workspace_tracking_profiles")
      .select(
        "id, workspace_id, name, platform, tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, is_active, created_at, updated_at, created_by_user_id, updated_by_user_id",
      )
      .eq("workspace_id", workspaceId)
      .order("platform")
      .order("name");
    if (error) throw mapDatabaseError(error);
    return TrackingProfileListSchema.parse(data);
  }

  async create(
    workspaceId: string,
    userId: string,
    input: TrackingProfileWriteInput,
  ): Promise<TrackingProfile> {
    const { data, error } = await supabaseAdmin
      .from("workspace_tracking_profiles")
      .insert(profileWriteRow(workspaceId, userId, input))
      .select(
        "id, workspace_id, name, platform, tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, is_active, created_at, updated_at, created_by_user_id, updated_by_user_id",
      )
      .single();
    if (error) throw mapDatabaseError(error);
    return TrackingProfileSchema.parse(data);
  }

  async update(
    workspaceId: string,
    profileId: string,
    userId: string,
    input: TrackingProfileWriteInput,
  ): Promise<TrackingProfile> {
    const current = await this.get(workspaceId, profileId);
    if (current.platform !== input.platform) {
      throw new ApiError(400, "A tracking profile platform cannot be changed", "VALIDATION_ERROR");
    }
    const values = profileWriteRow(workspaceId, userId, input);
    const { data, error } = await supabaseAdmin
      .from("workspace_tracking_profiles")
      .update({
        name: values.name,
        is_active: values.is_active,
        tiktok_pixel_id: values.tiktok_pixel_id,
        google_ads_conversion_id: values.google_ads_conversion_id,
        google_ads_conversion_label: values.google_ads_conversion_label,
        updated_by_user_id: userId,
      })
      .eq("workspace_id", workspaceId)
      .eq("id", profileId)
      .select(
        "id, workspace_id, name, platform, tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, is_active, created_at, updated_at, created_by_user_id, updated_by_user_id",
      )
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data) throw new ApiError(404, "Tracking profile not found", "NOT_FOUND");
    return TrackingProfileSchema.parse(data);
  }

  async get(workspaceId: string, profileId: string): Promise<TrackingProfile> {
    const { data, error } = await supabaseAdmin
      .from("workspace_tracking_profiles")
      .select(
        "id, workspace_id, name, platform, tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, is_active, created_at, updated_at, created_by_user_id, updated_by_user_id",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", profileId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data) throw new ApiError(404, "Tracking profile not found", "NOT_FOUND");
    return TrackingProfileSchema.parse(data);
  }

  async resolveSelection(
    workspaceId: string,
    input: TrackingSelectionInput,
    current: ResolvedTrackingConfig,
  ): Promise<ResolvedTrackingConfig> {
    const tiktok = await this.resolveTikTok(
      workspaceId,
      input.tiktokProfileId,
      input.tiktokPixelId,
      current,
    );
    const googleAds = await this.resolveGoogleAds(
      workspaceId,
      input.googleAdsProfileId,
      input.googleAdsConversionId,
      input.googleAdsConversionLabel,
      current,
    );
    return {
      tiktokProfileId: tiktok.profileId,
      tiktokPixelId: tiktok.pixelId,
      googleAdsProfileId: googleAds.profileId,
      googleAdsConversionId: googleAds.conversionId,
      googleAdsConversionLabel: googleAds.conversionLabel,
    };
  }

  async landingConfiguration(
    workspaceId: string,
    landingId: string,
  ): Promise<LandingTrackingSelection> {
    const { data, error } = await supabaseAdmin
      .from("workspace_landings")
      .select(
        "tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, tiktok_tracking_profile_id, google_ads_tracking_profile_id, adapted_archive_path, adapted_tracking_fingerprint",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", landingId)
      .maybeSingle();
    if (error) throw mapDatabaseError(error);
    if (!data) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");

    const [tiktokProfile, googleProfile] = await Promise.all([
      data.tiktok_tracking_profile_id
        ? this.get(workspaceId, data.tiktok_tracking_profile_id)
        : Promise.resolve(null),
      data.google_ads_tracking_profile_id
        ? this.get(workspaceId, data.google_ads_tracking_profile_id)
        : Promise.resolve(null),
    ]);
    const liveConfig: ResolvedTrackingConfig = {
      tiktokProfileId: data.tiktok_tracking_profile_id,
      tiktokPixelId: tiktokProfile?.tiktok_pixel_id ?? data.tiktok_pixel_id,
      googleAdsProfileId: data.google_ads_tracking_profile_id,
      googleAdsConversionId:
        googleProfile?.google_ads_conversion_id ?? data.google_ads_conversion_id,
      googleAdsConversionLabel:
        googleProfile?.google_ads_conversion_label ?? data.google_ads_conversion_label,
    };
    const fingerprint = await trackingFingerprint(liveConfig);
    const needsRepublish = needsTrackingRepublish(
      Boolean(data.adapted_archive_path),
      data.adapted_tracking_fingerprint,
      fingerprint,
    );

    return {
      tiktokProfileId: data.tiktok_tracking_profile_id,
      googleAdsProfileId: data.google_ads_tracking_profile_id,
      tiktokPixelId: liveConfig.tiktokPixelId,
      googleAdsConversionId: liveConfig.googleAdsConversionId,
      googleAdsConversionLabel: liveConfig.googleAdsConversionLabel,
      tiktokProfileActive: !data.tiktok_tracking_profile_id || tiktokProfile?.is_active === true,
      googleAdsProfileActive:
        !data.google_ads_tracking_profile_id || googleProfile?.is_active === true,
      legacyTikTokPixelId: data.tiktok_tracking_profile_id ? null : data.tiktok_pixel_id,
      legacyGoogleAdsConversionId: data.google_ads_tracking_profile_id
        ? null
        : data.google_ads_conversion_id,
      legacyGoogleAdsConversionLabel: data.google_ads_tracking_profile_id
        ? null
        : data.google_ads_conversion_label,
      legacyTikTokConfigured: !data.tiktok_tracking_profile_id && Boolean(data.tiktok_pixel_id),
      legacyGoogleAdsConfigured:
        !data.google_ads_tracking_profile_id && Boolean(data.google_ads_conversion_id),
      needsRepublish,
    };
  }

  private async resolveTikTok(
    workspaceId: string,
    selectedProfileId: string | null | undefined,
    directPixelId: string | null | undefined,
    current: ResolvedTrackingConfig,
  ): Promise<{ profileId: string | null; pixelId: string | null }> {
    if (selectedProfileId === undefined) {
      if (directPixelId === undefined) {
        if (current.tiktokProfileId) {
          const profile = await this.get(workspaceId, current.tiktokProfileId);
          try {
            const resolved = resolveProfile(profile, workspaceId, "tiktok");
            return { profileId: resolved.tiktokProfileId, pixelId: resolved.tiktokPixelId };
          } catch (error) {
            if (error instanceof Error && error.message.includes("inactive")) {
              throw new ApiError(409, "The selected tracking profile is disabled", "CONFLICT");
            }
            throw new ApiError(
              400,
              "The selected tracking profile has the wrong platform",
              "VALIDATION_ERROR",
            );
          }
        }
        return { profileId: current.tiktokProfileId, pixelId: current.tiktokPixelId };
      }
      return {
        profileId:
          current.tiktokProfileId && directPixelId === current.tiktokPixelId
            ? current.tiktokProfileId
            : null,
        pixelId: directPixelId,
      };
    }
    if (selectedProfileId === null) {
      return { profileId: null, pixelId: null };
    }

    const profile = await this.get(workspaceId, selectedProfileId);
    try {
      const resolved = resolveProfile(profile, workspaceId, "tiktok");
      return { profileId: resolved.tiktokProfileId, pixelId: resolved.tiktokPixelId };
    } catch (error) {
      if (error instanceof Error && error.message.includes("inactive")) {
        throw new ApiError(409, "The selected tracking profile is disabled", "CONFLICT");
      }
      throw new ApiError(
        400,
        "The selected tracking profile has the wrong platform",
        "VALIDATION_ERROR",
      );
    }
  }

  private async resolveGoogleAds(
    workspaceId: string,
    selectedProfileId: string | null | undefined,
    directConversionId: string | null | undefined,
    directConversionLabel: string | null | undefined,
    current: ResolvedTrackingConfig,
  ): Promise<{
    profileId: string | null;
    conversionId: string | null;
    conversionLabel: string | null;
  }> {
    if (selectedProfileId === undefined) {
      if (directConversionId === undefined && directConversionLabel === undefined) {
        if (current.googleAdsProfileId) {
          const profile = await this.get(workspaceId, current.googleAdsProfileId);
          try {
            const resolved = resolveProfile(profile, workspaceId, "google_ads");
            return {
              profileId: resolved.googleAdsProfileId,
              conversionId: resolved.googleAdsConversionId,
              conversionLabel: resolved.googleAdsConversionLabel,
            };
          } catch (error) {
            if (error instanceof Error && error.message.includes("inactive")) {
              throw new ApiError(409, "The selected tracking profile is disabled", "CONFLICT");
            }
            throw new ApiError(
              400,
              "The selected tracking profile has the wrong platform",
              "VALIDATION_ERROR",
            );
          }
        }
        return {
          profileId: current.googleAdsProfileId,
          conversionId: current.googleAdsConversionId,
          conversionLabel: current.googleAdsConversionLabel,
        };
      }
      const conversionId = directConversionId ?? null;
      const conversionLabel = directConversionLabel ?? null;
      return {
        profileId:
          current.googleAdsProfileId &&
          conversionId === current.googleAdsConversionId &&
          conversionLabel === current.googleAdsConversionLabel
            ? current.googleAdsProfileId
            : null,
        conversionId,
        conversionLabel,
      };
    }
    if (selectedProfileId === null) {
      return { profileId: null, conversionId: null, conversionLabel: null };
    }

    const profile = await this.get(workspaceId, selectedProfileId);
    try {
      const resolved = resolveProfile(profile, workspaceId, "google_ads");
      return {
        profileId: resolved.googleAdsProfileId,
        conversionId: resolved.googleAdsConversionId,
        conversionLabel: resolved.googleAdsConversionLabel,
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes("inactive")) {
        throw new ApiError(409, "The selected tracking profile is disabled", "CONFLICT");
      }
      throw new ApiError(
        400,
        "The selected tracking profile has the wrong platform",
        "VALIDATION_ERROR",
      );
    }
  }
}
