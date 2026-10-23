import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  hasWorkspacePermission,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import {
  analyzeUploadedLandingArchive,
  parseLandingCreateForm,
  parseLandingRouteId,
  readLandingForm,
} from "@/lib/landings/http.server";
import { LandingService } from "@/lib/landings/service";

export const Route = createFileRoute("/api/workspaces/$workspaceId/landings")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const context = await requireAccessContext(request);
          const canRead = await hasWorkspacePermission(context, workspaceId, "landing_pages.read");
          const canManage = await hasWorkspacePermission(
            context,
            workspaceId,
            "landing_pages.manage",
          );
          if (!canRead && !canManage) {
            throw new ApiError(403, "Insufficient workspace permissions");
          }

          const search = new URL(request.url).searchParams.get("q") ?? "";
          const data = await new LandingService(context.client).list(workspaceId, search);
          return accessSuccessResponse(data);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          await requireWorkspacePermission(context, workspaceId, "offers.read");

          const formData = await readLandingForm(request);
          const fields = parseLandingCreateForm(formData);
          const analysis = await analyzeUploadedLandingArchive(fields.archive);

          const data = await new LandingService(context.client).createDraft({
            name: fields.name,
            offerId: fields.offerId,
            workspaceId,
            createdByUserId: context.user.id,
            archive: fields.archive,
            analysis,
          });
          return accessSuccessResponse(data, 201);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
