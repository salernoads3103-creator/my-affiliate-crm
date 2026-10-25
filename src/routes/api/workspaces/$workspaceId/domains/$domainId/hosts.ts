import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import {
  parseBulkDomainHostsBody,
  parseDomainRouteId,
  readDomainJsonBody,
} from "@/lib/domains/http.server";
import { DomainService } from "@/lib/domains/service.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/domains/$domainId/hosts")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseDomainRouteId(params.workspaceId, "workspace");
          const domainId = parseDomainRouteId(params.domainId, "domain");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const hostnames = parseBulkDomainHostsBody(await readDomainJsonBody(request));
          const results = await new DomainService().addSubdomains(workspaceId, domainId, hostnames);
          return accessSuccessResponse({ results });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
