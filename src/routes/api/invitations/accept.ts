import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
} from "@/lib/access/access.server";
import { hashInvitationToken } from "@/lib/access/invitations.server";

export const Route = createFileRoute("/api/invitations/accept")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const context = await requireAccessContext(request);
          const body = await readJsonBody(request);
          const tokenHash = hashInvitationToken(body.token);
          const { data, error } = await context.client.rpc("accept_workspace_invitation", {
            p_token_hash: tokenHash,
          });
          if (error) throw error;
          return accessSuccessResponse({ workspaceId: data });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
