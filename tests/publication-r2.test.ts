import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import { S3Client, type S3ClientConfig } from "@aws-sdk/client-s3";
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

type MockS3Request = {
  method: string;
  hostname: string;
  path: string;
  protocol: string;
  headers: Record<string, string>;
  body?: unknown;
};

type MockS3Response = {
  statusCode: number;
  headers: Record<string, string>;
  body?: unknown;
};

function mockRequestHandler(
  respond: (request: MockS3Request) => MockS3Response | Promise<MockS3Response>,
): NonNullable<S3ClientConfig["requestHandler"]> {
  return {
    handle: async (request: MockS3Request) => ({ response: await respond(request) }),
    destroy: () => undefined,
    updateHttpClientConfig: () => undefined,
    httpHandlerConfigs: () => ({}),
  } satisfies NonNullable<S3ClientConfig["requestHandler"]>;
}

function createStore(
  respond: (request: MockS3Request) => MockS3Response | Promise<MockS3Response>,
): CloudflareR2Store {
  return new CloudflareR2Store(config, mockRequestHandler(respond));
}

function successResponse(request: MockS3Request): MockS3Response {
  if (request.method === "HEAD" && request.path.endsWith("/index.html")) {
    return {
      statusCode: 200,
      headers: { "content-length": "5", "x-amz-meta-sha256": "abc123" },
    };
  }
  return { statusCode: 200, headers: {} };
}

describe("Cloudflare R2 S3 SDK adapter", () => {
  it("uses signed path-style requests for bucket and object HEAD checks", async () => {
    const requests: MockS3Request[] = [];
    const store = createStore((request) => {
      requests.push(request);
      return successResponse(request);
    });

    await store.checkBucket();
    expect(await store.head("sites/landing-1/version-1/index.html")).toEqual({
      size: 5,
      sha256: "abc123",
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      method: "HEAD",
      hostname: "00000000000000000000000000000000.r2.cloudflarestorage.com",
      path: "/crmonia-publication-test/",
      protocol: "https:",
    });
    expect(requests[1]).toMatchObject({
      method: "HEAD",
      path: "/crmonia-publication-test/sites/landing-1/version-1/index.html",
    });
    for (const request of requests) {
      expect(request.headers.authorization).toMatch(
        /^AWS4-HMAC-SHA256 Credential=test-access-key\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9-;]+, Signature=[a-f0-9]{64}$/,
      );
    }
  });

  it("uploads immutable object bytes and SHA-256 metadata through PutObject", async () => {
    let captured: MockS3Request | null = null;
    const store = createStore((request) => {
      captured = request;
      return { statusCode: 200, headers: { etag: '"etag"' } };
    });

    const bytes = new TextEncoder().encode("hello");
    await store.put(
      "crmonia/landing-sites/ws/host/version/index.html",
      bytes,
      "text/html",
      "a".repeat(64),
    );

    expect(captured).toMatchObject({
      method: "PUT",
      path: "/crmonia-publication-test/crmonia/landing-sites/ws/host/version/index.html",
    });
    expect(captured?.headers["content-type"]).toBe("text/html");
    expect(captured?.headers["x-amz-meta-sha256"]).toBe("a".repeat(64));
    expect(captured?.body).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(captured?.body as Uint8Array)).toBe("hello");
  });

  it("reads a bounded manifest body and returns only decoded text", async () => {
    const manifest = '{"sitePrefix":"crmonia/landing-sites/ws/host/version/"}';
    const body = new TextEncoder().encode(manifest);
    const store = createStore(() => ({
      statusCode: 200,
      headers: { "content-length": String(body.byteLength) },
      body: Readable.from([body]),
    }));

    expect(await store.readText("host-manifests/shop.example.test.json", 4096)).toBe(manifest);
    await expect(store.readText("host-manifests/shop.example.test.json", 4)).rejects.toMatchObject({
      status: 502,
      code: "INTERNAL_ERROR",
    });
  });

  it("maps safe S3 error codes without exposing provider bodies or credentials", async () => {
    const store = createStore(() => ({
      statusCode: 403,
      headers: { "x-amz-request-id": "safe-request-id" },
      body: Readable.from([
        `<Error><Code>SignatureDoesNotMatch</Code><Message>${config.secretAccessKey}</Message></Error>`,
      ]),
    }));

    const result = await store
      .head("sites/landing-1/version-1/index.html")
      .catch((error: unknown) => error);

    expect(result).toBeInstanceOf(ApiError);
    expect((result as ApiError).cause).toMatchObject({
      subsystem: "cloudflare_r2",
      outcome: "http_error",
      method: "HEAD",
      status: 403,
      providerCode: "SignatureDoesNotMatch",
      providerRequestId: "safe-request-id",
    });
    expect((result as Error).message).not.toContain(config.secretAccessKey);
    expect(JSON.stringify((result as ApiError).cause)).not.toContain(config.secretAccessKey);
  });

  it("does not add retries beyond the publication workflow's explicit recovery", async () => {
    let attempts = 0;
    const store = createStore(() => {
      attempts += 1;
      return { statusCode: 503, headers: {}, body: "temporary provider error" };
    });

    await expect(store.checkBucket()).rejects.toBeInstanceOf(ApiError);
    expect(attempts).toBe(1);
  });

  it("rejects unsafe object keys before sending a request", async () => {
    let attempts = 0;
    const store = createStore(() => {
      attempts += 1;
      return { statusCode: 200, headers: {} };
    });

    await expect(store.head("sites/../private.txt")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(attempts).toBe(0);
  });
});

describe("R2 diagnostic health checks", () => {
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

  it("distinguishes bucket-level denial from successful object read", async () => {
    expect(
      await runR2ReadOnlyHealthcheck(
        async () => {
          throw new ApiError(502, "R2 request failed", "INTERNAL_ERROR", {
            subsystem: "cloudflare_r2",
            outcome: "http_error",
            method: "HEAD",
            objectKind: "bucket",
            status: 403,
            providerCode: "AccessDenied",
            providerRequestId: "cf-ray-safe-id",
            credential: config.secretAccessKey,
          });
        },
        async () => ({ size: 5, sha256: null }),
      ),
    ).toEqual({
      bucket: {
        status: "provider_rejected",
        providerStatus: 403,
        providerCode: "AccessDenied",
        requestId: "cf-ray-safe-id",
      },
      testObject: { status: "connected" },
    });
  });

  it("reports signature rejection separately from insufficient permissions", async () => {
    const signatureError = async () => {
      throw new ApiError(502, "R2 request failed", "INTERNAL_ERROR", {
        subsystem: "cloudflare_r2",
        outcome: "http_error",
        method: "HEAD",
        objectKind: "other",
        status: 403,
        providerCode: "SignatureDoesNotMatch",
      });
    };

    expect(await runR2ReadOnlyHealthcheck(signatureError, signatureError)).toEqual({
      bucket: {
        status: "provider_rejected",
        providerStatus: 403,
        providerCode: "SignatureDoesNotMatch",
      },
      testObject: {
        status: "provider_rejected",
        providerStatus: 403,
        providerCode: "SignatureDoesNotMatch",
      },
    });
  });

  it("reports missing diagnostic objects without exposing file data", async () => {
    expect(
      await runR2ReadOnlyHealthcheck(
        async () => undefined,
        async () => null,
      ),
    ).toEqual({ bucket: { status: "connected" }, testObject: { status: "not_found" } });
  });
});
