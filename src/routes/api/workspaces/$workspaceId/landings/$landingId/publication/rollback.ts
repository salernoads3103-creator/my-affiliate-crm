import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { parseLandingRouteId } from "@/lib/landings/http.server";
import { CloudflareR2Store } from "@/lib/publications/r2.server";
import { SupabasePublicationRepository } from "@/lib/publications/repository.server";
import { rollbackLandingPublication } from "@/lib/publications/service";

const rollbackSchema = z
  .object({ hostId: z.string().uuid(), targetVersionId: z.string().uuid() })
  .strict();

async function hashIdempotencyKey(request: Request): Promise<string> {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{16,128}$/.test(key)) {
    throw new ApiError(400, "A valid Idempotency-Key header is required", "VALIDATION_ERROR");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute(
  "/api/workspaces/$workspaceId/landings/$landingId/publication/rollback",
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const landingId = parseLandingRouteId(params.landingId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const { data, error } = await context.client
            .from("workspace_landings")
            .select("id")
            .eq("workspace_id", workspaceId)
            .eq("id", landingId)
            .maybeSingle();
          if (error) throw error;
          if (!data) throw new ApiError(404, "Landing draft not found", "NOT_FOUND");

          let body: unknown;
          try {
            body = await request.json();
          } catch {
            throw new ApiError(400, "Invalid JSON request body", "VALIDATION_ERROR");
          }
          const parsed = rollbackSchema.safeParse(body);
          if (!parsed.success) {
            throw new ApiError(400, "Choose a valid publication version", "VALIDATION_ERROR");
          }
          const repository = new SupabasePublicationRepository();
          const host = await repository.getHostTarget(workspaceId, parsed.data.hostId, landingId);
          const result = await rollbackLandingPublication(
            { repository, storage: new CloudflareR2Store() },
            {
              workspaceId,
              hostId: parsed.data.hostId,
              landingId,
              hostname: host.hostname,
              idempotencyKeyHash: await hashIdempotencyKey(request),
              createdByUserId: context.user.id,
              targetVersionId: parsed.data.targetVersionId,
            },
          );
          return accessSuccessResponse(result, result.replayed ? 200 : 201);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
