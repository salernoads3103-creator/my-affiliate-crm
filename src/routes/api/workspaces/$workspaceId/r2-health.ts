import { createFileRoute } from "@tanstack/react-router";
import { CloudflareR2Store } from "@/lib/publications/r2.server";
import {
  isR2DiagnosticEndpointEnabled,
  runR2ReadOnlyHealthcheck,
} from "@/lib/publications/health.server";
import {
  accessErrorResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { parseLandingRouteId } from "@/lib/landings/http.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/r2-health")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        if (!isR2DiagnosticEndpointEnabled(process.env)) {
          return new Response(null, { status: 404 });
        }
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");

          const result = await runR2ReadOnlyHealthcheck(() =>
            new CloudflareR2Store().checkBucket(),
          );
          if (result.status !== "connected") {
            console.warn("[r2-health] probe_failed", { workspaceId, ...result });
          }
          return Response.json(
            { success: true, data: result },
            { status: result.status === "connected" ? 200 : 503 },
          );
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
