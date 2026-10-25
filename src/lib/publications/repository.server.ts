import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import type {
  PublicationClaim,
  PublicationClaimInput,
  ExistingPublicationOperation,
  PublicationOperationStatus,
  PublicationRepository,
} from "./service";

type AdminClient = SupabaseClient<Database>;

function mapPublicationError(error: { code?: string; message?: string }): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "P0002" || error.code === "PGRST116") {
    return new ApiError(404, "Publication resource not found", "NOT_FOUND");
  }
  if (["23505", "40001", "23514"].includes(error.code ?? "")) {
    return new ApiError(409, "The publication state changed; reload and try again", "CONFLICT");
  }
  if (["22023", "22P02", "23502", "23503"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid publication request", "VALIDATION_ERROR");
  }
  return new ApiError(
    500,
    "The publication request could not be completed",
    "INTERNAL_ERROR",
    error,
  );
}

function throwIfError(error: { code?: string; message?: string } | null): void {
  if (error) throw mapPublicationError(error);
}

export class SupabasePublicationRepository implements PublicationRepository {
  constructor(private readonly client: AdminClient = supabaseAdmin) {}

  async getCurrentVersionId(workspaceId: string, hostId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from("workspace_domain_hosts")
      .select("current_publication_version_id")
      .eq("workspace_id", workspaceId)
      .eq("id", hostId)
      .maybeSingle();
    throwIfError(error);
    if (!data) throw new ApiError(404, "Domain address not found", "NOT_FOUND");
    return data.current_publication_version_id;
  }

  async getVersionPrefix(
    workspaceId: string,
    hostId: string,
    versionId: string,
  ): Promise<string | null> {
    const { data, error } = await this.client
      .from("landing_publication_versions")
      .select("r2_prefix")
      .eq("workspace_id", workspaceId)
      .eq("domain_host_id", hostId)
      .eq("id", versionId)
      .maybeSingle();
    throwIfError(error);
    return data?.r2_prefix ?? null;
  }

  async claim(input: PublicationClaimInput): Promise<PublicationClaim> {
    const { data, error } = await this.client.rpc("claim_landing_publication_operation", {
      p_operation_id: input.operationId,
      p_workspace_id: input.workspaceId,
      p_domain_host_id: input.hostId,
      p_landing_id: input.landingId,
      p_operation_kind: input.operationKind,
      p_idempotency_key_hash: input.idempotencyKeyHash,
      p_request_fingerprint: input.requestFingerprint,
      p_expected_current_version_id: input.expectedCurrentVersionId,
      p_build_fingerprint: input.buildFingerprint,
      p_zip_fingerprint: input.zipFingerprint,
      p_target_publication_version_id: input.targetVersionId,
      p_created_by_user_id: input.createdByUserId,
    });
    throwIfError(error);
    const result = data?.[0];
    if (!result) throw new ApiError(500, "Could not start the publication", "INTERNAL_ERROR");
    if (
      !["uploading", "database_switched", "completed", "failed", "recovery_required"].includes(
        result.operation_status,
      )
    ) {
      throw new ApiError(500, "Invalid publication state", "INTERNAL_ERROR");
    }
    return {
      operationId: result.operation_id,
      targetVersionId: result.target_publication_version_id,
      targetPrefix: result.target_prefix,
      versionNumber: result.version_number,
      status: result.operation_status as PublicationOperationStatus,
      wasReplay: result.was_replay,
      expectedCurrentVersionId: result.expected_current_version_id,
    };
  }

  async findOperation(
    workspaceId: string,
    hostId: string,
    idempotencyKeyHash: string,
  ): Promise<ExistingPublicationOperation | null> {
    const { data, error } = await this.client
      .from("landing_publication_operations")
      .select(
        "id, landing_id, operation_kind, request_fingerprint, expected_current_version_id, target_publication_version_id, status",
      )
      .eq("workspace_id", workspaceId)
      .eq("domain_host_id", hostId)
      .eq("idempotency_key_hash", idempotencyKeyHash)
      .maybeSingle();
    throwIfError(error);
    if (!data) return null;
    if (
      !["publish", "rollback"].includes(data.operation_kind) ||
      !["uploading", "database_switched", "completed", "failed", "recovery_required"].includes(
        data.status,
      )
    ) {
      throw new ApiError(500, "Invalid publication operation state", "INTERNAL_ERROR");
    }
    return {
      id: data.id,
      landingId: data.landing_id,
      operationKind: data.operation_kind as "publish" | "rollback",
      requestFingerprint: data.request_fingerprint,
      expectedCurrentVersionId: data.expected_current_version_id,
      targetVersionId: data.target_publication_version_id,
      status: data.status as PublicationOperationStatus,
    };
  }

  async getOperationStatus(operationId: string): Promise<PublicationOperationStatus | null> {
    const { data, error } = await this.client
      .from("landing_publication_operations")
      .select("status")
      .eq("id", operationId)
      .maybeSingle();
    throwIfError(error);
    return (data?.status as PublicationOperationStatus | undefined) ?? null;
  }

  async advance(operationId: string): Promise<void> {
    const { error } = await this.client.rpc("advance_landing_publication_operation", {
      p_operation_id: operationId,
    });
    throwIfError(error);
  }

  async complete(operationId: string): Promise<void> {
    const { error } = await this.client.rpc("complete_landing_publication_operation", {
      p_operation_id: operationId,
    });
    throwIfError(error);
  }

  async fail(operationId: string): Promise<void> {
    const { error } = await this.client.rpc("fail_landing_publication_operation", {
      p_operation_id: operationId,
    });
    throwIfError(error);
  }

  async requireRecovery(operationId: string): Promise<void> {
    const { error } = await this.client.rpc("require_landing_publication_recovery", {
      p_operation_id: operationId,
    });
    throwIfError(error);
  }

  async getHostTarget(
    workspaceId: string,
    hostId: string,
    landingId: string,
  ): Promise<{ hostname: string; expectedCurrentVersionId: string | null }> {
    const { data, error } = await this.client
      .from("workspace_domain_hosts")
      .select(
        "id, workspace_id, hostname, status, reserved_landing_id, current_publication_version_id",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", hostId)
      .maybeSingle();
    throwIfError(error);
    if (!data) throw new ApiError(404, "Domain address not found", "NOT_FOUND");
    if (
      data.status === "disabled" ||
      (data.reserved_landing_id && data.reserved_landing_id !== landingId)
    ) {
      throw new ApiError(
        409,
        "This hostname is not available for the selected landing",
        "CONFLICT",
      );
    }
    return {
      hostname: data.hostname,
      expectedCurrentVersionId: data.current_publication_version_id,
    };
  }

  async listHistory(
    workspaceId: string,
    landingId: string,
  ): Promise<
    Array<{
      id: string;
      domainHostId: string;
      hostname: string;
      versionNumber: number;
      publishedAt: string;
      current: boolean;
      url: string;
    }>
  > {
    const [versionsResult, operationsResult] = await Promise.all([
      this.client
        .from("landing_publication_versions")
        .select("id, domain_host_id, version_number, created_at")
        .eq("workspace_id", workspaceId)
        .eq("landing_id", landingId)
        .order("created_at", { ascending: false })
        .limit(200),
      this.client
        .from("landing_publication_operations")
        .select("target_publication_version_id, domain_host_id, status, operation_kind, created_at")
        .eq("workspace_id", workspaceId)
        .eq("landing_id", landingId)
        .eq("status", "completed")
        .eq("operation_kind", "publish"),
    ]);
    throwIfError(versionsResult.error);
    throwIfError(operationsResult.error);
    const completed = new Map(
      (operationsResult.data ?? []).map((operation) => [
        operation.target_publication_version_id,
        operation,
      ]),
    );
    const visibleVersions = (versionsResult.data ?? []).filter((version) =>
      completed.has(version.id),
    );
    if (visibleVersions.length === 0) return [];

    const hostIds = [...new Set(visibleVersions.map((version) => version.domain_host_id))];
    const { data: hosts, error: hostsError } = await this.client
      .from("workspace_domain_hosts")
      .select("id, hostname, current_publication_version_id")
      .eq("workspace_id", workspaceId)
      .in("id", hostIds);
    throwIfError(hostsError);
    const hostsById = new Map((hosts ?? []).map((host) => [host.id, host]));
    return visibleVersions.flatMap((version) => {
      const host = hostsById.get(version.domain_host_id);
      const publishedOperation = completed.get(version.id);
      if (!host || !publishedOperation) return [];
      return [
        {
          id: version.id,
          domainHostId: version.domain_host_id,
          hostname: host.hostname,
          versionNumber: version.version_number,
          publishedAt: publishedOperation.created_at,
          current: host.current_publication_version_id === version.id,
          url: `https://${host.hostname}`,
        },
      ];
    });
  }
}
