import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
} from "@/lib/access/access.server";
import { WORKSPACE_PERMISSIONS } from "@/lib/access/permissions";

const scopeTypes = ["workspace", "team", "operator", "offer"] as const;

export const Route = createFileRoute("/api/workspaces/$workspaceId/permissions")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          const userId = new URL(request.url).searchParams.get("user_id");
          if (!userId) {
            return Response.json(
              { success: false, code: "VALIDATION_ERROR", error: "user_id is required" },
              { status: 400 },
            );
          }
          const { data, error } = await context.client.rpc("get_workspace_member_permissions", {
            p_workspace_id: params.workspaceId,
            p_user_id: userId,
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
          const body = await readJsonBody(request);
          if (
            typeof body.userId !== "string" ||
            typeof body.permission !== "string" ||
            !WORKSPACE_PERMISSIONS.includes(
              body.permission as (typeof WORKSPACE_PERMISSIONS)[number],
            ) ||
            (body.allowed !== null && typeof body.allowed !== "boolean") ||
            typeof body.scopeType !== "string" ||
            !scopeTypes.includes(body.scopeType as (typeof scopeTypes)[number]) ||
            (body.scopeId !== null && typeof body.scopeId !== "string") ||
            typeof body.delegable !== "boolean"
          ) {
            return Response.json(
              { success: false, code: "VALIDATION_ERROR", error: "Invalid permission change" },
              { status: 400 },
            );
          }
          const { data, error } = await context.client.rpc("set_workspace_member_permission", {
            p_workspace_id: params.workspaceId,
            p_user_id: body.userId,
            p_permission_key: body.permission,
            p_allowed: body.allowed,
            p_scope_type: body.scopeType,
            p_scope_id: body.scopeId,
            p_delegable: body.delegable,
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
