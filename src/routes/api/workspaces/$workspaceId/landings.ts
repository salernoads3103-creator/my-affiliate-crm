import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessErrorResponse,
  accessSuccessResponse,
  hasWorkspacePermission,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { LandingArchiveError, analyzeLandingArchive } from "@/lib/landings/archive";
import { LandingService } from "@/lib/landings/service";
import {
  LandingCreateSchema,
  MAX_LANDING_ARCHIVE_BYTES,
  MAX_LANDING_MULTIPART_BYTES,
} from "@/lib/landings/validation";

const uuidSchema = z.string().uuid();

function parseWorkspaceId(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "Invalid workspace ID", "VALIDATION_ERROR");
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

async function readLandingForm(request: Request): Promise<FormData> {
  const bytes = await readMultipartBody(request);
  try {
    return await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: bytes.slice().buffer,
    }).formData();
  } catch {
    throw new ApiError(400, "Could not read the ZIP upload", "VALIDATION_ERROR");
  }
}

function getCreateFields(formData: FormData): {
  name: string;
  offerId: string;
  archive: File;
} {
  const entries = Array.from(formData.entries());
  if (
    entries.length !== 3 ||
    entries.some(([key]) => !["name", "offerId", "archive"].includes(key))
  ) {
    throw new ApiError(400, "Invalid landing form fields", "VALIDATION_ERROR");
  }

  const name = formData.get("name");
  const offerId = formData.get("offerId");
  const archive = formData.get("archive");
  if (typeof name !== "string" || typeof offerId !== "string" || !(archive instanceof File)) {
    throw new ApiError(400, "Name, offer, and ZIP archive are required", "VALIDATION_ERROR");
  }
  return { name, offerId, archive };
}

export const Route = createFileRoute("/api/workspaces/$workspaceId/landings")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseWorkspaceId(params.workspaceId);
          const context = await requireAccessContext(request);
          const canRead = await hasWorkspacePermission(context, workspaceId, "landing_pages.read");
          const canManage = await hasWorkspacePermission(
            context,
            workspaceId,
            "landing_pages.manage",
          );
          if (!canRead && !canManage) {
            throw new ApiError(403, "Insufficient workspace permissions");
          }

          const search = new URL(request.url).searchParams.get("q") ?? "";
          const data = await new LandingService(context.client).list(workspaceId, search);
          return accessSuccessResponse(data);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseWorkspaceId(params.workspaceId);
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          await requireWorkspacePermission(context, workspaceId, "offers.read");

          const formData = await readLandingForm(request);
          const fields = getCreateFields(formData);
          const parsed = LandingCreateSchema.safeParse({
            name: fields.name,
            offerId: fields.offerId,
          });
          if (!parsed.success) {
            throw new ApiError(400, "Enter a landing name and choose an offer", "VALIDATION_ERROR");
          }
          if (!fields.archive.name.toLowerCase().endsWith(".zip")) {
            throw new ApiError(400, "Choose a ZIP archive", "VALIDATION_ERROR");
          }
          if (fields.archive.size === 0) {
            throw new ApiError(400, "The ZIP archive is empty", "VALIDATION_ERROR");
          }
          if (fields.archive.size > MAX_LANDING_ARCHIVE_BYTES) {
            throw new ApiError(413, "The ZIP archive exceeds the 25 MB limit", "PAYLOAD_TOO_LARGE");
          }

          const archiveBytes = new Uint8Array(await fields.archive.arrayBuffer());
          let analysis;
          try {
            analysis = await analyzeLandingArchive(archiveBytes);
          } catch (error) {
            if (error instanceof LandingArchiveError) {
              throw new ApiError(400, error.message, "VALIDATION_ERROR");
            }
            throw error;
          }

          const data = await new LandingService(context.client).createDraft({
            ...parsed.data,
            workspaceId,
            createdByUserId: context.user.id,
            archive: fields.archive,
            analysis,
          });
          return accessSuccessResponse(data, 201);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
