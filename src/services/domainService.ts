import type {
  BulkDomainResult,
  DomainAddress,
  DomainVerificationResponse,
} from "@/lib/domains/types";
import { accessApi } from "@/services/accessApi";

function domainsPath(workspaceId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/domains`;
}

export const domainService = {
  async list(workspaceId: string): Promise<DomainAddress[]> {
    const response = await accessApi.get<{ addresses: DomainAddress[] }>(domainsPath(workspaceId));
    return response.addresses;
  },

  async listAvailable(workspaceId: string): Promise<DomainAddress[]> {
    const response = await accessApi.get<{ addresses: DomainAddress[] }>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/domain-hosts/available`,
    );
    return response.addresses;
  },

  createRoot(workspaceId: string, domainName: string): Promise<{ domainId: string }> {
    return accessApi.post<{ domainId: string; rootHostId: string; created: boolean }>(
      domainsPath(workspaceId),
      { domainName },
    );
  },

  async addSubdomains(
    workspaceId: string,
    domainId: string,
    hostnames: string,
  ): Promise<BulkDomainResult[]> {
    const response = await accessApi.post<{ results: BulkDomainResult[] }>(
      `${domainsPath(workspaceId)}/${encodeURIComponent(domainId)}/hosts`,
      { hostnames },
    );
    return response.results;
  },

  verifyHost(workspaceId: string, hostId: string): Promise<DomainVerificationResponse> {
    return accessApi.post<DomainVerificationResponse>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/domain-hosts/${encodeURIComponent(hostId)}/verify`,
      {},
    );
  },
};
