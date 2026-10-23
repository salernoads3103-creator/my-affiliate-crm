import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { OfferController } from "@/lib/offers/controller";
import { offerErrorResponse } from "@/lib/offers/server-utils.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/offers")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const { data, error } = await client.rpc("get_workspace_offers", {
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
          const body = await readJsonBody(request);
          if (Object.prototype.hasOwnProperty.call(body, "productId")) {
            await requireWorkspacePermission(context, params.workspaceId, "offers.manage");
            await requireWorkspacePermission(context, params.workspaceId, "products.read");
            const data = await new OfferController(context.client).create(params.workspaceId, body);
            return accessSuccessResponse(data, 201);
          }
          if (typeof body.name !== "string") {
            return Response.json(
              { success: false, code: "VALIDATION_ERROR", error: "Offer name is required" },
              { status: 400 },
            );
          }
          const { data, error } = await context.client.rpc("create_workspace_offer", {
            p_workspace_id: params.workspaceId,
            p_name: body.name,
          });
          if (error) throw error;
          return accessSuccessResponse({ id: data }, 201);
        } catch (error) {
          return offerErrorResponse(error);
        }
      },
    },
  },
});
