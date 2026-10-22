import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  createPublicAccessClient,
  readJsonBody,
} from "@/lib/access/access.server";
import { hashInvitationToken } from "@/lib/access/invitations.server";

export const Route = createFileRoute("/api/invitations/validate")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let response: Response;
        try {
          const body = await readJsonBody(request);
          const tokenHash = hashInvitationToken(body.token);
          const client = createPublicAccessClient();
          const { data, error } = await client.rpc("validate_workspace_invitation", {
            p_token_hash: tokenHash,
          });
          if (error) throw error;
          const invitation = data?.[0];
          if (!invitation) {
            response = Response.json(
              { success: false, error: "Invitation is invalid or expired" },
              { status: 404 },
            );
          } else {
            response = accessSuccessResponse(invitation);
          }
        } catch (error) {
          response = accessErrorResponse(error);
        }

        const headers = new Headers(response.headers);
        headers.set("Cache-Control", "no-store");
        headers.set("Referrer-Policy", "no-referrer");
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      },
    },
  },
});
