import { createFileRoute } from "@tanstack/react-router";
import {
  accessErrorResponse,
  accessSuccessResponse,
  hasWorkspacePermission,
  readJsonBody,
  requireAccessContext,
  requireWorkspacePermission,
} from "@/lib/access/access.server";
import { ApiError } from "@/lib/api-error";
import { parseLandingRouteId } from "@/lib/landings/http.server";
import { TrackingProfileService } from "@/lib/tracking-profiles/service.server";
import { TrackingProfileWriteSchema } from "@/lib/tracking-profiles/validation";

export const Route = createFileRoute("/api/workspaces/$workspaceId/tracking-profiles")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const context = await requireAccessContext(request);
          const mayRead =
            (await hasWorkspacePermission(context, workspaceId, "landing_pages.read")) ||
            (await hasWorkspacePermission(context, workspaceId, "landing_pages.manage"));
          if (!mayRead) throw new ApiError(403, "Insufficient workspace permissions");
          const profiles = await new TrackingProfileService().list(workspaceId);
          return accessSuccessResponse({ profiles });
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
      POST: async ({ request, params }) => {
        try {
          const workspaceId = parseLandingRouteId(params.workspaceId, "workspace");
          const context = await requireAccessContext(request);
          await requireWorkspacePermission(context, workspaceId, "landing_pages.manage");
          const parsed = TrackingProfileWriteSchema.safeParse(await readJsonBody(request));
          if (!parsed.success) {
            throw new ApiError(400, "Enter valid tracking profile details", "VALIDATION_ERROR");
          }
          const profile = await new TrackingProfileService().create(
            workspaceId,
            context.user.id,
            parsed.data,
          );
          return accessSuccessResponse(profile, 201);
        } catch (error) {
          return accessErrorResponse(error);
        }
      },
    },
  },
});
