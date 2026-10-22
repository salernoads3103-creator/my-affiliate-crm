import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/members")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "members.read");
          const { data, error } = await context.client.rpc("get_workspace_members", {
            p_workspace_id: params.workspaceId,
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
