import { createFileRoute } from "@tanstack/react-router";
import { fail, getController, ok } from "@/lib/leads/server-utils.server";

export const Route = createFileRoute("/api/leads/$id/restore")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        try {
          const controller = await getController(request);
          return ok(await controller.restore(params.id));
        } catch (error) {
          return fail(error);
        }
      },
    },
  },
});
