import { ApiError } from "@/lib/api-error";
import { sha256Hex } from "@/lib/landings/fingerprint";

export type R2ObjectHead = { size: number; sha256: string | null };

export interface LandingR2Store {
  put(key: string, bytes: Uint8Array, contentType: string, sha256: string): Promise<void>;
  head(key: string): Promise<R2ObjectHead | null>;
  readText(key: string, maxBytes: number): Promise<string | null>;
}

export type R2S3Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
};

type SignedRequest = {
  method: "GET" | "HEAD" | "PUT";
  key: string;
  bytes?: Uint8Array;
  contentType?: string;
  sha256?: string;
};

const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const AWS_REGION = "auto";
const AWS_SERVICE = "s3";

function envConfig(): R2S3Config {
  const config = {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID?.trim() ?? "",
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim() ?? "",
    bucketName: process.env.CLOUDFLARE_R2_BUCKET_NAME?.trim() ?? "",
  };
  if (
    !/^[a-f0-9]{32}$/i.test(config.accountId) ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(config.accessKeyId) ||
    config.secretAccessKey.length < 32 ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(config.bucketName)
  ) {
    throw new ApiError(
      500,
      "Cloudflare R2 publication storage is not configured correctly",
      "INTERNAL_ERROR",
    );
  }
  return config;
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function assertObjectKey(key: string): void {
  if (
    !key ||
    key.startsWith("/") ||
    key.includes("\\") ||
    key.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ApiError(400, "Invalid landing storage path", "VALIDATION_ERROR");
  }
}

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function hmac(key: Uint8Array, value: string): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    key.slice().buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await globalThis.crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(value)),
  );
}

function amzDate(date: Date): { timestamp: string; shortDate: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return { timestamp: iso, shortDate: iso.slice(0, 8) };
}

export class CloudflareR2Store implements LandingR2Store {
  private readonly config: R2S3Config;

  constructor(
    config: R2S3Config = envConfig(),
    private readonly fetcher: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.config = config;
  }

  async put(key: string, bytes: Uint8Array, contentType: string, digest: string): Promise<void> {
    this.assertSuccess(
      await this.request({ method: "PUT", key, bytes, contentType, sha256: digest }),
    );
  }

  async head(key: string): Promise<R2ObjectHead | null> {
    const response = await this.request({ method: "HEAD", key });
    if (response.status === 404) return null;
    this.assertSuccess(response);
    const rawSize = response.headers.get("content-length");
    const size = rawSize === null ? Number.NaN : Number(rawSize);
    if (!Number.isSafeInteger(size) || size < 0) {
      throw new ApiError(
        502,
        "Could not verify a landing file in object storage",
        "INTERNAL_ERROR",
      );
    }
    return { size, sha256: response.headers.get("x-amz-meta-sha256") };
  }

  async readText(key: string, maxBytes: number): Promise<string | null> {
    const response = await this.request({ method: "GET", key });
    if (response.status === 404) return null;
    this.assertSuccess(response);
    const declaredLength = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > maxBytes) {
      throw new ApiError(502, "Invalid landing manifest in object storage", "INTERNAL_ERROR");
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new ApiError(502, "Invalid landing manifest in object storage", "INTERNAL_ERROR");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  private async request(input: SignedRequest): Promise<Response> {
    assertObjectKey(input.key);
    const { accountId, accessKeyId, secretAccessKey, bucketName } = this.config;
    const encodedPath = [bucketName, ...input.key.split("/")].map(awsEncode).join("/");
    const url = new URL(`https://${accountId}.r2.cloudflarestorage.com/${encodedPath}`);
    const bodyHash = input.sha256 ?? (input.bytes ? await sha256Hex(input.bytes) : EMPTY_SHA256);
    const { timestamp, shortDate } = amzDate(this.clock());
    const headers = new Headers({
      "x-amz-content-sha256": bodyHash,
      "x-amz-date": timestamp,
    });
    if (input.contentType) headers.set("content-type", input.contentType);
    if (input.sha256) headers.set("x-amz-meta-sha256", input.sha256);

    const signedHeaderNames = [
      "host",
      ...Array.from(headers.keys()).map((name) => name.toLowerCase()),
    ]
      .sort()
      .join(";");
    const canonicalHeaders = [
      ["host", url.host] as const,
      ...Array.from(headers.entries()).map(
        ([name, value]) => [name.toLowerCase(), value.trim().replace(/\s+/g, " ")] as const,
      ),
    ]
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([name, value]) => `${name}:${value}`)
      .join("\n");
    const canonicalRequest = [
      input.method,
      url.pathname,
      "",
      canonicalHeaders,
      signedHeaderNames,
      bodyHash,
    ].join("\n");
    const scope = `${shortDate}/${AWS_REGION}/${AWS_SERVICE}/aws4_request`;
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      timestamp,
      scope,
      await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    ].join("\n");
    const dateKey = await hmac(new TextEncoder().encode(`AWS4${secretAccessKey}`), shortDate);
    const regionKey = await hmac(dateKey, AWS_REGION);
    const serviceKey = await hmac(regionKey, AWS_SERVICE);
    const signingKey = await hmac(serviceKey, "aws4_request");
    const signature = toHex(
      await globalThis.crypto.subtle.sign(
        "HMAC",
        await globalThis.crypto.subtle.importKey(
          "raw",
          signingKey.slice().buffer,
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"],
        ),
        new TextEncoder().encode(stringToSign),
      ),
    );
    headers.set(
      "authorization",
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaderNames}, Signature=${signature}`,
    );

    try {
      return await this.fetcher(url, {
        method: input.method,
        headers,
        ...(input.bytes ? { body: input.bytes.slice().buffer } : {}),
        signal: AbortSignal.timeout(120_000),
      });
    } catch {
      throw new ApiError(502, "Cloudflare R2 could not be reached", "INTERNAL_ERROR");
    }
  }

  private assertSuccess(response: Response): void {
    if (!response.ok) {
      throw new ApiError(
        502,
        "Cloudflare R2 could not complete the landing storage operation",
        "INTERNAL_ERROR",
        { status: response.status },
      );
    }
  }
}

export async function sha256Object(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}
