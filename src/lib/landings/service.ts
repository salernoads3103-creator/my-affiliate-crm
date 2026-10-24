import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import { getPublicLandingIntakeEndpoint } from "@/lib/landings/config.server";
import {
  landingBuildFingerprint,
  needsLandingReprepare,
  sha256Hex,
} from "@/lib/landings/fingerprint";
import { trackingFingerprint } from "@/lib/tracking-profiles/logic";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
import {
  buildAdaptedLandingArchive,
  checkLandingAdapterCompatibility,
  LandingAdapterError,
} from "./archive";
import {
  LandingAdapterReasonSchema,
  LandingAdapterStatusSchema,
  LandingArchiveAnalysisSchema,
  LandingPageSchema,
} from "./validation";
import type {
  LandingArchiveAnalysis,
  LandingArchiveStorage,
  LandingAdapterReason,
  LandingAdapterStatus,
  LandingCreateInput,
  LandingDraftRecord,
  LandingListResponse,
  LandingOfferSnapshot,
  LandingPage,
  LandingRepository,
  LandingUpdateInput,
} from "./types";
import type {
  LandingTrackingConfiguration,
  LandingTrackingSelection,
} from "@/lib/tracking-profiles/types";

const LANDING_ARCHIVE_BUCKET = "crmonia-landing-archives";
const PENDING_LANDING_ORIGIN = "https://pending.crmonia.invalid";
type LandingClient = SupabaseClient<Database>;

function toLandingPage(record: LandingDraftRecord, offerName: string): LandingPage {
  return {
    id: record.id,
    workspace_id: record.workspace_id,
    name: record.name,
    offer_id: record.offer_id,
    offer_name: offerName,
    status: record.status,
    published_url: record.published_url,
    created_at: record.created_at,
    created_by_user_id: record.created_by_user_id,
    source_archive_path: record.source_archive_path,
    source_archive_bytes: record.source_archive_bytes,
    deletion_started_at: record.deletion_started_at,
    adapted_archive_bytes: record.adapted_archive_bytes,
    has_adapted_archive: Boolean(record.adapted_archive_path),
    adapter_status: record.adapter_status,
    adapter_reason: record.adapter_reason,
    tiktok_pixel_id: record.tiktok_pixel_id,
    google_ads_conversion_id: record.google_ads_conversion_id,
    google_ads_conversion_label: record.google_ads_conversion_label,
    analysis: record.analysis,
  };
}

type LandingDraftDbRow = Pick<
  Database["public"]["Tables"]["workspace_landings"]["Row"],
  | "id"
  | "workspace_id"
  | "name"
  | "offer_id"
  | "status"
  | "published_url"
  | "created_at"
  | "created_by_user_id"
  | "source_archive_path"
  | "source_archive_bytes"
  | "deletion_started_at"
  | "adapted_archive_path"
  | "adapted_archive_bytes"
  | "adapted_build_fingerprint"
  | "adapted_tracking_fingerprint"
  | "adapter_status"
  | "adapter_reason"
  | "tiktok_pixel_id"
  | "google_ads_conversion_id"
  | "google_ads_conversion_label"
  | "google_ads_tracking_profile_id"
  | "tiktok_tracking_profile_id"
  | "analysis"
>;

function toLandingDraftRecord(data: LandingDraftDbRow): LandingDraftRecord {
  return {
    id: data.id,
    workspace_id: data.workspace_id,
    name: data.name,
    offer_id: data.offer_id,
    status: data.status,
    published_url: data.published_url,
    created_at: data.created_at,
    created_by_user_id: data.created_by_user_id,
    source_archive_path: data.source_archive_path,
    source_archive_bytes: data.source_archive_bytes,
    deletion_started_at: data.deletion_started_at,
    adapted_archive_path: data.adapted_archive_path,
    adapted_archive_bytes: data.adapted_archive_bytes,
    adapted_build_fingerprint: data.adapted_build_fingerprint,
    adapted_tracking_fingerprint: data.adapted_tracking_fingerprint,
    adapter_status: LandingAdapterStatusSchema.parse(data.adapter_status),
    adapter_reason:
      data.adapter_reason === null ? null : LandingAdapterReasonSchema.parse(data.adapter_reason),
    tiktok_pixel_id: data.tiktok_pixel_id,
    google_ads_conversion_id: data.google_ads_conversion_id,
    google_ads_conversion_label: data.google_ads_conversion_label,
    google_ads_tracking_profile_id: data.google_ads_tracking_profile_id,
    tiktok_tracking_profile_id: data.tiktok_tracking_profile_id,
    analysis: LandingArchiveAnalysisSchema.parse(data.analysis),
  };
}

function databaseError(error: { code?: string; message?: string }): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "P0002" || error.code === "PGRST116") {
    return new ApiError(404, "Landing page or active offer not found");
  }
  if (error.code === "23505") return new ApiError(409, "A landing with this ID already exists");
  if (["22023", "22P02", "23502", "23503", "23514"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid landing data", "VALIDATION_ERROR");
  }
  return new ApiError(500, "The landing request could not be completed", "INTERNAL_ERROR", error);
}

export class SupabaseLandingRepository implements LandingRepository {
  constructor(
    private readonly client: LandingClient,
    private readonly privilegedClient: LandingClient,
  ) {}

  async list(workspaceId: string, search: string): Promise<LandingPage[]> {
    const { data, error } = await this.client.rpc("get_workspace_landings", {
      p_workspace_id: workspaceId,
      p_search: search.trim().slice(0, 120) || null,
    });
    if (error) throw databaseError(error);

    return data.map((row) => LandingPageSchema.parse(row));
  }

  async ensureOffer(
    workspaceId: string,
    offerId: string,
    activeOnly: boolean,
  ): Promise<LandingOfferSnapshot> {
    let query = this.client
      .from("workspace_offers")
      .select("id, name, offer_price_minor, product_id, is_active, landing_url")
      .eq("workspace_id", workspaceId)
      .eq("id", offerId);
    if (activeOnly) query = query.eq("is_active", true);
    const { data, error } = await query.maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new ApiError(404, "The selected offer is not available");
    return {
      id: data.id,
      name: data.name,
      priceMinor: data.offer_price_minor,
      productId: data.product_id,
      isActive: data.is_active,
      landingUrl: data.landing_url,
    };
  }

  async getOfferSnapshot(
    workspaceId: string,
    offerId: string,
  ): Promise<LandingOfferSnapshot | null> {
    const { data, error } = await this.privilegedClient
      .from("workspace_offers")
      .select("id, name, offer_price_minor, product_id, is_active, landing_url")
      .eq("workspace_id", workspaceId)
      .eq("id", offerId)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) return null;
    return {
      id: data.id,
      name: data.name,
      priceMinor: data.offer_price_minor,
      productId: data.product_id,
      isActive: data.is_active,
      landingUrl: data.landing_url,
    };
  }

  async getFormIntegration(
    workspaceId: string,
    offerId: string,
  ): Promise<{ publicId: string; allowedOrigin: string; isActive: boolean } | null> {
    const { data, error } = await this.privilegedClient
      .from("landing_form_integrations")
      .select("public_id, allowed_origin, is_active")
      .eq("workspace_id", workspaceId)
      .eq("offer_id", offerId)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) return null;
    return {
      publicId: data.public_id,
      allowedOrigin: data.allowed_origin,
      isActive: data.is_active,
    };
  }

  async insertDraft(input: {
    id: string;
    workspaceId: string;
    name: string;
    offerId: string;
    createdByUserId: string;
    sourceArchivePath: string;
    sourceArchiveBytes: number;
    analysis: LandingArchiveAnalysis;
  }): Promise<{ createdAt: string }> {
    const { data, error } = await this.privilegedClient
      .from("workspace_landings")
      .insert({
        id: input.id,
        workspace_id: input.workspaceId,
        name: input.name,
        offer_id: input.offerId,
        status: "draft",
        published_url: null,
        created_by_user_id: input.createdByUserId,
        source_archive_path: input.sourceArchivePath,
        source_archive_bytes: input.sourceArchiveBytes,
        adapted_archive_path: null,
        adapted_archive_bytes: null,
        adapted_build_fingerprint: null,
        adapter_status: "not_connected",
        adapter_reason: null,
        tiktok_pixel_id: null,
        google_ads_conversion_id: null,
        google_ads_conversion_label: null,
        google_ads_tracking_profile_id: null,
        tiktok_tracking_profile_id: null,
        adapted_tracking_fingerprint: null,
        intake_public_id: null,
        analysis: input.analysis,
      })
      .select("created_at")
      .single();
    if (error) throw databaseError(error);
    return { createdAt: data.created_at };
  }

  async markError(workspaceId: string, landingId: string): Promise<void> {
    const { error } = await this.privilegedClient
      .from("workspace_landings")
      .update({ status: "error" })
      .eq("workspace_id", workspaceId)
      .eq("id", landingId);
    if (error) throw databaseError(error);
  }

  async getDraft(workspaceId: string, landingId: string): Promise<LandingDraftRecord | null> {
    const { data, error } = await this.privilegedClient
      .from("workspace_landings")
      .select(
        "id, workspace_id, name, offer_id, status, published_url, created_at, created_by_user_id, source_archive_path, source_archive_bytes, deletion_started_at, adapted_archive_path, adapted_archive_bytes, adapted_build_fingerprint, adapted_tracking_fingerprint, adapter_status, adapter_reason, tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, tiktok_tracking_profile_id, google_ads_tracking_profile_id, intake_public_id, analysis",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", landingId)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) return null;
    return toLandingDraftRecord(data);
  }

  async updateDraft(input: {
    workspaceId: string;
    landingId: string;
    name: string;
    offerId: string;
    sourceArchivePath?: string;
    sourceArchiveBytes?: number;
    analysis?: LandingArchiveAnalysis;
  }): Promise<LandingDraftRecord> {
    const update: Database["public"]["Tables"]["workspace_landings"]["Update"] = {
      name: input.name,
      offer_id: input.offerId,
      ...(input.sourceArchivePath === undefined
        ? {}
        : { source_archive_path: input.sourceArchivePath }),
      ...(input.sourceArchiveBytes === undefined
        ? {}
        : { source_archive_bytes: input.sourceArchiveBytes }),
      ...(input.analysis === undefined ? {} : { analysis: input.analysis }),
      ...(input.sourceArchivePath === undefined
        ? {}
        : {
            adapted_archive_path: null,
            adapted_archive_bytes: null,
            adapted_build_fingerprint: null,
            adapted_tracking_fingerprint: null,
            adapter_status: "not_connected",
            adapter_reason: null,
            intake_public_id: null,
          }),
    };
    const { data, error } = await this.privilegedClient
      .from("workspace_landings")
      .update(update)
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.landingId)
      .eq("status", "draft")
      .is("deletion_started_at", null)
      .select(
        "id, workspace_id, name, offer_id, status, published_url, created_at, created_by_user_id, source_archive_path, source_archive_bytes, deletion_started_at, adapted_archive_path, adapted_archive_bytes, adapted_build_fingerprint, adapted_tracking_fingerprint, adapter_status, adapter_reason, tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, tiktok_tracking_profile_id, google_ads_tracking_profile_id, intake_public_id, analysis",
      )
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new ApiError(409, "This landing draft is no longer editable");
    return toLandingDraftRecord(data);
  }

  async updateAdapter(input: {
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
  }): Promise<LandingDraftRecord> {
    let query = this.privilegedClient
      .from("workspace_landings")
      .update({
        adapter_status: input.status,
        adapter_reason: input.reason,
        adapted_archive_path: input.adaptedArchivePath,
        adapted_archive_bytes: input.adaptedArchiveBytes,
        ...(input.tiktokPixelId === undefined ? {} : { tiktok_pixel_id: input.tiktokPixelId }),
        ...(input.googleAdsConversionId === undefined
          ? {}
          : { google_ads_conversion_id: input.googleAdsConversionId }),
        ...(input.googleAdsConversionLabel === undefined
          ? {}
          : { google_ads_conversion_label: input.googleAdsConversionLabel }),
        ...(input.tiktokTrackingProfileId === undefined
          ? {}
          : { tiktok_tracking_profile_id: input.tiktokTrackingProfileId }),
        ...(input.googleAdsTrackingProfileId === undefined
          ? {}
          : { google_ads_tracking_profile_id: input.googleAdsTrackingProfileId }),
        ...(input.adaptedTrackingFingerprint === undefined
          ? {}
          : { adapted_tracking_fingerprint: input.adaptedTrackingFingerprint }),
        ...(input.adaptedBuildFingerprint === undefined
          ? {}
          : { adapted_build_fingerprint: input.adaptedBuildFingerprint }),
        ...(input.publicFormId === undefined ? {} : { intake_public_id: input.publicFormId }),
      })
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.landingId)
      .eq("status", "draft");
    if (input.expectedSourceArchivePath) {
      query = query.eq("source_archive_path", input.expectedSourceArchivePath);
    }
    if (input.expectedOfferId) query = query.eq("offer_id", input.expectedOfferId);
    const { data, error } = await query
      .is("deletion_started_at", null)
      .select(
        "id, workspace_id, name, offer_id, status, published_url, created_at, created_by_user_id, source_archive_path, source_archive_bytes, deletion_started_at, adapted_archive_path, adapted_archive_bytes, adapted_build_fingerprint, adapted_tracking_fingerprint, adapter_status, adapter_reason, tiktok_pixel_id, google_ads_conversion_id, google_ads_conversion_label, tiktok_tracking_profile_id, google_ads_tracking_profile_id, intake_public_id, analysis",
      )
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new ApiError(409, "This landing draft is no longer editable");
    return toLandingDraftRecord(data);
  }

  async beginDraftDeletion(
    workspaceId: string,
    landingId: string,
  ): Promise<{ sourceArchivePath: string; adaptedArchivePath: string | null } | null> {
    const current = await this.getDraft(workspaceId, landingId);
    if (!current) return null;
    if (current.status !== "draft") {
      throw new ApiError(409, "Only landing drafts can be deleted", "CONFLICT");
    }
    if (current.deletion_started_at) {
      return {
        sourceArchivePath: current.source_archive_path,
        adaptedArchivePath: current.adapted_archive_path,
      };
    }

    const { data, error } = await this.privilegedClient
      .from("workspace_landings")
      .update({ deletion_started_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("id", landingId)
      .eq("status", "draft")
      .is("deletion_started_at", null)
      .select("source_archive_path, adapted_archive_path")
      .maybeSingle();
    if (error) throw databaseError(error);
    if (data) {
      return {
        sourceArchivePath: data.source_archive_path,
        adaptedArchivePath: data.adapted_archive_path,
      };
    }

    const latest = await this.getDraft(workspaceId, landingId);
    if (!latest) return null;
    if (latest.status === "draft" && latest.deletion_started_at) {
      return {
        sourceArchivePath: latest.source_archive_path,
        adaptedArchivePath: latest.adapted_archive_path,
      };
    }
    throw new ApiError(409, "This landing draft is no longer available for deletion", "CONFLICT");
  }

  async finishDraftDeletion(workspaceId: string, landingId: string): Promise<void> {
    const { error } = await this.privilegedClient
      .from("workspace_landings")
      .delete()
      .eq("workspace_id", workspaceId)
      .eq("id", landingId)
      .eq("status", "draft")
      .not("deletion_started_at", "is", null);
    if (error) throw databaseError(error);
    // Another authorized delete request may have completed while this request
    // was removing the same private object. Treat that outcome as success.
  }
}

export class SupabaseLandingArchiveStorage implements LandingArchiveStorage {
  constructor(private readonly client: LandingClient) {}

  async put(path: string, archive: Blob): Promise<void> {
    const { error } = await this.client.storage.from(LANDING_ARCHIVE_BUCKET).upload(path, archive, {
      contentType: "application/zip",
      cacheControl: "3600",
      upsert: false,
    });
    if (error)
      throw new ApiError(
        500,
        "Could not store the private landing archive",
        "INTERNAL_ERROR",
        error,
      );
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(LANDING_ARCHIVE_BUCKET).remove([path]);
    if (error) {
      throw new ApiError(
        500,
        "Could not remove the private landing archive",
        "INTERNAL_ERROR",
        error,
      );
    }
  }

  async download(path: string): Promise<Blob> {
    const { data, error } = await this.client.storage.from(LANDING_ARCHIVE_BUCKET).download(path);
    if (error) {
      throw new ApiError(
        500,
        "Could not read the private landing archive",
        "INTERNAL_ERROR",
        error,
      );
    }
    return data;
  }
}

export async function createLandingDraft(
  dependencies: { repository: LandingRepository; storage: LandingArchiveStorage },
  input: LandingCreateInput & {
    workspaceId: string;
    createdByUserId: string;
    archive: Blob;
    analysis: LandingArchiveAnalysis;
    createId?: () => string;
  },
): Promise<LandingPage> {
  const offer = await dependencies.repository.ensureOffer(input.workspaceId, input.offerId, true);
  const id = input.createId?.() ?? crypto.randomUUID();
  const sourceArchivePath = `${input.workspaceId}/${id}/source.zip`;
  const { createdAt } = await dependencies.repository.insertDraft({
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    offerId: input.offerId,
    createdByUserId: input.createdByUserId,
    sourceArchivePath,
    sourceArchiveBytes: input.archive.size,
    analysis: input.analysis,
  });

  try {
    await dependencies.storage.put(sourceArchivePath, input.archive);
  } catch (error) {
    try {
      await dependencies.repository.markError(input.workspaceId, id);
    } catch (markError) {
      console.error("[landings] Could not mark failed archive upload", markError);
    }
    throw error instanceof ApiError
      ? error
      : new ApiError(500, "Could not store the landing archive", "INTERNAL_ERROR", error);
  }

  return {
    id,
    workspace_id: input.workspaceId,
    name: input.name,
    offer_id: input.offerId,
    offer_name: offer.name,
    status: "draft",
    published_url: null,
    created_at: createdAt,
    created_by_user_id: input.createdByUserId,
    source_archive_path: sourceArchivePath,
    source_archive_bytes: input.archive.size,
    deletion_started_at: null,
    adapted_archive_bytes: null,
    has_adapted_archive: false,
    adapter_status: "not_connected",
    adapter_reason: null,
    tiktok_pixel_id: null,
    google_ads_conversion_id: null,
    google_ads_conversion_label: null,
    analysis: input.analysis,
  };
}

export async function updateLandingDraft(
  dependencies: { repository: LandingRepository; storage: LandingArchiveStorage },
  input: LandingUpdateInput & {
    workspaceId: string;
    landingId: string;
    archive?: Blob;
    analysis?: LandingArchiveAnalysis;
    createArchiveVersion?: () => string;
  },
): Promise<LandingPage> {
  const current = await dependencies.repository.getDraft(input.workspaceId, input.landingId);
  if (!current) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
  if (current.status !== "draft" || current.deletion_started_at) {
    throw new ApiError(409, "This landing draft is no longer editable", "CONFLICT");
  }

  const offer = await dependencies.repository.ensureOffer(
    input.workspaceId,
    input.offerId,
    input.offerId !== current.offer_id,
  );

  let sourceArchivePath: string | undefined;
  if (input.archive) {
    const version = input.createArchiveVersion?.() ?? crypto.randomUUID();
    sourceArchivePath = `${input.workspaceId}/${input.landingId}/source-${version}.zip`;
    await dependencies.storage.put(sourceArchivePath, input.archive);
  }

  let updated: LandingDraftRecord;
  try {
    updated = await dependencies.repository.updateDraft({
      workspaceId: input.workspaceId,
      landingId: input.landingId,
      name: input.name,
      offerId: input.offerId,
      ...(sourceArchivePath === undefined
        ? {}
        : {
            sourceArchivePath,
            sourceArchiveBytes: input.archive?.size,
            analysis: input.analysis,
          }),
    });
  } catch (error) {
    if (sourceArchivePath) {
      try {
        await dependencies.storage.remove(sourceArchivePath);
      } catch (cleanupError) {
        console.error("[landings] Could not remove an unused replacement archive", cleanupError);
      }
    }
    throw error;
  }

  if (sourceArchivePath && sourceArchivePath !== current.source_archive_path) {
    try {
      await dependencies.storage.remove(current.source_archive_path);
    } catch (cleanupError) {
      // The database now points at the successfully uploaded replacement. A
      // failed cleanup leaves only an unreferenced private object.
      console.error("[landings] Could not remove the replaced landing archive", cleanupError);
    }
    if (current.adapted_archive_path) {
      try {
        await dependencies.storage.remove(current.adapted_archive_path);
      } catch (cleanupError) {
        console.error(
          "[landings] Could not remove the previous adapted landing archive",
          cleanupError,
        );
      }
    }
  }

  return toLandingPage(updated, offer.name);
}

export async function connectLandingDraft(
  dependencies: { repository: LandingRepository; storage: LandingArchiveStorage },
  input: {
    workspaceId: string;
    landingId: string;
    publicFormId: string;
    allowedOriginConfigured: boolean;
    allowedOrigin?: string | null;
    formActive?: boolean;
    intakeEndpoint: string | null;
    tiktokPixelId?: string | null;
    googleAdsConversionId?: string | null;
    googleAdsConversionLabel?: string | null;
    tiktokTrackingProfileId?: string | null;
    googleAdsTrackingProfileId?: string | null;
    tiktokProfileActive?: boolean;
    googleAdsProfileActive?: boolean;
    createArchiveVersion?: () => string;
  },
): Promise<LandingPage> {
  const current = await dependencies.repository.getDraft(input.workspaceId, input.landingId);
  if (!current) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
  if (current.status !== "draft" || current.deletion_started_at) {
    throw new ApiError(409, "This landing draft is no longer editable", "CONFLICT");
  }
  const offer = await dependencies.repository.ensureOffer(
    input.workspaceId,
    current.offer_id,
    true,
  );
  const formConfig = await dependencies.repository.getFormIntegration(
    input.workspaceId,
    current.offer_id,
  );
  const tiktokPixelId =
    input.tiktokPixelId === undefined ? current.tiktok_pixel_id : input.tiktokPixelId;
  const googleAdsConversionId =
    input.googleAdsConversionId === undefined
      ? current.google_ads_conversion_id
      : input.googleAdsConversionId;
  const googleAdsConversionLabel =
    input.googleAdsConversionLabel === undefined
      ? current.google_ads_conversion_label
      : input.googleAdsConversionLabel;
  const tiktokTrackingProfileId =
    input.tiktokTrackingProfileId === undefined
      ? current.tiktok_tracking_profile_id
      : input.tiktokTrackingProfileId;
  const googleAdsTrackingProfileId =
    input.googleAdsTrackingProfileId === undefined
      ? current.google_ads_tracking_profile_id
      : input.googleAdsTrackingProfileId;
  if (Boolean(googleAdsConversionId) !== Boolean(googleAdsConversionLabel)) {
    throw new ApiError(
      400,
      "Both Google Ads conversion ID and label are required",
      "VALIDATION_ERROR",
    );
  }
  let archivePath: string | null = null;
  try {
    const source = await dependencies.storage.download(current.source_archive_path);
    const sourceBytes = new Uint8Array(await source.arrayBuffer());
    const adaptedArchive = await buildAdaptedLandingArchive(sourceBytes, {
      publicFormId: input.publicFormId,
      intakeEndpoint: input.intakeEndpoint,
      tiktokPixelId,
      googleAdsConversionId,
      googleAdsConversionLabel,
    });

    const reason = !input.intakeEndpoint
      ? "api_url_not_configured"
      : !input.allowedOriginConfigured
        ? "landing_origin_not_configured"
        : null;
    const status = reason ? "configuration_required" : "prepared";
    const buildFingerprint = await landingBuildFingerprint({
      sourceArchiveSha256: await sha256Hex(sourceBytes),
      workspaceId: input.workspaceId,
      offer: {
        id: offer.id,
        name: offer.name,
        priceMinor: offer.priceMinor,
        productId: offer.productId,
        isActive: offer.isActive,
        landingUrl: offer.landingUrl,
      },
      formId: input.publicFormId,
      allowedOrigin: input.allowedOrigin ?? formConfig?.allowedOrigin ?? null,
      formActive: input.formActive ?? formConfig?.isActive ?? input.allowedOriginConfigured,
      intakeEndpoint: input.intakeEndpoint,
      tracking: {
        tiktokProfileId: tiktokTrackingProfileId,
        tiktokPixelId,
        googleAdsProfileId: googleAdsTrackingProfileId,
        googleAdsConversionId,
        googleAdsConversionLabel,
        tiktokProfileActive: input.tiktokProfileActive ?? true,
        googleAdsProfileActive: input.googleAdsProfileActive ?? true,
      },
    });
    const version = input.createArchiveVersion?.() ?? crypto.randomUUID();
    archivePath = `${input.workspaceId}/${input.landingId}/adapted-${version}.zip`;
    const adaptedBuffer = new ArrayBuffer(adaptedArchive.byteLength);
    new Uint8Array(adaptedBuffer).set(adaptedArchive);
    await dependencies.storage.put(
      archivePath,
      new Blob([adaptedBuffer], { type: "application/zip" }),
    );

    const updated = await dependencies.repository.updateAdapter({
      workspaceId: input.workspaceId,
      landingId: input.landingId,
      status,
      reason,
      adaptedArchivePath: archivePath,
      adaptedArchiveBytes: adaptedArchive.byteLength,
      publicFormId: input.publicFormId,
      tiktokPixelId,
      googleAdsConversionId,
      googleAdsConversionLabel,
      tiktokTrackingProfileId,
      googleAdsTrackingProfileId,
      adaptedTrackingFingerprint: await trackingFingerprint({
        tiktokProfileId: tiktokTrackingProfileId,
        tiktokPixelId,
        googleAdsProfileId: googleAdsTrackingProfileId,
        googleAdsConversionId,
        googleAdsConversionLabel,
      }),
      adaptedBuildFingerprint: buildFingerprint,
      expectedSourceArchivePath: current.source_archive_path,
      expectedOfferId: current.offer_id,
    });
    archivePath = null;

    if (current.adapted_archive_path) {
      try {
        await dependencies.storage.remove(current.adapted_archive_path);
      } catch (cleanupError) {
        console.error("[landings] Could not remove the previous adapted archive", cleanupError);
      }
    }
    return toLandingPage(updated, offer.name);
  } catch (error) {
    if (archivePath) {
      try {
        await dependencies.storage.remove(archivePath);
      } catch (cleanupError) {
        console.error("[landings] Could not remove an unused adapted archive", cleanupError);
      }
    }
    const isAdapterError = error instanceof LandingAdapterError;
    try {
      const updated = await dependencies.repository.updateAdapter({
        workspaceId: input.workspaceId,
        landingId: input.landingId,
        status: isAdapterError ? "needs_adaptation" : "error",
        reason: isAdapterError ? error.reason : null,
        adaptedArchivePath: current.adapted_archive_path,
        adaptedArchiveBytes: current.adapted_archive_bytes,
        publicFormId: input.publicFormId,
        tiktokPixelId,
        googleAdsConversionId,
        googleAdsConversionLabel,
        tiktokTrackingProfileId,
        googleAdsTrackingProfileId,
        expectedSourceArchivePath: current.source_archive_path,
        expectedOfferId: current.offer_id,
      });
      if (isAdapterError) return toLandingPage(updated, offer.name);
    } catch (persistError) {
      console.error("[landings] Could not record the failed preparation", persistError);
    }
    throw error;
  }
}

export async function deleteLandingDraft(
  dependencies: { repository: LandingRepository; storage: LandingArchiveStorage },
  input: { workspaceId: string; landingId: string },
): Promise<void> {
  const archivePaths = await dependencies.repository.beginDraftDeletion(
    input.workspaceId,
    input.landingId,
  );
  if (!archivePaths) return;

  // The row is durably marked as pending first. If either operation fails, a
  // retry can safely resume without exposing an editable or published record.
  await dependencies.storage.remove(archivePaths.sourceArchivePath);
  if (archivePaths.adaptedArchivePath) {
    await dependencies.storage.remove(archivePaths.adaptedArchivePath);
  }
  await dependencies.repository.finishDraftDeletion(input.workspaceId, input.landingId);
}

export async function getDownloadableAdaptedArchive(
  dependencies: { repository: LandingRepository; storage: LandingArchiveStorage },
  input: { workspaceId: string; landingId: string },
  currentBuildFingerprint: string,
): Promise<Blob> {
  const landing = await dependencies.repository.getDraft(input.workspaceId, input.landingId);
  if (!landing) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
  if (landing.status !== "draft" || landing.deletion_started_at) {
    throw new ApiError(409, "This landing draft is not available", "CONFLICT");
  }
  if (landing.adapter_status !== "prepared") {
    throw new ApiError(409, "The adapted ZIP is not ready to publish", "CONFLICT");
  }
  if (needsLandingReprepare(true, landing.adapted_build_fingerprint, currentBuildFingerprint)) {
    throw new ApiError(409, "Prepare the landing ZIP again before downloading", "CONFLICT");
  }
  if (!landing.adapted_archive_path) {
    throw new ApiError(404, "No adapted ZIP is available", "NOT_FOUND");
  }
  return dependencies.storage.download(landing.adapted_archive_path);
}

export async function getDownloadablePreviousAdaptedArchive(
  dependencies: { repository: LandingRepository; storage: LandingArchiveStorage },
  input: { workspaceId: string; landingId: string },
): Promise<Blob> {
  const landing = await dependencies.repository.getDraft(input.workspaceId, input.landingId);
  if (!landing) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
  if (landing.status !== "draft" || landing.deletion_started_at) {
    throw new ApiError(409, "This landing draft is not available", "CONFLICT");
  }
  if (!landing.adapted_archive_path) {
    throw new ApiError(404, "No previous adapted ZIP is available", "NOT_FOUND");
  }
  return dependencies.storage.download(landing.adapted_archive_path);
}

export class LandingService {
  private readonly repository: SupabaseLandingRepository;
  private readonly storage: SupabaseLandingArchiveStorage;

  constructor(private readonly client: LandingClient) {
    // The route checks the caller's workspace permissions and validates the
    // ZIP before these writes. Keep privileged credentials on the server so a
    // browser cannot bypass archive analysis through direct PostgREST/Storage calls.
    this.repository = new SupabaseLandingRepository(client, supabaseAdmin);
    this.storage = new SupabaseLandingArchiveStorage(supabaseAdmin);
  }

  async list(workspaceId: string, search: string): Promise<LandingListResponse> {
    return { landings: await this.repository.list(workspaceId, search) };
  }

  async inspectDraftAdapter(
    workspaceId: string,
    landingId: string,
  ): Promise<{
    reason: LandingAdapterReason | null;
    sourceArchivePath: string;
    tiktokPixelId: string | null;
    googleAdsConversionId: string | null;
    googleAdsConversionLabel: string | null;
    tiktokProfileId: string | null;
    googleAdsProfileId: string | null;
  }> {
    const draft = await this.repository.getDraft(workspaceId, landingId);
    if (!draft) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
    if (draft.status !== "draft" || draft.deletion_started_at) {
      throw new ApiError(409, "This landing draft is no longer editable", "CONFLICT");
    }
    const archive = await this.storage.download(draft.source_archive_path);
    return {
      reason: await checkLandingAdapterCompatibility(new Uint8Array(await archive.arrayBuffer())),
      sourceArchivePath: draft.source_archive_path,
      tiktokPixelId: draft.tiktok_pixel_id,
      googleAdsConversionId: draft.google_ads_conversion_id,
      googleAdsConversionLabel: draft.google_ads_conversion_label,
      tiktokProfileId: draft.tiktok_tracking_profile_id,
      googleAdsProfileId: draft.google_ads_tracking_profile_id,
    };
  }

  async recordAdapterBlock(
    workspaceId: string,
    landingId: string,
    reason: LandingAdapterReason,
    expectedSourceArchivePath: string,
  ): Promise<LandingPage> {
    const draft = await this.repository.getDraft(workspaceId, landingId);
    if (!draft) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
    const updated = await this.repository.updateAdapter({
      workspaceId,
      landingId,
      status: "needs_adaptation",
      reason,
      adaptedArchivePath: draft.adapted_archive_path,
      adaptedArchiveBytes: draft.adapted_archive_bytes,
      expectedSourceArchivePath,
      expectedOfferId: draft.offer_id,
    });
    const offer = await this.repository.ensureOffer(workspaceId, draft.offer_id, false);
    return toLandingPage(updated, offer.name);
  }

  createDraft(
    input: LandingCreateInput & {
      workspaceId: string;
      createdByUserId: string;
      archive: Blob;
      analysis: LandingArchiveAnalysis;
    },
  ): Promise<LandingPage> {
    return createLandingDraft({ repository: this.repository, storage: this.storage }, input);
  }

  updateDraft(
    input: LandingUpdateInput & {
      workspaceId: string;
      landingId: string;
      archive?: Blob;
      analysis?: LandingArchiveAnalysis;
    },
  ): Promise<LandingPage> {
    return updateLandingDraft({ repository: this.repository, storage: this.storage }, input);
  }

  deleteDraft(input: { workspaceId: string; landingId: string }): Promise<void> {
    return deleteLandingDraft({ repository: this.repository, storage: this.storage }, input);
  }

  async connectDraft(input: Parameters<typeof connectLandingDraft>[1]): Promise<LandingPage> {
    return connectLandingDraft({ repository: this.repository, storage: this.storage }, input);
  }

  async preparationReadiness(
    workspaceId: string,
    landingId: string,
    selection: LandingTrackingSelection,
  ): Promise<LandingTrackingConfiguration> {
    const result = await this.calculatePreparationReadiness(workspaceId, landingId, selection);
    return result.configuration;
  }

  async downloadAdaptedArchive(workspaceId: string, landingId: string): Promise<Blob> {
    const selection = await new TrackingProfileService().landingConfiguration(
      workspaceId,
      landingId,
    );
    const readiness = await this.calculatePreparationReadiness(workspaceId, landingId, selection);
    return getDownloadableAdaptedArchive(
      { repository: this.repository, storage: this.storage },
      { workspaceId, landingId },
      readiness.currentFingerprint,
    );
  }

  async downloadPreviousAdaptedArchive(workspaceId: string, landingId: string): Promise<Blob> {
    return getDownloadablePreviousAdaptedArchive(
      { repository: this.repository, storage: this.storage },
      { workspaceId, landingId },
    );
  }

  private async calculatePreparationReadiness(
    workspaceId: string,
    landingId: string,
    selection: LandingTrackingSelection,
  ): Promise<{
    currentFingerprint: string;
    configuration: LandingTrackingConfiguration;
  }> {
    const landing = await this.repository.getDraft(workspaceId, landingId);
    if (!landing) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
    if (landing.status !== "draft" || landing.deletion_started_at) {
      throw new ApiError(409, "This landing draft is no longer editable", "CONFLICT");
    }

    const [offer, form, source] = await Promise.all([
      this.repository.getOfferSnapshot(workspaceId, landing.offer_id),
      this.repository.getFormIntegration(workspaceId, landing.offer_id),
      this.storage.download(landing.source_archive_path),
    ]);
    if (!offer) throw new ApiError(404, "The selected offer is not available", "NOT_FOUND");

    let intakeEndpoint: string | null = null;
    let api: "ready" | "missing" | "invalid" = "missing";
    try {
      intakeEndpoint = getPublicLandingIntakeEndpoint();
      if (intakeEndpoint) api = "ready";
    } catch {
      api = "invalid";
    }

    const currentFingerprint = await landingBuildFingerprint({
      sourceArchiveSha256: await sha256Hex(new Uint8Array(await source.arrayBuffer())),
      workspaceId,
      offer,
      formId: form?.publicId ?? null,
      allowedOrigin: form?.allowedOrigin ?? null,
      formActive: form?.isActive ?? false,
      intakeEndpoint,
      tracking: {
        tiktokProfileId: selection.tiktokProfileId,
        tiktokPixelId: selection.tiktokPixelId,
        tiktokProfileActive: selection.tiktokProfileActive,
        googleAdsProfileId: selection.googleAdsProfileId,
        googleAdsConversionId: selection.googleAdsConversionId,
        googleAdsConversionLabel: selection.googleAdsConversionLabel,
        googleAdsProfileActive: selection.googleAdsProfileActive,
      },
    });
    const hasAdaptedArchive = Boolean(landing.adapted_archive_path);
    const needsRepublish = needsLandingReprepare(
      hasAdaptedArchive,
      landing.adapted_build_fingerprint,
      currentFingerprint,
    );
    const originConfigured = Boolean(
      form?.isActive && form.allowedOrigin !== PENDING_LANDING_ORIGIN,
    );
    const zipReady = Boolean(
      landing.adapter_status === "prepared" &&
      api === "ready" &&
      originConfigured &&
      offer.isActive &&
      selection.tiktokProfileActive &&
      selection.googleAdsProfileActive &&
      !needsRepublish,
    );

    return {
      currentFingerprint,
      configuration: {
        ...selection,
        allowedOrigin: form?.allowedOrigin ?? null,
        formActive: form?.isActive ?? false,
        needsRepublish,
        readiness: {
          api,
          originConfigured,
          offerActive: offer.isActive,
          tiktokProfileActive: selection.tiktokProfileActive,
          googleAdsProfileActive: selection.googleAdsProfileActive,
          zipCurrent: hasAdaptedArchive && !needsRepublish,
          zipReady,
        },
      },
    };
  }
}
