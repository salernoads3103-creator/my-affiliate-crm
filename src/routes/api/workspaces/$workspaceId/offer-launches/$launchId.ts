import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { DomainService } from "@/lib/domains/service.server";
import { parseLandingRouteId } from "@/lib/landings/http.server";
import {
  continueSavedOfferLaunch,
  launchStageView,
  OfferLaunchRepository,
} from "@/lib/offer-launches/service.server";

const resumeSchema = z.object({ hostId: z.string().uuid().optional() }).strict();

async function statusFor(workspaceId: string, launchId: string) {
  const row = await new OfferLaunchRepository().getRow(workspaceId, launchId);
  if (!row) return null;
  const hostname = (await new DomainService().listAddresses(workspaceId)).find(
    (address) => address.id === row.domain_host_id,
  )?.hostname;
  return { ...launchStageView(row), hostname: hostname ?? null };
}

export const Route = createFileRoute("/api/workspaces/$workspaceId/offer-launches/$launchId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const launchId = parseLandingRouteId(params.launchId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "offers.manage");
          await requireWorkspacePermission(context, workspaceId, "products.read");
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          return accessSuccessResponse(await statusFor(workspaceId, launchId));
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const launchId = parseLandingRouteId(params.launchId, "landing");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "offers.manage");
          await requireWorkspacePermission(context, workspaceId, "products.read");
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const parsed = resumeSchema.safeParse(await readJsonBody(request));
          if (!parsed.success)
            throw new ApiError(400, "Invalid launch continuation", "VALIDATION_ERROR");
          const status = await continueSavedOfferLaunch({
            client: context.client,
            workspaceId,
            launchId,
            ...(parsed.data.hostId ? { requestHostId: parsed.data.hostId } : {}),
            processingToken: crypto.randomUUID(),
          });
          return accessSuccessResponse(status, status.isProcessing ? 202 : 200);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
