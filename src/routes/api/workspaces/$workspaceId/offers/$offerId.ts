import { createFileRoute } from "@tanstack/react-router";
import {
  accessSuccessResponse,
  readJsonBody,
  requireAccessContext,
} from "@/lib/access/access.server";
import { OfferController } from "@/lib/offers/controller";
import { offerErrorResponse } from "@/lib/offers/server-utils.server";

export const Route = createFileRoute("/api/workspaces/$workspaceId/offers/$offerId")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        try {
          const { client } = await requireAccessContext(request);
          const body = await readJsonBody(request);
          const data = await new OfferController(client).update(
            params.workspaceId,
            params.offerId,
            body,
          );
          return accessSuccessResponse(data);
        } catch (error) {
          return offerErrorResponse(error);
        }
      },
    },
  },
});
