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

export type LandingPixel = "meta" | "tiktok" | "google_analytics" | "google_tag_manager";

export type LandingAnalysisWarning =
  | "index_missing"
  | "root_ambiguous"
  | "form_missing"
  | "name_field_missing"
  | "phone_field_missing"
  | "javascript_present"
  | "scripts_not_scanned";

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
  analysis: LandingArchiveAnalysis;
};

export type LandingListResponse = { landings: LandingPage[] };

export type LandingCreateInput = {
  name: string;
  offerId: string;
};

export interface LandingArchiveStorage {
  put(path: string, archive: Blob): Promise<void>;
}

export interface LandingRepository {
  list(workspaceId: string, search: string): Promise<LandingPage[]>;
  ensureActiveOffer(workspaceId: string, offerId: string): Promise<{ name: string }>;
  insertDraft(input: {
    id: string;
    workspaceId: string;
    name: string;
    offerId: string;
    createdByUserId: string;
    sourceArchivePath: string;
    analysis: LandingArchiveAnalysis;
  }): Promise<{ createdAt: string }>;
  markError(workspaceId: string, landingId: string): Promise<void>;
}
