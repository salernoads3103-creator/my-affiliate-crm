import { createFileRoute } from "@tanstack/react-router";
import { accessSuccessResponse, requireAccessContext } from "@/lib/access/access.server";
import { OfferController } from "@/lib/offers/controller";
import { offerErrorResponse } from "@/lib/offers/server-utils.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/offers/catalog")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const search = new URL(request.url).searchParams.get("q") ?? "";
          const data = await new OfferController(client).list(params.workspaceId, search);
          return accessSuccessResponse(data);
        } catch (error) {
          return offerErrorResponse(error);
        }
      },
    },
  },
});
