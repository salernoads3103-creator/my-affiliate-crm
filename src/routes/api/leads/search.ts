import { createFileRoute } from "@tanstack/react-router";
import { fail, getController, ok } from "@/lib/leads/server-utils.server";

export const Route = createFileRoute("/api/leads/search")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const c = await getController(request);
          const params = new URL(request.url).searchParams;
          const q = params.get("q") ?? "";
          const includeDeleted = params.get("includeDeleted") === "true";
          return ok(await c.search(q, includeDeleted));
        } catch (e) {
          return fail(e);
        }
      },
    },
  },
});
