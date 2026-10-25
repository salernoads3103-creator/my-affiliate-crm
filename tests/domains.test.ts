import { describe, expect, it } from "bun:test";
import { requireWorkspacePermission, type AccessContext } from "../src/lib/access/access.server";
import { ApiError } from "../src/lib/api-error";
import {
  parseBulkDomainHostnames,
  normalizeDomainName,
  normalizePublicHostname,
} from "../src/lib/domains/validation";
import { probeDomainHttps } from "../src/lib/domains/verification.server";
import { reserveHostWithVerification, type ReservableHost } from "../src/lib/domains/workflow";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const otherWorkspaceId = "22222222-2222-4222-8222-222222222222";
const hostId = "33333333-3333-4333-8333-333333333333";
const landingIdA = "44444444-4444-4444-8444-444444444444";
const landingIdB = "55555555-5555-4555-8555-555555555555";

function reservableHost(overrides: Partial<ReservableHost> = {}): ReservableHost {
  return {
    id: hostId,
    workspaceId,
    hostname: "britva.myshop.com",
    status: "available",
    reservedLandingId: null,
    ...overrides,
  };
}

describe("workspace domains API rules", () => {
  it("normalizes public domain names and rejects URLs, local names, and IP addresses", () => {
    expect(normalizeDomainName("MyShop.COM.")).toBe("myshop.com");
    expect(normalizeDomainName("магазин.com")).toMatch(/^xn--/);
    for (const value of [
      "https://myshop.com",
      "myshop.com/path",
      "myshop.com:443",
      "localhost",
      "api.internal",
      "192.168.1.1",
      "127.1",
      "myshop.test",
    ]) {
      expect(normalizeDomainName(value)).toBeNull();
    }
    expect(normalizePublicHostname("myshop.com")).toBe("myshop.com");
  });

  it("accepts short and full subdomains only under the selected root", () => {
    expect(parseBulkDomainHostnames("britva\nshop.myshop.com", "myshop.com")).toEqual([
      {
        lineNumber: 1,
        input: "britva",
        hostname: "britva.myshop.com",
        error: null,
      },
      {
        lineNumber: 2,
        input: "shop.myshop.com",
        hostname: "shop.myshop.com",
        error: null,
      },
    ]);
    expect(parseBulkDomainHostnames("магазин\n", "myshop.com")[0]?.hostname).toMatch(
      /^xn--.*\.myshop\.com$/,
    );
  });

  it("reports invalid rows and valid hostnames outside the selected root separately", () => {
    expect(parseBulkDomainHostnames("not a host\nshop.other.com", "myshop.com")).toEqual([
      {
        lineNumber: 1,
        input: "not a host",
        hostname: null,
        error: "invalid",
      },
      {
        lineNumber: 2,
        input: "shop.other.com",
        hostname: null,
        error: "outside_domain",
      },
    ]);
  });

  it("caps bulk input and preserves duplicate rows for atomic database outcomes", () => {
    expect(() =>
      parseBulkDomainHostnames(Array.from({ length: 501 }, () => "shop").join("\n"), "myshop.com"),
    ).toThrow("at most 500 hostnames");
    const duplicateRows = parseBulkDomainHostnames("shop\nshop.myshop.com", "myshop.com");
    expect(duplicateRows.map((row) => row.hostname)).toEqual([
      "shop.myshop.com",
      "shop.myshop.com",
    ]);
  });

  it("requires the existing workspace permission before domain operations", async () => {
    const deniedContext = {
      client: { rpc: async () => ({ data: false, error: null }) },
    } as unknown as AccessContext;
    await expect(
      requireWorkspacePermission(deniedContext, workspaceId, "landing_pages.manage"),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("confirms a real HTTPS response without following redirects or reading its body", async () => {
    let requestedUrl = "";
    let requestedMethod = "";
    let redirectMode = "";
    let credentials = "";
    const result = await probeDomainHttps("shop.myshop.com", async (url, init) => {
      requestedUrl = url;
      requestedMethod = init.method ?? "";
      redirectMode = init.redirect ?? "";
      credentials = init.credentials ?? "";
      return new Response(null, { status: 404 });
    });
    expect(result).toEqual({ ready: true, errorCode: null });
    expect(requestedUrl).toBe("https://shop.myshop.com/");
    expect(requestedMethod).toBe("HEAD");
    expect(redirectMode).toBe("manual");
    expect(credentials).toBe("omit");
  });

  it("does not probe invalid hostnames and records network and timeout failures as not ready", async () => {
    let calls = 0;
    const invalid = await probeDomainHttps("127.0.0.1", async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    });
    const unavailable = await probeDomainHttps("shop.myshop.com", async () => {
      calls += 1;
      throw new Error("network unavailable");
    });
    const timedOut = await probeDomainHttps(
      "slow.myshop.com",
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          });
        }),
      1,
    );
    expect(calls).toBe(1);
    expect(invalid.ready).toBe(false);
    expect(unavailable).toEqual({ ready: false, errorCode: "DNS_OR_HTTPS_UNAVAILABLE" });
    expect(timedOut).toEqual({ ready: false, errorCode: "TIMEOUT" });
  });

  it("does not reserve a hostname from another workspace", async () => {
    let reserveCalls = 0;
    await expect(
      reserveHostWithVerification(
        { workspaceId, hostId, landingId: landingIdA },
        {
          getHost: async () => reservableHost({ workspaceId: otherWorkspaceId }),
          verify: async () => ({ ready: true, errorCode: null }),
          reserve: async () => {
            reserveCalls += 1;
          },
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(reserveCalls).toBe(0);
  });

  it("rechecks readiness at reservation time and refuses a failed HTTPS probe", async () => {
    let reserveCalls = 0;
    let verifyCalls = 0;
    await expect(
      reserveHostWithVerification(
        { workspaceId, hostId, landingId: landingIdA },
        {
          getHost: async () => reservableHost(),
          verify: async () => {
            verifyCalls += 1;
            return { ready: false, errorCode: "DNS_OR_HTTPS_UNAVAILABLE" };
          },
          reserve: async () => {
            reserveCalls += 1;
          },
        },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(verifyCalls).toBe(1);
    expect(reserveCalls).toBe(0);
  });

  it("makes competing reservations atomic and keeps retries idempotent", async () => {
    let assignedLandingId: string | null = null;
    const dependencies = {
      getHost: async () => reservableHost(),
      verify: async () => ({ ready: true as const, errorCode: null }),
      reserve: async (_workspace: string, _host: string, landing: string) => {
        if (assignedLandingId && assignedLandingId !== landing) {
          throw new ApiError(409, "already reserved", "CONFLICT");
        }
        assignedLandingId = landing;
      },
    };

    const results = await Promise.allSettled([
      reserveHostWithVerification({ workspaceId, hostId, landingId: landingIdA }, dependencies),
      reserveHostWithVerification({ workspaceId, hostId, landingId: landingIdB }, dependencies),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);

    const retry = await reserveHostWithVerification(
      { workspaceId, hostId, landingId: assignedLandingId as string },
      {
        ...dependencies,
        getHost: async () =>
          reservableHost({ status: "reserved", reservedLandingId: assignedLandingId }),
        verify: async () => {
          throw new Error("an idempotent retry must not probe again");
        },
      },
    );
    expect(retry).toEqual({ reserved: true, alreadyReserved: true });
  });
});
