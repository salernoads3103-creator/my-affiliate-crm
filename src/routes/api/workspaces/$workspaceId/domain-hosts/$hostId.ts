import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { parseDomainRouteId } from "@/lib/domains/http.server";
import { DomainService } from "@/lib/domains/service.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/domain-hosts/$hostId")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const workspaceId = parseDomainRouteId(params.workspaceId, "workspace");
          const hostId = parseDomainRouteId(params.hostId, "host");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const data = await new DomainService().deleteAddress(workspaceId, hostId);
          return accessSuccessResponse({ deleted: true, ...data });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
