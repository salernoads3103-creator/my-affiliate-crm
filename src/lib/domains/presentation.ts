import type {
  BulkDomainResult,
  DomainAddress,
  DomainTechnicalStatus,
  DomainUsageStatus,
} from "./types";

export type DomainTechnicalFilter = "all" | DomainTechnicalStatus;
export type DomainUsageFilter = "all" | DomainUsageStatus;

export function filterDomainAddresses(
  addresses: DomainAddress[],
  search: string,
  technicalFilter: DomainTechnicalFilter,
  usageFilter: DomainUsageFilter,
): DomainAddress[] {
  const query = search.trim().toLocaleLowerCase();
  return addresses.filter((address) => {
    const matchesSearch =
      !query ||
      address.hostname.toLocaleLowerCase().includes(query) ||
      address.apexDomain.toLocaleLowerCase().includes(query);
    const matchesTechnical =
      technicalFilter === "all" || address.technicalStatus === technicalFilter;
    const matchesUsage = usageFilter === "all" || address.usageStatus === usageFilter;
    return matchesSearch && matchesTechnical && matchesUsage;
  });
}

export type BulkDomainCounts = Record<BulkDomainResult["status"], number>;

export function countBulkDomainResults(results: BulkDomainResult[]): BulkDomainCounts {
  return results.reduce<BulkDomainCounts>(
    (counts, result) => {
      counts[result.status] += 1;
      return counts;
    },
    { added: 0, already_exists: 0, invalid: 0, conflict: 0 },
  );
}
