import { createFileRoute } from "@tanstack/react-router";
import {
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
} from "@/lib/access/access.server";
import { OrderController } from "@/lib/orders/controller";
import { orderErrorResponse } from "@/lib/orders/server-utils.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/orders/$orderId/status")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const body = await readJsonBody(request);
          const order = await new OrderController(client).transition(
            params.workspaceId,
            params.orderId,
            body,
          );
          return accessSuccessResponse(order);
        } catch (error) {
          return orderErrorResponse(error);
        }
      },
    },
  },
});
