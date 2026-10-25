import { describe, expect, it } from "bun:test";
import { ApiError } from "../src/lib/api-error";
import { CloudflareR2Store } from "../src/lib/publications/r2.server";

const config = {
  accountId: "00000000000000000000000000000000",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-value-12345678901234567890",
  bucketName: "crmonia-publication-test",
};

describe("Cloudflare R2 S3 client", () => {
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
  });
});
