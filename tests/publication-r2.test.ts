import { describe, expect, it } from "bun:test";
import { ApiError } from "../src/lib/api-error";
import {
  isR2DiagnosticEndpointEnabled,
  runR2ReadOnlyHealthcheck,
} from "../src/lib/publications/health.server";
import { CloudflareR2Store } from "../src/lib/publications/r2.server";

const config = {
  accountId: "00000000000000000000000000000000",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-value-12345678901234567890",
  bucketName: "crmonia-publication-test",
};

describe("Cloudflare R2 S3 client", () => {
  it("signs a read-only HeadBucket request without reading objects", async () => {
    let capturedUrl: URL | null = null;
    let capturedMethod: string | undefined;
    let capturedHeaders: Headers | null = null;
    const store = new CloudflareR2Store(
      config,
      async (input, init) => {
        capturedUrl = new URL(input.toString());
        capturedMethod = init?.method;
        capturedHeaders = new Headers(init?.headers);
        return new Response(null, { status: 200 });
      },
      () => new Date("2026-10-25T12:00:00.000Z"),
    );

    await store.checkBucket();

    expect(capturedMethod).toBe("HEAD");
    expect(capturedUrl?.pathname).toBe("/crmonia-publication-test");
    expect(capturedHeaders?.get("x-amz-content-sha256")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(capturedHeaders?.get("authorization")).toMatch(
      /^AWS4-HMAC-SHA256 Credential=test-access-key\/20261025\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/,
    );
  });

  it("signs PUT requests with the canonical AWS request format", async () => {
    let capturedUrl: URL | null = null;
    let capturedInit: RequestInit | null = null;
    const store = new CloudflareR2Store(
      config,
      async (input, init) => {
        capturedUrl = new URL(input.toString());
        capturedInit = init ?? null;
        return new Response(null, { status: 200 });
      },
      () => new Date("2026-10-25T12:00:00.000Z"),
    );

    await store.put(
      "sites/one/index.html",
      new TextEncoder().encode("hello"),
      "text/html",
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );

    expect(capturedUrl?.hostname).toBe("00000000000000000000000000000000.r2.cloudflarestorage.com");
    expect(capturedUrl?.pathname).toBe("/crmonia-publication-test/sites/one/index.html");
    const capturedHeaders = new Headers(capturedInit?.headers);
    expect(capturedHeaders.get("authorization")).toBe(
      "AWS4-HMAC-SHA256 Credential=test-access-key/20261025/auto/s3/aws4_request, " +
        "SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date;x-amz-meta-sha256, " +
        "Signature=a90785e8ac818be7739295db69f52c445c30571ab3fc817f57db88e7e0fe784a",
    );
    expect(new TextDecoder().decode(capturedInit?.body as ArrayBuffer)).toBe("hello");
  });

  it("does not expose credential values in provider errors", async () => {
    const store = new CloudflareR2Store(
      config,
      async () => new Response(config.secretAccessKey, { status: 403 }),
    );

    const result = await store
      .put("sites/one/index.html", new TextEncoder().encode("hello"), "text/html", "0".repeat(64))
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(ApiError);
    expect((result as Error).message).not.toContain(config.secretAccessKey);
    expect((result as ApiError).cause).toMatchObject({
      subsystem: "cloudflare_r2",
      outcome: "http_error",
      method: "PUT",
      objectKind: "other",
      status: 403,
    });
    expect(JSON.stringify((result as ApiError).cause)).not.toContain(config.secretAccessKey);
  });

  it("classifies network failures without preserving raw exception text", async () => {
    const store = new CloudflareR2Store(config, async () => {
      throw new Error(`network failed with ${config.secretAccessKey}`);
    });

    const result = await store
      .head("crmonia/landing-sites/one/index.html")
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(ApiError);
    expect((result as ApiError).cause).toMatchObject({
      subsystem: "cloudflare_r2",
      outcome: "network_error",
      method: "HEAD",
      objectKind: "published_site_file",
      errorName: "Error",
    });
    expect(JSON.stringify((result as ApiError).cause)).not.toContain(config.secretAccessKey);
  });

  it("fails closed unless the exact DEV Render service and explicit opt-in match", () => {
    const developmentEnvironment = {
      RENDER: "true",
      RENDER_SERVICE_NAME: "crmonia-intake-api-test",
      RENDER_GIT_BRANCH: "develop",
      CRMONIA_R2_DIAGNOSTICS_ENABLED: "true",
    };

    expect(isR2DiagnosticEndpointEnabled(developmentEnvironment)).toBe(true);
    expect(
      isR2DiagnosticEndpointEnabled({
        ...developmentEnvironment,
        RENDER_SERVICE_NAME: "crmonia-production",
      }),
    ).toBe(false);
    expect(
      isR2DiagnosticEndpointEnabled({ ...developmentEnvironment, RENDER_GIT_BRANCH: "main" }),
    ).toBe(false);
    expect(
      isR2DiagnosticEndpointEnabled({
        ...developmentEnvironment,
        CRMONIA_R2_DIAGNOSTICS_ENABLED: "false",
      }),
    ).toBe(false);
  });

  it("returns safe R2 diagnostic categories without exposing credentials or object content", async () => {
    expect(await runR2ReadOnlyHealthcheck(async () => undefined)).toEqual({ status: "connected" });
    expect(
      await runR2ReadOnlyHealthcheck(async () => {
        throw new ApiError(502, "R2 request failed", "INTERNAL_ERROR", {
          subsystem: "cloudflare_r2",
          outcome: "http_error",
          method: "HEAD",
          objectKind: "bucket",
          status: 403,
          providerRequestId: "cf-ray-safe-id",
          credential: config.secretAccessKey,
        });
      }),
    ).toEqual({
      status: "provider_rejected",
      providerStatus: 403,
      requestId: "cf-ray-safe-id",
    });
    expect(
      await runR2ReadOnlyHealthcheck(async () => {
        throw new ApiError(500, "R2 config invalid", "INTERNAL_ERROR", {
          subsystem: "cloudflare_r2",
          outcome: "configuration_error",
        });
      }),
    ).toEqual({ status: "configuration_error" });
    expect(
      await runR2ReadOnlyHealthcheck(async () => {
        throw new ApiError(502, "R2 unavailable", "INTERNAL_ERROR", {
          subsystem: "cloudflare_r2",
          outcome: "timeout",
        });
      }),
    ).toEqual({ status: "unreachable" });
  });
});
