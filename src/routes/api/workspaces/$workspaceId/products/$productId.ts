import { createFileRoute } from "@tanstack/react-router";
import {
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ProductController } from "@/lib/products/controller";
import { productErrorResponse } from "@/lib/products/server-utils.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/products/$productId")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "products.read");
          await requireWorkspacePermission(context, params.workspaceId, "products.manage");
          const body = await readJsonBody(request);
          if (Object.prototype.hasOwnProperty.call(body, "costPrice")) {
            await requireWorkspacePermission(context, params.workspaceId, "products.cost.read");
          }
          const data = await new ProductController(context.client).update(params.productId, body);
          return accessSuccessResponse(data);
        } catch (error) {
          return productErrorResponse(error);
        }
      },
    },
  },
});
