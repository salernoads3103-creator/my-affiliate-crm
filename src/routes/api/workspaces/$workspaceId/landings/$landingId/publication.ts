import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessErrorResponse,
  accessSuccessResponse,
  hasWorkspacePermission,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { DomainService } from "@/lib/domains/service.server";
import { LandingService } from "@/lib/landings/service";
import { parseLandingRouteId } from "@/lib/landings/http.server";
import { CloudflareR2Store } from "@/lib/publications/r2.server";
import { SupabasePublicationRepository } from "@/lib/publications/repository.server";
import { publishLanding, resumeLandingPublication } from "@/lib/publications/service";

const publishSchema = z.object({ hostId: z.string().uuid() }).strict();

function idempotencyHash(request: Request): string {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new ApiError(400, "A valid Idempotency-Key header is required", "VALIDATION_ERROR");
  }
  // Hash the caller-provided key before persistence; it is never logged or returned.
  return key;
}

async function hashIdempotencyKey(key: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function ensureLandingAccess(
  context: Awaited<ReturnType<typeof requireAccessContext>>,
  workspaceId: string,
  landingId: string,
): Promise<void> {
  const { data, error } = await context.client
    .from("workspace_landings")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", landingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");
}

export const Route = createFileRoute(
  "/api/workspaces/$workspaceId/landings/$landingId/publication",
)({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
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
          await ensureLandingAccess(context, workspaceId, landingId);
          const versions = await new SupabasePublicationRepository().listHistory(
            workspaceId,
            landingId,
          );
          return accessSuccessResponse({ versions });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          await ensureLandingAccess(context, workspaceId, landingId);
          const parsed = publishSchema.safeParse(await readJsonBody(request));
          if (!parsed.success) {
            throw new ApiError(400, "Choose a valid domain address", "VALIDATION_ERROR");
          }
          const repository = new SupabasePublicationRepository();
          const host = await repository.getHostTarget(workspaceId, parsed.data.hostId, landingId);
          const requestKeyHash = await hashIdempotencyKey(idempotencyHash(request));
          const existing = await repository.findOperation(
            workspaceId,
            parsed.data.hostId,
            requestKeyHash,
          );
          if (
            existing &&
            (existing.landingId !== landingId || existing.operationKind !== "publish")
          ) {
            throw new ApiError(
              409,
              "This idempotency key belongs to another operation",
              "CONFLICT",
            );
          }
          if (existing?.status === "failed") {
            throw new ApiError(
              409,
              "This publication attempt failed; start a new attempt",
              "CONFLICT",
            );
          }
          const service = new LandingService(context.client);
          const input = {
            workspaceId,
            hostId: parsed.data.hostId,
            landingId,
            hostname: host.hostname,
            idempotencyKeyHash: requestKeyHash,
            createdByUserId: context.user.id,
          };
          const dependencies = {
            repository,
            storage: new CloudflareR2Store(),
            verifyHost: async () => {
              const verification = await new DomainService().verifyHost(
                workspaceId,
                parsed.data.hostId,
              );
              return verification.technicalStatus === "ready";
            },
          };
          const result =
            existing &&
            ["database_switched", "recovery_required", "completed"].includes(existing.status)
              ? await resumeLandingPublication(dependencies, input, existing)
              : await publishLanding(
                  {
                    ...dependencies,
                    getPreparedArchive: () =>
                      service.getPreparedArchiveForPublication(workspaceId, landingId),
                  },
                  input,
                );
          return accessSuccessResponse(result, result.replayed ? 200 : 201);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
