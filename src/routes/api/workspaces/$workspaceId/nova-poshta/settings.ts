import { createFileRoute } from "@tanstack/react-router";
import {
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { getNovaPoshtaSettings, saveNovaPoshtaSettings } from "@/lib/shipping/service.server";
import { shippingErrorResponse } from "@/lib/shipping/server-utils.server";
import { NovaPoshtaSettingsSchema } from "@/lib/shipping/validation";

export const Route = createFileRoute("/api/workspaces/$workspaceId/nova-poshta/settings")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "shipping.manage");
          return accessSuccessResponse(await getNovaPoshtaSettings(params.workspaceId));
        } catch (error) {
          return shippingErrorResponse(error);
        }
      },
      PUT: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "shipping.manage");
          const input = NovaPoshtaSettingsSchema.parse(await readJsonBody(request));
          const settings = await saveNovaPoshtaSettings(params.workspaceId, context.user.id, input);
          return accessSuccessResponse(settings);
        } catch (error) {
          return shippingErrorResponse(error);
        }
      },
    },
  },
});
