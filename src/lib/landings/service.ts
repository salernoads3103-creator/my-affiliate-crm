import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import { LandingPageSchema } from "./validation";
import type {
  LandingArchiveAnalysis,
  LandingArchiveStorage,
  LandingCreateInput,
  LandingListResponse,
  LandingPage,
  LandingRepository,
} from "./types";

const LANDING_ARCHIVE_BUCKET = "crmonia-landing-archives";
type LandingClient = SupabaseClient<Database>;

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

  async ensureActiveOffer(workspaceId: string, offerId: string): Promise<{ name: string }> {
    const { data, error } = await this.client
      .from("workspace_offers")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .eq("id", offerId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw databaseError(error);
    if (!data) throw new ApiError(404, "The selected offer is not available");
    return { name: data.name };
  }

  async insertDraft(input: {
    id: string;
    workspaceId: string;
    name: string;
    offerId: string;
    createdByUserId: string;
    sourceArchivePath: string;
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
  const offer = await dependencies.repository.ensureActiveOffer(input.workspaceId, input.offerId);
  const id = input.createId?.() ?? crypto.randomUUID();
  const sourceArchivePath = `${input.workspaceId}/${id}/source.zip`;
  const { createdAt } = await dependencies.repository.insertDraft({
    id,
    workspaceId: input.workspaceId,
    name: input.name,
    offerId: input.offerId,
    createdByUserId: input.createdByUserId,
    sourceArchivePath,
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
    analysis: input.analysis,
  };
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
}
