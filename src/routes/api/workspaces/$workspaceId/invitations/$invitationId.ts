import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
} from "@/lib/access/access.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/invitations/$invitationId")({
  server: {
    handlers: {
      DELETE: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          const { data, error } = await context.client.rpc("revoke_workspace_invitation", {
            p_workspace_id: params.workspaceId,
            p_invitation_id: params.invitationId,
          });
          if (error) throw error;
          return accessSuccessResponse({ revoked: data === true });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
