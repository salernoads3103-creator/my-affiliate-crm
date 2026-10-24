import { createFileRoute } from "@tanstack/react-router";
import {
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
} from "@/lib/access/access.server";
import { OrderController } from "@/lib/orders/controller";
import { orderErrorResponse } from "@/lib/orders/server-utils.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/orders")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const search = new URL(request.url).searchParams.get("q") ?? "";
          const orders = await new OrderController(client).list(params.workspaceId, search);
          return accessSuccessResponse({ orders });
        } catch (error) {
          return orderErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const body = await readJsonBody(request);
          const order = await new OrderController(client).create(params.workspaceId, body);
          return accessSuccessResponse(order, 201);
        } catch (error) {
          return orderErrorResponse(error);
        }
      },
    },
  },
});
