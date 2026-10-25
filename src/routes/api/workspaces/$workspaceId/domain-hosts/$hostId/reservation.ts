import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import {
  parseDomainReservationBody,
  parseDomainReservationQuery,
  parseDomainRouteId,
  readDomainJsonBody,
} from "@/lib/domains/http.server";
import { DomainService } from "@/lib/domains/service.server";

export const Route = createFileRoute(
  "/api/workspaces/$workspaceId/domain-hosts/$hostId/reservation",
)({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseDomainRouteId(params.workspaceId, "workspace");
          const hostId = parseDomainRouteId(params.hostId, "host");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const landingId = parseDomainReservationBody(await readDomainJsonBody(request));
          const result = await new DomainService().reserveAddress(workspaceId, hostId, landingId);
          return accessSuccessResponse(result);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const workspaceId = parseDomainRouteId(params.workspaceId, "workspace");
          const hostId = parseDomainRouteId(params.hostId, "host");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const landingId = parseDomainReservationQuery(
            new URL(request.url).searchParams.get("landingId"),
          );
          await new DomainService().releaseReservation(workspaceId, hostId, landingId);
          return accessSuccessResponse({ released: true });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
