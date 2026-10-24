import { createFileRoute } from "@tanstack/react-router";
import { accessSuccessResponse, requireAccessContext } from "@/lib/access/access.server";
import { OrderController } from "@/lib/orders/controller";
import { orderErrorResponse } from "@/lib/orders/server-utils.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/orders/context")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const leadId = new URL(request.url).searchParams.get("leadId") ?? "";
          const context = await new OrderController(client).getLeadContext(
            params.workspaceId,
            leadId,
          );
          return accessSuccessResponse(context);
        } catch (error) {
          return orderErrorResponse(error);
        }
      },
    },
  },
});
