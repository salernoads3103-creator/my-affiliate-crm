import type { AccessClient } from "@/lib/access/access.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import { DomainService } from "@/lib/domains/service.server";
import { analyzeLandingArchive } from "@/lib/landings/archive";
import { sha256Hex } from "@/lib/landings/fingerprint";
import { LandingService } from "@/lib/landings/service";
import { CloudflareR2Store } from "@/lib/publications/r2.server";
import { SupabasePublicationRepository } from "@/lib/publications/repository.server";
import {
  PublicationReadinessError,
  publishLanding,
  resumeLandingPublication,
} from "@/lib/publications/service";
import { prepareLandingAdapter } from "@/lib/landings/adapter.server";
import {
  OfferLaunchStepError,
  type OfferLaunchErrorCode,
  type OfferLaunchState,
  type OfferLaunchWorkflowPort,
  withOfferLaunchLeaseHeartbeat,
} from "./workflow";
import { continueOfferLaunch } from "./workflow";

type LaunchRow = Database["public"]["Tables"]["workspace_offer_launch_workflows"]["Row"];
type LaunchStage = OfferLaunchState["stage"];

function rpcError(error: { code?: string; message?: string }): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "P0002" || error.code === "PGRST116") {
    return new ApiError(404, "Offer launch resource not found", "NOT_FOUND");
  }
  if (["23505", "40001", "23514"].includes(error.code ?? "")) {
    return new ApiError(409, "The launch state changed; review the selected hostname", "CONFLICT");
  }
  if (["22023", "22P02", "23502", "23503"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid offer launch request", "VALIDATION_ERROR");
  }
  return new ApiError(500, "The offer launch could not be completed", "INTERNAL_ERROR", error);
}

function toState(row: LaunchRow): OfferLaunchState {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    offer_id: row.offer_id,
    offer_name: row.offer_name,
    product_id: row.product_id,
    domain_host_id: row.domain_host_id,
    stage: row.stage,
    publication_attempt: row.publication_attempt,
    publication_version_id: row.publication_version_id,
    published_url: row.published_url,
    last_error_code: row.last_error_code as OfferLaunchErrorCode | null,
  };
}

export class OfferLaunchRepository {
  constructor(private readonly client = supabaseAdmin) {}

  async begin(
    client: AccessClient,
    input: {
      workspaceId: string;
      launchId: string;
      requestFingerprint: string;
      sourceArchivePath: string;
      sourceArchiveSha256: string;
      productId: string;
      offerName: string;
      offerPriceMinor: number;
      hostId: string;
      tracking: {
        tiktokProfileId: string | null;
        tiktokPixelId: string | null;
        googleAdsProfileId: string | null;
        googleAdsConversionId: string | null;
        googleAdsConversionLabel: string | null;
      };
    },
  ): Promise<void> {
    const { data, error } = await client.rpc("begin_workspace_offer_launch", {
      p_workspace_id: input.workspaceId,
      p_launch_id: input.launchId,
      p_request_fingerprint: input.requestFingerprint,
      p_source_archive_path: input.sourceArchivePath,
      p_source_archive_sha256: input.sourceArchiveSha256,
      p_product_id: input.productId,
      p_offer_name: input.offerName,
      p_offer_price_minor: input.offerPriceMinor,
      p_domain_host_id: input.hostId,
      p_tiktok_tracking_profile_id: input.tracking.tiktokProfileId,
      p_google_ads_tracking_profile_id: input.tracking.googleAdsProfileId,
      p_tiktok_pixel_id: input.tracking.tiktokPixelId,
      p_google_ads_conversion_id: input.tracking.googleAdsConversionId,
      p_google_ads_conversion_label: input.tracking.googleAdsConversionLabel,
    });
    if (error) throw rpcError(error);
    if (!data?.[0]) throw new ApiError(500, "Could not start the offer launch", "INTERNAL_ERROR");
  }

  async get(workspaceId: string, launchId: string): Promise<OfferLaunchState | null> {
    const { data, error } = await this.client
      .from("workspace_offer_launch_workflows")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", launchId)
      .maybeSingle();
    if (error) throw rpcError(error);
    return data ? toState(data) : null;
  }

  async getRow(workspaceId: string, launchId: string): Promise<LaunchRow | null> {
    const { data, error } = await this.client
      .from("workspace_offer_launch_workflows")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", launchId)
      .maybeSingle();
    if (error) throw rpcError(error);
    return data;
  }

  async claim(workspaceId: string, launchId: string, token: string): Promise<boolean> {
    const { data, error } = await this.client.rpc("claim_workspace_offer_launch", {
      p_workspace_id: workspaceId,
      p_launch_id: launchId,
      p_processing_token: token,
    });
    if (error) throw rpcError(error);
    return data === true;
  }

  async renew(workspaceId: string, launchId: string, token: string): Promise<void> {
    const { data, error } = await this.client.rpc("renew_workspace_offer_launch_claim", {
      p_workspace_id: workspaceId,
      p_launch_id: launchId,
      p_processing_token: token,
    });
    if (error) throw rpcError(error);
    if (!data) throw new ApiError(409, "Another request is processing this launch", "CONFLICT");
  }

  async release(workspaceId: string, launchId: string, token: string): Promise<void> {
    const { error } = await this.client.rpc("release_workspace_offer_launch_claim", {
      p_workspace_id: workspaceId,
      p_launch_id: launchId,
      p_processing_token: token,
    });
    if (error) throw rpcError(error);
  }

  async changeHost(workspaceId: string, launchId: string, hostId: string): Promise<void> {
    const { error } = await this.client.rpc("change_workspace_offer_launch_host", {
      p_workspace_id: workspaceId,
      p_launch_id: launchId,
      p_domain_host_id: hostId,
    });
    if (error) throw rpcError(error);
  }

  async advance(launch: OfferLaunchState, stage: LaunchStage): Promise<void> {
    const allowed: Record<LaunchStage, LaunchStage[]> = {
      offer_created: ["offer_created"],
      landing_created: ["offer_created", "landing_created"],
      adapter_prepared: ["landing_created", "adapter_prepared"],
      published: ["adapter_prepared", "published"],
    };
    const { data, error } = await this.client
      .from("workspace_offer_launch_workflows")
      .update({ stage, last_error_code: null })
      .eq("workspace_id", launch.workspace_id)
      .eq("id", launch.id)
      .in("stage", allowed[stage])
      .select("id")
      .maybeSingle();
    if (error) throw rpcError(error);
    if (data) return;
    const current = await this.get(launch.workspace_id, launch.id);
    const order: LaunchStage[] = [
      "offer_created",
      "landing_created",
      "adapter_prepared",
      "published",
    ];
    if (!current || order.indexOf(current.stage) < order.indexOf(stage)) {
      throw new ApiError(409, "The launch state changed; continue from its saved step", "CONFLICT");
    }
  }

  async recordError(launch: OfferLaunchState, code: OfferLaunchErrorCode): Promise<void> {
    const { error } = await this.client
      .from("workspace_offer_launch_workflows")
      .update({ last_error_code: code })
      .eq("workspace_id", launch.workspace_id)
      .eq("id", launch.id)
      .neq("stage", "published");
    if (error) throw rpcError(error);
  }

  async complete(
    launch: OfferLaunchState,
    publication: { versionId: string; url: string },
  ): Promise<void> {
    const { data, error } = await this.client
      .from("workspace_offer_launch_workflows")
      .update({
        stage: "published",
        publication_version_id: publication.versionId,
        published_url: publication.url,
        last_error_code: null,
      })
      .eq("workspace_id", launch.workspace_id)
      .eq("id", launch.id)
      .in("stage", ["adapter_prepared", "published"])
      .select("publication_version_id, published_url")
      .maybeSingle();
    if (error) throw rpcError(error);
    if (data) {
      if (
        data.publication_version_id !== publication.versionId ||
        data.published_url !== publication.url
      ) {
        throw new ApiError(409, "The saved publication result does not match", "CONFLICT");
      }
      return;
    }
    const current = await this.getRow(launch.workspace_id, launch.id);
    if (
      !current ||
      current.stage !== "published" ||
      current.publication_version_id !== publication.versionId ||
      current.published_url !== publication.url
    ) {
      throw new ApiError(409, "Could not save the completed publication", "CONFLICT");
    }
  }

  async setPublicationAttempt(
    workspaceId: string,
    launchId: string,
    expectedAttempt: number,
  ): Promise<number> {
    const nextAttempt = expectedAttempt + 1;
    if (nextAttempt > 99) {
      throw new ApiError(409, "The maximum number of publication retries was reached", "CONFLICT");
    }
    const { data, error } = await this.client
      .from("workspace_offer_launch_workflows")
      .update({ publication_attempt: nextAttempt })
      .eq("workspace_id", workspaceId)
      .eq("id", launchId)
      .eq("publication_attempt", expectedAttempt)
      .select("publication_attempt")
      .maybeSingle();
    if (error) throw rpcError(error);
    if (data) return data.publication_attempt;
    const row = await this.getRow(workspaceId, launchId);
    if (!row || row.publication_attempt < nextAttempt) {
      throw new ApiError(409, "Could not resume the publication attempt", "CONFLICT");
    }
    return row.publication_attempt;
  }
}

export function launchStageView(row: LaunchRow): {
  launchId: string;
  offerId: string;
  offerName: string;
  stage: LaunchStage;
  lastErrorCode: OfferLaunchErrorCode | null;
  url: string | null;
  isProcessing: boolean;
  hostId: string;
} {
  return {
    launchId: row.id,
    offerId: row.offer_id,
    offerName: row.offer_name,
    stage: row.stage,
    lastErrorCode: row.last_error_code as OfferLaunchErrorCode | null,
    url: row.stage === "published" ? row.published_url : null,
    isProcessing: row.processing_until !== null && Date.parse(row.processing_until) > Date.now(),
    hostId: row.domain_host_id,
  };
}

export async function continueSavedOfferLaunch(input: {
  client: AccessClient;
  workspaceId: string;
  launchId: string;
  requestHostId?: string;
  processingToken: string;
}): Promise<ReturnType<typeof launchStageView> & { hostname: string | null }> {
  const repository = new OfferLaunchRepository();
  const claimed = await repository.claim(input.workspaceId, input.launchId, input.processingToken);
  const row = await repository.getRow(input.workspaceId, input.launchId);
  if (!row) throw new ApiError(404, "Offer launch was not found", "NOT_FOUND");
  if (!claimed) {
    const hostname = (await new DomainService().listAddresses(input.workspaceId)).find(
      (address) => address.id === row.domain_host_id,
    )?.hostname;
    return { ...launchStageView(row), hostname: hostname ?? null };
  }

  try {
    const port: OfferLaunchWorkflowPort = {
      get: (workspaceId, launchId) => repository.get(workspaceId, launchId),
      ensureLanding: (launch) =>
        withOfferLaunchLeaseHeartbeat(
          {
            workspaceId: input.workspaceId,
            launchId: input.launchId,
            renew: () => repository.renew(input.workspaceId, input.launchId, input.processingToken),
          },
          async () => {
            const landingService = new LandingService(input.client);
            const staged = await landingService.readStagedLaunchArchive(row.source_archive_path);
            const bytes = new Uint8Array(await staged.arrayBuffer());
            const analysis = await analyzeLandingArchive(bytes);
            await landingService.createOrResumeLaunchDraft({
              workspaceId: input.workspaceId,
              landingId: launch.id,
              createdByUserId: row.created_by_user_id,
              offerId: launch.offer_id,
              name: row.offer_name,
              archive: staged,
              analysis,
            });
          },
        ),
      changeHostname: async (launch, hostId) => {
        await repository.renew(input.workspaceId, input.launchId, input.processingToken);
        const domains = new DomainService();
        const verification = await domains.verifyHost(input.workspaceId, hostId);
        if (verification.technicalStatus !== "ready") {
          throw new ApiError(409, "DNS and HTTPS are not ready for this address", "CONFLICT");
        }
        await repository.changeHost(input.workspaceId, launch.id, hostId);
      },
      reserveHostname: async (launch) => {
        await repository.renew(input.workspaceId, input.launchId, input.processingToken);
        await new DomainService().reserveAddress(
          input.workspaceId,
          launch.domain_host_id,
          launch.id,
        );
      },
      prepareAdapter: (launch) =>
        withOfferLaunchLeaseHeartbeat(
          {
            workspaceId: input.workspaceId,
            launchId: input.launchId,
            renew: () => repository.renew(input.workspaceId, input.launchId, input.processingToken),
          },
          async () => {
            const address = (await new DomainService().listAddresses(input.workspaceId)).find(
              (item) => item.id === launch.domain_host_id,
            );
            if (!address) throw new ApiError(404, "Domain address was not found", "NOT_FOUND");
            const adapted = await prepareLandingAdapter(
              input.client,
              input.workspaceId,
              launch.id,
              {
                allowedOrigin: `https://${address.hostname}`,
                resolvedTracking: {
                  tiktokProfileId: row.tiktok_tracking_profile_id,
                  tiktokPixelId: row.tiktok_pixel_id,
                  googleAdsProfileId: row.google_ads_tracking_profile_id,
                  googleAdsConversionId: row.google_ads_conversion_id,
                  googleAdsConversionLabel: row.google_ads_conversion_label,
                },
              },
            );
            if (adapted.adapter_status === "prepared") return "prepared";
            return {
              blocked:
                adapted.adapter_reason === "api_url_not_configured"
                  ? "INTAKE_API_NOT_CONFIGURED"
                  : "LANDING_ADAPTATION_REQUIRED",
            };
          },
        ),
      publish: (launch) =>
        withOfferLaunchLeaseHeartbeat(
          {
            workspaceId: input.workspaceId,
            launchId: input.launchId,
            renew: () => repository.renew(input.workspaceId, input.launchId, input.processingToken),
          },
          async () => {
            const publicationRepository = new SupabasePublicationRepository();
            const landingService = new LandingService(input.client);
            const host = await publicationRepository.getHostTarget(
              input.workspaceId,
              launch.domain_host_id,
              launch.id,
            );
            let attempt = launch.publication_attempt;
            let keyHash = await hashPublicationIdempotencyKey(launch.id, attempt);
            let existing = await publicationRepository.findOperation(
              input.workspaceId,
              launch.domain_host_id,
              keyHash,
            );
            if (
              existing &&
              (existing.landingId !== launch.id || existing.operationKind !== "publish")
            ) {
              throw new ApiError(
                409,
                "This publication key belongs to another operation",
                "CONFLICT",
              );
            }
            if (existing?.status === "failed") {
              attempt = await repository.setPublicationAttempt(
                input.workspaceId,
                launch.id,
                attempt,
              );
              keyHash = await hashPublicationIdempotencyKey(launch.id, attempt);
              existing = await publicationRepository.findOperation(
                input.workspaceId,
                launch.domain_host_id,
                keyHash,
              );
            }
            if (existing?.status === "failed") {
              throw new ApiError(409, "A new publication attempt could not be started", "CONFLICT");
            }
            const publishInput = {
              workspaceId: input.workspaceId,
              hostId: launch.domain_host_id,
              landingId: launch.id,
              hostname: host.hostname,
              idempotencyKeyHash: keyHash,
              createdByUserId: row.created_by_user_id,
            };
            const dependencies = {
              repository: publicationRepository,
              storage: new CloudflareR2Store(),
              verifyHost: async () => {
                const verification = await new DomainService().verifyHost(
                  input.workspaceId,
                  launch.domain_host_id,
                );
                return verification.technicalStatus === "ready";
              },
            };
            try {
              const result =
                existing &&
                ["database_switched", "recovery_required", "completed"].includes(existing.status)
                  ? await resumeLandingPublication(dependencies, publishInput, existing)
                  : await publishLanding(
                      {
                        ...dependencies,
                        getPreparedArchive: () =>
                          landingService.getPreparedArchiveForPublication(
                            input.workspaceId,
                            launch.id,
                            {
                              tiktokProfileId: row.tiktok_tracking_profile_id,
                              tiktokPixelId: row.tiktok_pixel_id,
                              googleAdsProfileId: row.google_ads_tracking_profile_id,
                              googleAdsConversionId: row.google_ads_conversion_id,
                              googleAdsConversionLabel: row.google_ads_conversion_label,
                            },
                          ),
                      },
                      publishInput,
                    );
              return { versionId: result.versionId, url: result.url };
            } catch (error) {
              if (error instanceof PublicationReadinessError && error.reason === "not_ready") {
                throw new OfferLaunchStepError("DOMAIN_NOT_READY");
              }
              throw error;
            }
          },
        ),
      advance: (launch, stage) => repository.advance(launch, stage),
      complete: (launch, publication) => repository.complete(launch, publication),
      recordError: (launch, code) => repository.recordError(launch, code),
      hostname: async (workspaceId, hostId) =>
        (await new DomainService().listAddresses(workspaceId)).find(
          (address) => address.id === hostId,
        )?.hostname ?? null,
    };
    const result = await continueOfferLaunch(
      input.workspaceId,
      input.launchId,
      port,
      input.requestHostId,
    );
    const current = await repository.getRow(input.workspaceId, input.launchId);
    if (!current) throw new ApiError(404, "Offer launch was not found", "NOT_FOUND");
    return { ...launchStageView(current), hostname: result.hostname };
  } finally {
    await repository
      .release(input.workspaceId, input.launchId, input.processingToken)
      .catch(() => undefined);
  }
}

async function hashPublicationIdempotencyKey(launchId: string, attempt: number): Promise<string> {
  return sha256Hex(new TextEncoder().encode(`offer-launch:${launchId}:publication:${attempt}`));
}
