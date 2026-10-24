import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { getOrderDelivery, saveOrderDelivery } from "@/lib/shipping/service.server";
import { shippingErrorResponse } from "@/lib/shipping/server-utils.server";
import { OrderDeliverySchema } from "@/lib/shipping/validation";

const uuidSchema = z.string().uuid();

export const Route = createFileRoute("/api/workspaces/$workspaceId/orders/$orderId/delivery")({
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
      PUT: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          const workspaceId = uuidSchema.parse(params.workspaceId);
          const orderId = uuidSchema.parse(params.orderId);
          await requireWorkspacePermission(context, workspaceId, "shipping.manage");
          const input = OrderDeliverySchema.parse(await readJsonBody(request));
          const result = await saveOrderDelivery(context.client, workspaceId, orderId, input);
          return accessSuccessResponse(result);
        } catch (error) {
          return shippingErrorResponse(error);
        }
      },
    },
  },
});
