import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
} from "@/lib/access/access.server";

const roles = ["admin", "operator", "viewer"] as const;

export const Route = createFileRoute("/api/workspaces/$workspaceId/members/$userId")({
  server: {
    handlers: {
      PATCH: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          const body = await readJsonBody(request);
          if (
            typeof body.role !== "string" ||
            !roles.includes(body.role as (typeof roles)[number])
          ) {
            return Response.json(
              { success: false, error: "Invalid workspace role" },
              { status: 400 },
            );
          }
          const { data, error } = await context.client.rpc("set_workspace_member_role", {
            p_workspace_id: params.workspaceId,
            p_user_id: params.userId,
            p_role: body.role,
          });
          if (error) throw error;
          return accessSuccessResponse({ updated: data === true });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
