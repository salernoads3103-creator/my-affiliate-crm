export type LandingFieldAnalysis = {
  name: string | null;
  id: string | null;
  type: string | null;
  placeholder: string | null;
  isNameCandidate: boolean;
  isPhoneCandidate: boolean;
};

export type LandingFormAnalysis = {
  index: number;
  action: string | null;
  method: string;
  fields: LandingFieldAnalysis[];
  hasNameCandidate: boolean;
  hasPhoneCandidate: boolean;
};

export type LandingPixel =
  | "meta"
  | "tiktok"
  | "google_analytics"
  | "google_tag_manager"
  | "google_tag"
  | "google_ads";

export type LandingAnalysisWarning =
  | "index_missing"
  | "root_ambiguous"
  | "form_missing"
  | "name_field_missing"
  | "phone_field_missing"
  | "javascript_present"
  | "scripts_not_scanned";

export type LandingAdapterReason =
  | "index_missing"
  | "root_ambiguous"
  | "form_missing"
  | "multiple_forms"
  | "name_field_missing"
  | "name_field_ambiguous"
  | "phone_field_missing"
  | "phone_field_ambiguous"
  | "custom_submit_handler"
  | "external_script_unavailable"
  | "third_party_form_action"
  | "adapter_asset_collision"
  | "invalid_html_encoding"
  | "invalid_archive"
  | "ambiguous_markup"
  | "base_url_present"
  | "too_many_files"
  | "archive_too_large"
  | "api_url_not_configured"
  | "landing_origin_not_configured"
  | "tiktok_pixel_conflict"
  | "google_ads_configuration_invalid"
  | "google_ads_tag_conflict";

export type LandingAdapterStatus =
  | "not_connected"
  | "needs_adaptation"
  | "configuration_required"
  | "prepared"
  | "error";

export type LandingArchiveAnalysis = {
  hasIndexHtml: boolean;
  /** Empty string means archive root; otherwise the prefix to strip when publishing. */
  siteRootPath: string | null;
  fileCount: number;
  uncompressedBytes: number;
  forms: LandingFormAnalysis[];
  detectedPixels: LandingPixel[];
  hasJavaScript: boolean;
  requiresAdaptation: boolean;
  warnings: LandingAnalysisWarning[];
};

export type LandingStatus = "draft" | "ready" | "published" | "error";

export type LandingPage = {
  id: string;
  workspace_id: string;
  name: string;
  offer_id: string;
  offer_name: string;
  status: LandingStatus;
  published_url: string | null;
  created_at: string;
  created_by_user_id: string | null;
  source_archive_path: string;
  source_archive_bytes: number | null;
  deletion_started_at: string | null;
  adapted_archive_bytes: number | null;
  has_adapted_archive: boolean;
  adapter_status: LandingAdapterStatus;
  adapter_reason: LandingAdapterReason | null;
  tiktok_pixel_id: string | null;
  google_ads_conversion_id: string | null;
  google_ads_conversion_label: string | null;
  analysis: LandingArchiveAnalysis;
};

export type LandingListResponse = { landings: LandingPage[] };
export type LandingAdapterResponse = Pick<
  LandingPage,
  | "adapter_status"
  | "adapter_reason"
  | "has_adapted_archive"
  | "adapted_archive_bytes"
  | "tiktok_pixel_id"
  | "google_ads_conversion_id"
  | "google_ads_conversion_label"
>;

export type LandingCreateInput = {
  name: string;
  offerId: string;
};

export type LandingUpdateInput = LandingCreateInput;

export type LandingOfferSnapshot = {
  id: string;
  name: string;
  priceMinor: number | null;
  productId: string | null;
  isActive: boolean;
  landingUrl: string | null;
};

export type LandingDraftRecord = Omit<LandingPage, "offer_name" | "has_adapted_archive"> & {
  adapted_archive_path: string | null;
  adapted_build_fingerprint: string | null;
  adapted_tracking_fingerprint: string | null;
  tiktok_tracking_profile_id: string | null;
  google_ads_tracking_profile_id: string | null;
};

export interface LandingArchiveStorage {
  put(path: string, archive: Blob): Promise<void>;
  remove(path: string): Promise<void>;
  download(path: string): Promise<Blob>;
}

export interface LandingRepository {
  list(workspaceId: string, search: string): Promise<LandingPage[]>;
  ensureOffer(
    workspaceId: string,
    offerId: string,
    activeOnly: boolean,
  ): Promise<LandingOfferSnapshot>;
  getOfferSnapshot(workspaceId: string, offerId: string): Promise<LandingOfferSnapshot | null>;
  getFormIntegration(
    workspaceId: string,
    offerId: string,
  ): Promise<{ publicId: string; allowedOrigin: string; isActive: boolean } | null>;
  insertDraft(input: {
    id: string;
    workspaceId: string;
    name: string;
    offerId: string;
    createdByUserId: string;
    sourceArchivePath: string;
    sourceArchiveBytes: number;
    analysis: LandingArchiveAnalysis;
    adapterStatus?: LandingAdapterStatus;
    adapterReason?: LandingAdapterReason | null;
    adaptedArchivePath?: string | null;
    adaptedArchiveBytes?: number | null;
  }): Promise<{ createdAt: string }>;
  markError(workspaceId: string, landingId: string): Promise<void>;
  getDraft(workspaceId: string, landingId: string): Promise<LandingDraftRecord | null>;
  updateDraft(input: {
    workspaceId: string;
    landingId: string;
    name: string;
    offerId: string;
    sourceArchivePath?: string;
    sourceArchiveBytes?: number;
    analysis?: LandingArchiveAnalysis;
  }): Promise<LandingDraftRecord>;
  updateAdapter(input: {
    workspaceId: string;
    landingId: string;
    status: LandingAdapterStatus;
    reason: LandingAdapterReason | null;
    adaptedArchivePath: string | null;
    adaptedArchiveBytes: number | null;
    publicFormId?: string | null;
    tiktokPixelId?: string | null;
    googleAdsConversionId?: string | null;
    googleAdsConversionLabel?: string | null;
    tiktokTrackingProfileId?: string | null;
    googleAdsTrackingProfileId?: string | null;
    adaptedTrackingFingerprint?: string | null;
    adaptedBuildFingerprint?: string | null;
    expectedSourceArchivePath?: string;
    expectedOfferId?: string;
  }): Promise<LandingDraftRecord>;
  beginDraftDeletion(
    workspaceId: string,
    landingId: string,
  ): Promise<{ sourceArchivePath: string; adaptedArchivePath: string | null } | null>;
  finishDraftDeletion(workspaceId: string, landingId: string): Promise<void>;
}
