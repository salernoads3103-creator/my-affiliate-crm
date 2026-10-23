import { createFileRoute } from "@tanstack/react-router";
import { fail, getController, ok, readJsonBody } from "@/lib/leads/server-utils.server";

export const Route = createFileRoute("/api/leads/$id")({
  server: {
    handlers: {
      PUT: async ({ request, params }) => {
        try {
          const c = await getController(request);
          const body = await readJsonBody(request);
          return ok(await c.update(params.id, body));
        } catch (e) { return fail(e); }
      },
      DELETE: async ({ request, params }) => {
        try {
          const c = await getController(request);
          return ok(await c.remove(params.id));
        } catch (e) { return fail(e); }
      },
    },
  },
});
