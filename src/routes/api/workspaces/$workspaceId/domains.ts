import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  hasWorkspacePermission,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import {
  parseCreateDomainBody,
  parseDomainRouteId,
  readDomainJsonBody,
} from "@/lib/domains/http.server";
import { normalizeDomainName } from "@/lib/domains/validation";
import { DomainService } from "@/lib/domains/service.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/domains")({
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
          const addresses = await new DomainService().listAddresses(workspaceId);
          return accessSuccessResponse({ addresses });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseDomainRouteId(params.workspaceId, "workspace");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const domainName = normalizeDomainName(
            parseCreateDomainBody(await readDomainJsonBody(request)),
          );
          if (!domainName) {
            throw new ApiError(400, "Enter a valid public domain name", "VALIDATION_ERROR");
          }
          const domain = await new DomainService().createDomain(
            workspaceId,
            context.user.id,
            domainName,
          );
          return accessSuccessResponse(domain, domain.created ? 201 : 200);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
