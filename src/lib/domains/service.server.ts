import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";
import type { BulkDomainLine } from "./validation";
import { parseBulkDomainHostnames } from "./validation";
import { probeDomainHttps, type HttpsProbeFetch } from "./verification.server";
import { reserveHostWithVerification } from "./workflow";
import type { BulkDomainResult, DomainAddress } from "./types";

type DomainRow = Database["public"]["Tables"]["workspace_domains"]["Row"];
type HostRow = Database["public"]["Tables"]["workspace_domain_hosts"]["Row"];
type DomainDbError = { code?: string; message?: string };

const VERIFICATION_FRESHNESS_MS = 5 * 60 * 1000;
const DOMAIN_QUERY_PAGE_SIZE = 500;

function mapDomainError(error: DomainDbError): ApiError {
  if (error.code === "42501") return new ApiError(403, "Insufficient workspace permissions");
  if (error.code === "P0002" || error.code === "PGRST116") {
    return new ApiError(404, "Domain resource not found", "NOT_FOUND");
  }
  if (["23505", "40001"].includes(error.code ?? "")) {
    return new ApiError(409, "The domain address changed or is already in use", "CONFLICT");
  }
  if (error.code === "23514") {
    return new ApiError(409, "The domain operation is not allowed", "CONFLICT");
  }
  if (["22023", "22P02", "23502", "23503"].includes(error.code ?? "")) {
    return new ApiError(400, "Invalid domain request", "VALIDATION_ERROR");
  }
  return new ApiError(500, "The domain request could not be completed", "INTERNAL_ERROR", error);
}

function throwDbError(error: DomainDbError | null): void {
  if (error) throw mapDomainError(error);
}

function toAddress(host: HostRow, domain: DomainRow): DomainAddress {
  const usageStatus =
    host.status === "disabled"
      ? "disabled"
      : host.current_publication_version_id
        ? "published"
        : host.status === "reserved"
          ? "reserved"
          : "free";
  return {
    id: host.id,
    domainId: host.domain_id,
    hostname: host.hostname,
    apexDomain: host.apex_domain,
    addressType: host.hostname === host.apex_domain ? "root" : "subdomain",
    domainStatus: domain.connection_status,
    technicalStatus: host.technical_status,
    technicalCheckedAt: host.technical_checked_at,
    technicalErrorCode: host.technical_error_code,
    usageStatus,
    createdAt: host.created_at,
  };
}

export type DomainVerificationResult = {
  hostId: string;
  hostname: string;
  technicalStatus: "ready" | "error";
  checkedAt: string;
  errorCode: "DNS_OR_HTTPS_UNAVAILABLE" | "TIMEOUT" | null;
};

export class DomainService {
  constructor(private readonly fetcher: HttpsProbeFetch = fetch) {}

  async listAddresses(workspaceId: string): Promise<DomainAddress[]> {
    const [domains, hosts] = await Promise.all([
      this.getAllDomains(workspaceId),
      this.getAllHosts(workspaceId),
    ]);

    const domainsById = new Map(domains.map((domain) => [domain.id, domain]));
    return hosts.flatMap((host) => {
      const domain = domainsById.get(host.domain_id);
      return domain ? [toAddress(host, domain)] : [];
    });
  }

  async listAvailableAddresses(workspaceId: string): Promise<DomainAddress[]> {
    const freshAfter = new Date(Date.now() - VERIFICATION_FRESHNESS_MS).toISOString();
    const addresses = await this.listAddresses(workspaceId);
    return addresses.filter(
      (address) =>
        address.domainStatus === "active" &&
        address.technicalStatus === "ready" &&
        address.technicalCheckedAt !== null &&
        Date.parse(address.technicalCheckedAt) >= Date.parse(freshAfter) &&
        address.usageStatus === "free",
    );
  }

  async createDomain(
    workspaceId: string,
    createdByUserId: string,
    domainName: string,
  ): Promise<{ domainId: string; rootHostId: string; created: boolean }> {
    const { data, error } = await supabaseAdmin.rpc("create_workspace_domain_with_root_host", {
      p_workspace_id: workspaceId,
      p_domain_name: domainName,
      p_created_by_user_id: createdByUserId,
    });
    throwDbError(error);
    const result = data?.[0];
    if (!result || result.result === "conflict" || !result.domain_id || !result.root_host_id) {
      throw new ApiError(409, "This hostname is already registered", "CONFLICT");
    }
    return {
      domainId: result.domain_id,
      rootHostId: result.root_host_id,
      created: result.result === "created",
    };
  }

  async addSubdomains(
    workspaceId: string,
    domainId: string,
    text: string,
  ): Promise<BulkDomainResult[]> {
    const domain = await this.getDomain(workspaceId, domainId);
    if (!domain) throw new ApiError(404, "Domain not found", "NOT_FOUND");
    if (domain.connection_status !== "active") {
      throw new ApiError(409, "Verify the root domain before adding subdomains", "CONFLICT");
    }

    let lines: BulkDomainLine[];
    try {
      lines = parseBulkDomainHostnames(text, domain.domain_name);
    } catch {
      throw new ApiError(400, "A batch can contain at most 500 lines", "VALIDATION_ERROR");
    }
    const validLines = lines.filter((line) => line.hostname !== null);
    const outcomes = new Map<number, "added" | "already_exists" | "conflict">();

    if (validLines.length) {
      const { data, error } = await supabaseAdmin.rpc("add_workspace_domain_hosts", {
        p_workspace_id: workspaceId,
        p_domain_id: domainId,
        p_hostnames: validLines.map((line) => line.hostname as string),
      });
      throwDbError(error);
      for (const outcome of data ?? []) {
        outcomes.set(outcome.input_index - 1, outcome.outcome);
      }
    }

    let validIndex = 0;
    return lines.map((line) => {
      if (line.error) {
        return {
          lineNumber: line.lineNumber,
          input: line.input,
          hostname: null,
          status: "invalid",
          ...(line.error === "outside_domain" ? { reason: "outside_domain" as const } : {}),
        };
      }
      const status = outcomes.get(validIndex) ?? "conflict";
      validIndex += 1;
      return {
        lineNumber: line.lineNumber,
        input: line.input,
        hostname: line.hostname,
        status,
      };
    });
  }

  async verifyHost(workspaceId: string, hostId: string): Promise<DomainVerificationResult> {
    const host = await this.getHost(workspaceId, hostId);
    if (!host) throw new ApiError(404, "Domain address not found", "NOT_FOUND");
    const result = await this.runVerification(host);
    return {
      hostId,
      hostname: host.hostname,
      technicalStatus: result.ready ? "ready" : "error",
      checkedAt: new Date().toISOString(),
      errorCode: result.errorCode,
    };
  }

  async reserveAddress(
    workspaceId: string,
    hostId: string,
    landingId: string,
  ): Promise<{ reserved: true; alreadyReserved: boolean }> {
    return reserveHostWithVerification(
      { workspaceId, hostId, landingId },
      {
        getHost: async (requestedWorkspaceId, requestedHostId) => {
          const host = await this.getHost(requestedWorkspaceId, requestedHostId);
          return host
            ? {
                id: host.id,
                workspaceId: host.workspace_id,
                hostname: host.hostname,
                status: host.status,
                reservedLandingId: host.reserved_landing_id,
              }
            : null;
        },
        verify: async (host) => {
          const row = await this.getHost(workspaceId, host.id);
          if (!row) throw new ApiError(404, "Domain address not found", "NOT_FOUND");
          if (row.domain.connection_status !== "active") {
            throw new ApiError(
              409,
              "Verify the root domain before reserving an address",
              "CONFLICT",
            );
          }
          return this.runVerification(row);
        },
        reserve: async (requestedWorkspaceId, requestedHostId, requestedLandingId) => {
          const { error } = await supabaseAdmin.rpc("reserve_workspace_domain_host", {
            p_workspace_id: requestedWorkspaceId,
            p_domain_host_id: requestedHostId,
            p_landing_id: requestedLandingId,
          });
          throwDbError(error);
        },
      },
    );
  }

  async releaseReservation(workspaceId: string, hostId: string, landingId: string): Promise<void> {
    const { error } = await supabaseAdmin.rpc("release_workspace_domain_host", {
      p_workspace_id: workspaceId,
      p_domain_host_id: hostId,
      p_landing_id: landingId,
    });
    throwDbError(error);
  }

  private async runVerification(
    host: HostRow,
  ): Promise<{ ready: boolean; errorCode: DomainVerificationResult["errorCode"] }> {
    await this.recordVerification(host.workspace_id, host.id, "checking", null);
    const result = await probeDomainHttps(host.hostname, this.fetcher);
    await this.recordVerification(
      host.workspace_id,
      host.id,
      result.ready ? "ready" : "error",
      result.errorCode,
    );
    return result;
  }

  private async recordVerification(
    workspaceId: string,
    hostId: string,
    status: "checking" | "ready" | "error",
    errorCode: string | null,
  ): Promise<void> {
    const { error } = await supabaseAdmin.rpc("record_workspace_domain_host_verification", {
      p_workspace_id: workspaceId,
      p_domain_host_id: hostId,
      p_technical_status: status,
      p_error_code: errorCode,
    });
    throwDbError(error);
  }

  private async getDomain(workspaceId: string, domainId: string): Promise<DomainRow | null> {
    const { data, error } = await supabaseAdmin
      .from("workspace_domains")
      .select(
        "id, workspace_id, domain_name, connection_status, created_at, updated_at, created_by_user_id",
      )
      .eq("workspace_id", workspaceId)
      .eq("id", domainId)
      .maybeSingle();
    throwDbError(error);
    return data;
  }

  private async getAllDomains(workspaceId: string): Promise<DomainRow[]> {
    const rows: DomainRow[] = [];
    for (let from = 0; ; from += DOMAIN_QUERY_PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("workspace_domains")
        .select(
          "id, workspace_id, domain_name, connection_status, created_at, updated_at, created_by_user_id",
        )
        .eq("workspace_id", workspaceId)
        .order("domain_name")
        .range(from, from + DOMAIN_QUERY_PAGE_SIZE - 1);
      throwDbError(error);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < DOMAIN_QUERY_PAGE_SIZE) return rows;
    }
  }

  private async getAllHosts(workspaceId: string): Promise<HostRow[]> {
    const rows: HostRow[] = [];
    for (let from = 0; ; from += DOMAIN_QUERY_PAGE_SIZE) {
      const { data, error } = await supabaseAdmin
        .from("workspace_domain_hosts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("hostname")
        .range(from, from + DOMAIN_QUERY_PAGE_SIZE - 1);
      throwDbError(error);
      const page = data ?? [];
      rows.push(...page);
      if (page.length < DOMAIN_QUERY_PAGE_SIZE) return rows;
    }
  }

  private async getHost(
    workspaceId: string,
    hostId: string,
  ): Promise<(HostRow & { domain: DomainRow }) | null> {
    const { data: host, error: hostError } = await supabaseAdmin
      .from("workspace_domain_hosts")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", hostId)
      .maybeSingle();
    throwDbError(hostError);
    if (!host) return null;
    const domain = await this.getDomain(workspaceId, host.domain_id);
    if (!domain) return null;
    return { ...host, domain };
  }
}
