import { createFileRoute } from "@tanstack/react-router";
import {
  accessSuccessResponse,
  hasWorkspacePermission,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ProductController } from "@/lib/products/controller";
import { productErrorResponse } from "@/lib/products/server-utils.server";

/** Authenticated workspace product API. The workspace path is checked by RLS-backed permissions. */
export const Route = createFileRoute("/api/workspaces/$workspaceId/products")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "products.read");
          const canReadCost = await hasWorkspacePermission(
            context,
            params.workspaceId,
            "products.cost.read",
          );
          const search = new URL(request.url).searchParams.get("q") ?? "";
          const data = await new ProductController(context.client).list(
            params.workspaceId,
            search,
            canReadCost,
          );
          return accessSuccessResponse(data);
        } catch (error) {
          return productErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "products.read");
          await requireWorkspacePermission(context, params.workspaceId, "products.manage");
          const body = await readJsonBody(request);
          if (Object.prototype.hasOwnProperty.call(body, "costPrice")) {
            await requireWorkspacePermission(context, params.workspaceId, "products.cost.read");
          }
          const data = await new ProductController(context.client).create(params.workspaceId, body);
          return accessSuccessResponse(data, 201);
        } catch (error) {
          return productErrorResponse(error);
        }
      },
    },
  },
});
