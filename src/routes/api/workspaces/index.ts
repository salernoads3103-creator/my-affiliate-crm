import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  requireAccessContext,
} from "@/lib/access/access.server";

export const Route = createFileRoute("/api/workspaces/")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const { client } = await requireAccessContext(request);
          const { data, error } = await client.rpc("my_workspaces");
          if (error) throw error;
          return accessSuccessResponse(data ?? []);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
