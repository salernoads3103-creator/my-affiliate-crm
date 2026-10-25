import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  hasWorkspacePermission,
  requireAccessContext,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { parseDomainRouteId } from "@/lib/domains/http.server";
import { DomainService } from "@/lib/domains/service.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/domain-hosts/available")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseDomainRouteId(params.workspaceId, "workspace");
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
          const addresses = await new DomainService().listAvailableAddresses(workspaceId);
          return accessSuccessResponse({ addresses });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
