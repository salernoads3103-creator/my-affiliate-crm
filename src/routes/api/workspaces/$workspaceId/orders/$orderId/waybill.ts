import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { createOrderWaybill, getOrderDelivery } from "@/lib/shipping/service.server";
import { shippingErrorResponse } from "@/lib/shipping/server-utils.server";

const uuidSchema = z.string().uuid();

export const Route = createFileRoute("/api/workspaces/$workspaceId/orders/$orderId/waybill")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          const workspaceId = uuidSchema.parse(params.workspaceId);
          const orderId = uuidSchema.parse(params.orderId);
          return accessSuccessResponse(
            await getOrderDelivery(context.client, workspaceId, orderId),
          );
        } catch (error) {
          return shippingErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          const workspaceId = uuidSchema.parse(params.workspaceId);
          const orderId = uuidSchema.parse(params.orderId);
          await requireWorkspacePermission(context, workspaceId, "shipping.manage");
          return accessSuccessResponse(
            await createOrderWaybill(context, workspaceId, orderId),
            201,
          );
        } catch (error) {
          return shippingErrorResponse(error);
        }
      },
    },
  },
});
