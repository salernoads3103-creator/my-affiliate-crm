import { describe, expect, it } from "bun:test";
import type { BulkDomainResult, DomainAddress } from "../src/lib/domains/types";
import { countBulkDomainResults, filterDomainAddresses } from "../src/lib/domains/presentation";
import { t } from "../src/lib/i18n";

const addresses: DomainAddress[] = [
  {
    id: "host-root",
    domainId: "domain-a",
    hostname: "myshop.com",
    apexDomain: "myshop.com",
    addressType: "root",
    domainStatus: "active",
    technicalStatus: "ready",
    technicalCheckedAt: "2026-10-25T10:00:00.000Z",
    technicalErrorCode: null,
    usageStatus: "free",
    createdAt: "2026-10-25T09:00:00.000Z",
  },
  {
    id: "host-subdomain",
    domainId: "domain-a",
    hostname: "britva.myshop.com",
    apexDomain: "myshop.com",
    addressType: "subdomain",
    domainStatus: "active",
    technicalStatus: "not_configured",
    technicalCheckedAt: null,
    technicalErrorCode: null,
    usageStatus: "reserved",
    createdAt: "2026-10-25T09:10:00.000Z",
  },
];

describe("domains UI helpers", () => {
  it("filters the unified root and subdomain list by hostname and exact statuses", () => {
    expect(filterDomainAddresses(addresses, "BRITVA", "all", "all")).toEqual([addresses[1]]);
    expect(filterDomainAddresses(addresses, "myshop.com", "ready", "free")).toEqual([addresses[0]]);
    expect(filterDomainAddresses(addresses, "", "not_configured", "reserved")).toEqual([
      addresses[1],
    ]);
    expect(filterDomainAddresses(addresses, "missing", "all", "all")).toEqual([]);
  });

  it("counts server outcomes without inventing additional batch result states", () => {
    const results: BulkDomainResult[] = [
      { lineNumber: 1, input: "britva", hostname: "britva.myshop.com", status: "added" },
      {
        lineNumber: 2,
        input: "britva.myshop.com",
        hostname: "britva.myshop.com",
        status: "already_exists",
      },
      {
        lineNumber: 3,
        input: "other.test",
        hostname: null,
        status: "invalid",
        reason: "outside_domain",
      },
      {
        lineNumber: 4,
        input: "reserved.myshop.com",
        hostname: "reserved.myshop.com",
        status: "conflict",
      },
    ];

    expect(countBulkDomainResults(results)).toEqual({
      added: 1,
      already_exists: 1,
      invalid: 1,
      conflict: 1,
    });
  });

  it("provides natural labels in Ukrainian and English", () => {
    expect(t("Domains", {}, "uk")).toBe("Домени");
    expect(t("Domains", {}, "en")).toBe("Domains");
    expect(t("Subdomains, one per line", {}, "uk")).toBe("Субдомени, по одному в рядку");
    expect(t("Subdomains, one per line", {}, "en")).toBe("Subdomains, one per line");
    expect(t("Free", {}, "uk")).toBe("Вільна");
    expect(t("Reserved", {}, "uk")).toBe("Зарезервована");
  });
});
