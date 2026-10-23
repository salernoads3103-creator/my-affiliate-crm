import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
  readJsonBody,
} from "@/lib/access/access.server";
import { createWorkspaceInvitation } from "@/lib/access/invitations.server";
import type { WorkspaceRole } from "@/lib/access/permissions";

const roles: Exclude<WorkspaceRole, "super_admin">[] = ["admin", "operator", "viewer"];

export const Route = createFileRoute("/api/workspaces/$workspaceId/invitations")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "members.read");
          const { data, error } = await context.client.rpc("get_workspace_invitations", {
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
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "members.invite");
          const body = await readJsonBody(request);
          if (
            typeof body.email !== "string" ||
            typeof body.role !== "string" ||
            !roles.includes(body.role as Exclude<WorkspaceRole, "super_admin">)
          ) {
            return Response.json(
              {
                success: false,
                code: "VALIDATION_ERROR",
                error: "A valid email and workspace role are required",
              },
              { status: 400 },
            );
          }
          const result = await createWorkspaceInvitation(
            request,
            context,
            params.workspaceId,
            body.email.trim(),
            body.role as Exclude<WorkspaceRole, "super_admin">,
          );
          return accessSuccessResponse(result, 201);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
