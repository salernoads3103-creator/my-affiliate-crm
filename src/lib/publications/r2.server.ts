import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
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

const REQUEST_TIMEOUT_MS = 120_000;
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
      { subsystem: "cloudflare_r2", outcome: "configuration_error" },
    );
  }
  return config;
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

function objectKind(key: string): "bucket" | "host_manifest" | "published_site_file" | "other" {
  if (!key) return "bucket";
  if (key.startsWith("host-manifests/")) return "host_manifest";
  if (key.startsWith("crmonia/landing-sites/")) return "published_site_file";
  return "other";
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : null;
}

function getProviderCode(error: unknown): string | undefined {
  const record = asRecord(error);
  const genericNames = new Set([
    "Error",
    "TypeError",
    "AbortError",
    "TimeoutError",
    "S3ServiceException",
  ]);
  for (const candidate of [record?.Code, record?.code, record?.name]) {
    if (
      typeof candidate === "string" &&
      /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(candidate) &&
      !genericNames.has(candidate)
    ) {
      return candidate;
    }
  }
  return undefined;
}

function getProviderStatus(error: unknown): number | undefined {
  const metadata = asRecord(asRecord(error)?.$metadata);
  const status = metadata?.httpStatusCode;
  return typeof status === "number" && Number.isInteger(status) ? status : undefined;
}

function getProviderRequestId(error: unknown): string | undefined {
  const metadata = asRecord(asRecord(error)?.$metadata);
  const requestId = metadata?.requestId;
  return typeof requestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)
    ? requestId
    : undefined;
}

function isMissingObject(error: unknown): boolean {
  const code = getProviderCode(error);
  if (code === "NoSuchBucket") return false;
  return getProviderStatus(error) === 404 || code === "NoSuchKey" || code === "NotFound";
}

export class CloudflareR2Store implements LandingR2Store {
  private readonly config: R2S3Config;
  private readonly client: S3Client;

  constructor(config: R2S3Config = envConfig(), requestHandler?: S3ClientConfig["requestHandler"]) {
    this.config = config;
    this.client = new S3Client({
      region: AWS_REGION,
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      maxAttempts: 1,
      requestChecksumCalculation: "WHEN_REQUIRED",
      ...(requestHandler ? { requestHandler } : {}),
    });
  }

  async put(key: string, bytes: Uint8Array, contentType: string, digest: string): Promise<void> {
    assertObjectKey(key);
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.config.bucketName,
          Key: key,
          Body: bytes.slice(),
          ContentLength: bytes.byteLength,
          ContentType: contentType,
          Metadata: { sha256: digest },
        }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (error) {
      throw this.toApiError(error, "PUT", key);
    }
  }

  async head(key: string): Promise<R2ObjectHead | null> {
    assertObjectKey(key);
    let result;
    try {
      result = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.bucketName, Key: key }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw this.toApiError(error, "HEAD", key);
    }

    const size = result.ContentLength;
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
      throw new ApiError(
        502,
        "Could not verify a landing file in object storage",
        "INTERNAL_ERROR",
      );
    }
    return { size, sha256: result.Metadata?.sha256 ?? null };
  }

  async checkBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.config.bucketName }), {
        abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw this.toApiError(error, "HEAD", "");
    }
  }

  async readText(key: string, maxBytes: number): Promise<string | null> {
    assertObjectKey(key);
    let result;
    try {
      result = await this.client.send(
        new GetObjectCommand({ Bucket: this.config.bucketName, Key: key }),
        { abortSignal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw this.toApiError(error, "GET", key);
    }

    const declaredLength = result.ContentLength;
    if (
      typeof declaredLength !== "number" ||
      !Number.isSafeInteger(declaredLength) ||
      declaredLength < 0 ||
      declaredLength > maxBytes
    ) {
      throw new ApiError(502, "Invalid landing manifest in object storage", "INTERNAL_ERROR");
    }

    let bytes: Uint8Array;
    try {
      bytes = result.Body ? await result.Body.transformToByteArray() : new Uint8Array();
    } catch (error) {
      throw this.toApiError(error, "GET", key);
    }
    if (bytes.byteLength > maxBytes) {
      throw new ApiError(502, "Invalid landing manifest in object storage", "INTERNAL_ERROR");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  private toApiError(error: unknown, method: "GET" | "HEAD" | "PUT", key: string): ApiError {
    if (error instanceof ApiError) return error;

    const name = error instanceof Error ? error.name : "UnknownError";
    const safeName = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "UnknownError";
    const status = getProviderStatus(error);
    const providerCode = getProviderCode(error);
    return new ApiError(
      502,
      "Cloudflare R2 could not complete the landing storage operation",
      "INTERNAL_ERROR",
      {
        subsystem: "cloudflare_r2",
        outcome:
          status !== undefined
            ? "http_error"
            : safeName === "TimeoutError" || safeName === "AbortError"
              ? "timeout"
              : "network_error",
        method,
        objectKind: objectKind(key),
        errorName: safeName,
        ...(status !== undefined ? { status } : {}),
        ...(providerCode ? { providerCode } : {}),
        ...(getProviderRequestId(error) ? { providerRequestId: getProviderRequestId(error) } : {}),
      },
    );
  }
}

export async function sha256Object(bytes: Uint8Array): Promise<string> {
  return sha256Hex(bytes);
}
