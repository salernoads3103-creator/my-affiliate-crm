import { createFileRoute } from "@tanstack/react-router";
import { fail, getController, ok, readJsonBody } from "@/lib/leads/server-utils.server";

export const Route = createFileRoute("/api/leads/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const c = await getController(request);
          const includeDeleted = new URL(request.url).searchParams.get("includeDeleted") === "true";
          return ok(await c.list(includeDeleted));
        } catch (e) {
          return fail(e);
        }
      },
      POST: async ({ request }) => {
        try {
          const c = await getController(request);
          const body = await readJsonBody(request);
          return ok(await c.create(body), 201);
        } catch (e) {
          return fail(e);
        }
      },
    },
  },
});
