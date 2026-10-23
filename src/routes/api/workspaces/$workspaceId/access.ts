import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
} from "@/lib/access/access.server";
import { WORKSPACE_PERMISSIONS } from "@/lib/access/permissions";

export const Route = createFileRoute("/api/workspaces/$workspaceId/access")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const results = await Promise.all(
            WORKSPACE_PERMISSIONS.map(async (permission) => {
              const { data, error } = await client.rpc("has_workspace_permission", {
                p_workspace_id: params.workspaceId,
                p_permission_key: permission,
                p_team_id: null,
                p_operator_id: null,
                p_offer_id: null,
              });
              if (error) throw error;
              return [permission, data === true] as const;
            }),
          );
          return accessSuccessResponse({
            workspaceId: params.workspaceId,
            permissions: Object.fromEntries(results),
          });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
