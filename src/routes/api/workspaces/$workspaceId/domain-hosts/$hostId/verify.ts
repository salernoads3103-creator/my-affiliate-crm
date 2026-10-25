import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { parseDomainRouteId } from "@/lib/domains/http.server";
import { DomainService } from "@/lib/domains/service.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/domain-hosts/$hostId/verify")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseDomainRouteId(params.workspaceId, "workspace");
          const hostId = parseDomainRouteId(params.hostId, "host");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const result = await new DomainService().verifyHost(workspaceId, hostId);
          return accessSuccessResponse(result);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
