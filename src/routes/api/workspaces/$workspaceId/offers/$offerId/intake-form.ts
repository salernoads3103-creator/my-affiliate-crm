import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { LandingOriginSchema } from "@/lib/intake/validation";

const uuidSchema = z.string().uuid();
const formConfigSchema = z.object({ allowedOrigin: LandingOriginSchema }).strict();

function parseUuid(value: string): string {
  const parsed = uuidSchema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "Invalid workspace resource id", "VALIDATION_ERROR");
  return parsed.data;
}

export const Route = createFileRoute("/api/workspaces/$workspaceId/offers/$offerId/intake-form")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseUuid(params.workspaceId);
          const offerId = parseUuid(params.offerId);
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "offers.manage");
          const { data, error } = await context.client.rpc("get_landing_form_config", {
            p_workspace_id: workspaceId,
            p_offer_id: offerId,
          });
          if (error) throw error;
          const config = data?.[0];
          return accessSuccessResponse(
            config
              ? {
                  publicId: config.public_id,
                  allowedOrigin: config.allowed_origin,
                  isActive: config.is_active,
                }
              : null,
          );
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseUuid(params.workspaceId);
          const offerId = parseUuid(params.offerId);
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "offers.manage");
          const parsed = formConfigSchema.safeParse(await readJsonBody(request));
          if (!parsed.success) {
            throw new ApiError(400, "Enter one exact HTTPS origin", "VALIDATION_ERROR");
          }
          const { data, error } = await context.client.rpc("create_landing_form_config", {
            p_workspace_id: workspaceId,
            p_offer_id: offerId,
            p_allowed_origin: parsed.data.allowedOrigin,
          });
          if (error) throw error;
          const config = data?.[0];
          if (!config) throw new ApiError(500, "Could not create landing form", "INTERNAL_ERROR");
          return accessSuccessResponse(
            {
              publicId: config.public_id,
              allowedOrigin: config.allowed_origin,
              isActive: config.is_active,
            },
            201,
          );
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      DELETE: async ({ request, params }) => {
        try {
          const workspaceId = parseUuid(params.workspaceId);
          const offerId = parseUuid(params.offerId);
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "offers.manage");
          const { data, error } = await context.client.rpc("deactivate_landing_form_config", {
            p_workspace_id: workspaceId,
            p_offer_id: offerId,
          });
          if (error) throw error;
          return accessSuccessResponse({ deactivated: data === true });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
