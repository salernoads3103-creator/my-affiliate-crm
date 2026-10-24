import { z } from "zod";
import { ApiError } from "@/lib/api-error";
import { LandingArchiveError, analyzeLandingArchive } from "./archive";
import {
  LandingCreateSchema,
  MAX_LANDING_ARCHIVE_BYTES,
  MAX_LANDING_MULTIPART_BYTES,
} from "./validation";
import type { LandingArchiveAnalysis } from "./types";

const uuidSchema = z.string().uuid();

export function parseLandingRouteId(
  value: string,
  label: "workspace" | "landing" | "tracking profile",
): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(400, `Invalid ${label} ID`, "VALIDATION_ERROR");
  }
  return parsed.data;
}

async function readMultipartBody(request: Request): Promise<Uint8Array> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new ApiError(400, "Expected a multipart ZIP upload", "VALIDATION_ERROR");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new ApiError(400, "Invalid upload length", "VALIDATION_ERROR");
    }
    if (Number(declaredLength) > MAX_LANDING_MULTIPART_BYTES) {
      throw new ApiError(413, "The ZIP archive exceeds the 25 MB limit", "PAYLOAD_TOO_LARGE");
    }
  }

  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, "The upload is empty", "VALIDATION_ERROR");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      byteLength += result.value.byteLength;
      if (byteLength > MAX_LANDING_MULTIPART_BYTES) {
        await reader.cancel();
        throw new ApiError(413, "The ZIP archive exceeds the 25 MB limit", "PAYLOAD_TOO_LARGE");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function readLandingForm(request: Request): Promise<FormData> {
  const bytes = await readMultipartBody(request);
  try {
    return await new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bytes.slice().buffer,
    }).formData();
  } catch {
    throw new ApiError(400, "Could not read the ZIP upload", "VALIDATION_ERROR");
  }
}

export type LandingUploadFields = {
  name: string;
  offerId: string;
  archive?: File;
};

function getLandingFields(formData: FormData, allowOptionalArchive: boolean): LandingUploadFields {
  const entries = Array.from(formData.entries());
  const minimumEntries = allowOptionalArchive ? 2 : 3;
  if (
    entries.length < minimumEntries ||
    entries.length > 3 ||
    entries.some(([key]) => !["name", "offerId", "archive"].includes(key)) ||
    new Set(entries.map(([key]) => key)).size !== entries.length
  ) {
    throw new ApiError(400, "Invalid landing form fields", "VALIDATION_ERROR");
  }

  const name = formData.get("name");
  const offerId = formData.get("offerId");
  const archive = formData.get("archive");
  if (
    typeof name !== "string" ||
    typeof offerId !== "string" ||
    (archive !== null && !(archive instanceof File)) ||
    (!allowOptionalArchive && !(archive instanceof File))
  ) {
    throw new ApiError(
      400,
      allowOptionalArchive
        ? "Name and offer are required"
        : "Name, offer, and ZIP archive are required",
      "VALIDATION_ERROR",
    );
  }

  const parsed = LandingCreateSchema.safeParse({ name, offerId });
  if (!parsed.success) {
    throw new ApiError(400, "Enter a landing name and choose an offer", "VALIDATION_ERROR");
  }
  return { ...parsed.data, ...(archive instanceof File ? { archive } : {}) };
}

export function parseLandingCreateForm(
  formData: FormData,
): LandingUploadFields & { archive: File } {
  const fields = getLandingFields(formData, false);
  if (!fields.archive) {
    throw new ApiError(400, "Name, offer, and ZIP archive are required", "VALIDATION_ERROR");
  }
  return { ...fields, archive: fields.archive };
}

export function parseLandingUpdateForm(formData: FormData): LandingUploadFields {
  return getLandingFields(formData, true);
}

export async function analyzeUploadedLandingArchive(file: File): Promise<LandingArchiveAnalysis> {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    throw new ApiError(400, "Choose a ZIP archive", "VALIDATION_ERROR");
  }
  if (file.size === 0) throw new ApiError(400, "The ZIP archive is empty", "VALIDATION_ERROR");
  if (file.size > MAX_LANDING_ARCHIVE_BYTES) {
    throw new ApiError(413, "The ZIP archive exceeds the 25 MB limit", "PAYLOAD_TOO_LARGE");
  }

  try {
    return await analyzeLandingArchive(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof LandingArchiveError) {
      throw new ApiError(400, error.message, "VALIDATION_ERROR");
    }
    throw error;
  }
}
