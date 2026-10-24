import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  accessSuccessResponse,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import type { NovaPoshtaDirectoryKind } from "@/lib/shipping/types";
import { getNovaPoshtaDirectory } from "@/lib/shipping/service.server";
import { shippingErrorResponse } from "@/lib/shipping/server-utils.server";

const kinds = [
  "cities",
  "divisions",
  "senderProfiles",
  "senderAddresses",
  "senderContacts",
] as const;
const purposes = ["sender", "recipient"] as const;

export const Route = createFileRoute("/api/workspaces/$workspaceId/nova-poshta/directories")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, params.workspaceId, "shipping.manage");
          const query = new URL(request.url).searchParams;
          const kind = z.enum(kinds).parse(query.get("kind"));
          const purpose = z.enum(purposes).catch("recipient").parse(query.get("purpose"));
          const search = (query.get("q") ?? "").trim().slice(0, 100);
          const cityRef = query.get("cityRef");
          const counterpartyRef = query.get("counterpartyRef");
          const result = await getNovaPoshtaDirectory(
            params.workspaceId,
            kind as NovaPoshtaDirectoryKind,
            search,
            cityRef,
            purpose,
            counterpartyRef,
          );
          return accessSuccessResponse(result);
        } catch (error) {
          return shippingErrorResponse(error);
        }
      },
    },
  },
});
