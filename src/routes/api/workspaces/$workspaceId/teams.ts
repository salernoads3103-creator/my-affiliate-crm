import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
} from "@/lib/access/access.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/teams")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const { data, error } = await client.rpc("get_workspace_teams", {
            p_workspace_id: params.workspaceId,
          });
          if (error) throw error;
          return accessSuccessResponse(data ?? []);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const body = await readJsonBody(request);
          if (typeof body.name !== "string") {
            return Response.json(
              { success: false, error: "Team name is required" },
              { status: 400 },
            );
          }
          const { data, error } = await client.rpc("create_workspace_team", {
            p_workspace_id: params.workspaceId,
            p_name: body.name,
          });
          if (error) throw error;
          return accessSuccessResponse({ id: data }, 201);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
