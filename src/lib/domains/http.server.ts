import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import {
  BulkDomainHostsRequestSchema,
  CreateDomainRequestSchema,
  DomainHostReservationRequestSchema,
  DomainRouteIdSchema,
} from "./validation";

const MAX_DOMAIN_REQUEST_BYTES = 200_000;

export function parseDomainRouteId(value: string, label: "workspace" | "domain" | "host") {
  const result = DomainRouteIdSchema.safeParse(value);
  if (!result.success) throw new ApiError(400, `Invalid ${label} ID`, "VALIDATION_ERROR");
  return result.data;
}

export async function readDomainJsonBody(request: Request): Promise<Record<string, unknown>> {
  const mediaType = (request.headers.get("content-type") ?? "").split(";", 1)[0]?.trim();
  if (mediaType?.toLowerCase() !== "application/json") {
    throw new ApiError(400, "Expected a JSON request body", "VALIDATION_ERROR");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new ApiError(400, "Invalid request length", "VALIDATION_ERROR");
    }
    if (Number(declaredLength) > MAX_DOMAIN_REQUEST_BYTES) {
      throw new ApiError(413, "Request body is too large", "PAYLOAD_TOO_LARGE");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "Invalid JSON request body", "VALIDATION_ERROR");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOMAIN_REQUEST_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "Request body is too large", "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "Invalid JSON request body", "VALIDATION_ERROR");
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "Invalid JSON request body", "VALIDATION_ERROR");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "Expected a JSON object", "VALIDATION_ERROR");
  }
  return value as Record<string, unknown>;
}

export function parseCreateDomainBody(value: unknown): string {
  const parsed = CreateDomainRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "Enter a valid domain name", "VALIDATION_ERROR");
  }
  return parsed.data.domainName;
}

export function parseBulkDomainHostsBody(value: unknown): string {
  const parsed = BulkDomainHostsRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "Enter a list of up to 500 hostnames", "VALIDATION_ERROR");
  }
  if (parsed.data.hostnames.split(/\r?\n/).filter((line) => line.trim()).length > 500) {
    throw new ApiError(400, "A batch can contain at most 500 lines", "VALIDATION_ERROR");
  }
  return parsed.data.hostnames;
}

export function parseDomainReservationBody(value: unknown): string {
  const parsed = DomainHostReservationRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, "A valid landing ID is required", "VALIDATION_ERROR");
  }
  return parsed.data.landingId;
}

export function parseDomainReservationQuery(value: string | null): string {
  const result = z.string().uuid().safeParse(value);
  if (!result.success) {
    throw new ApiError(400, "A valid landingId query parameter is required", "VALIDATION_ERROR");
  }
  return result.data;
}
