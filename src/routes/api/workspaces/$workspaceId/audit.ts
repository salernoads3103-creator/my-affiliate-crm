import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
} from "@/lib/access/access.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/audit")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          const limitValue = new URL(request.url).searchParams.get("limit") ?? "100";
          const limit = Number(limitValue);
          if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
            return Response.json(
              { success: false, error: "limit must be an integer from 1 to 500" },
              { status: 400 },
            );
          }
          const { data, error } = await context.client.rpc("get_workspace_access_audit", {
            p_workspace_id: params.workspaceId,
            p_limit: limit,
          });
          if (error) throw error;
          return accessSuccessResponse(data ?? []);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
