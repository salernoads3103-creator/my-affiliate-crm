export type DomainTechnicalStatus = "not_configured" | "checking" | "ready" | "error";

export type DomainUsageStatus = "free" | "reserved" | "published" | "disabled";

export type DomainAddress = {
  id: string;
  domainId: string;
  hostname: string;
  apexDomain: string;
  addressType: "root" | "subdomain";
  domainStatus: "pending" | "active" | "error";
  technicalStatus: DomainTechnicalStatus;
  technicalCheckedAt: string | null;
  technicalErrorCode: string | null;
  usageStatus: DomainUsageStatus;
  createdAt: string;
};

export type BulkDomainResult = {
  lineNumber: number;
  input: string;
  hostname: string | null;
  status: "added" | "already_exists" | "invalid" | "conflict";
  reason?: "outside_domain";
};

export type DomainHostProbeResult = {
  ready: boolean;
  errorCode: "DNS_OR_HTTPS_UNAVAILABLE" | "TIMEOUT" | null;
};
