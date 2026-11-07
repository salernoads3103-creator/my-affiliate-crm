import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError } from "@/lib/api-error";

type TrackingProfileDeleteClient = Pick<SupabaseClient<Database>, "from">;

export async function removeTrackingProfileRecord(
  client: TrackingProfileDeleteClient,
  workspaceId: string,
  profileId: string,
): Promise<void> {
  const { data, error } = await client
    .from("workspace_tracking_profiles")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", profileId)
    .select("id")
    .maybeSingle();

  if (error?.code === "42501") {
    throw new ApiError(403, "Insufficient workspace permissions");
  }
  if (error?.code === "23503") {
    throw new ApiError(
      409,
      "This profile is linked to a landing or launch and cannot be deleted",
      "CONFLICT",
    );
  }
  if (error) {
    throw new ApiError(
      500,
      "The tracking profile request could not be completed",
      "INTERNAL_ERROR",
    );
  }
  if (!data) throw new ApiError(404, "Tracking profile not found", "NOT_FOUND");
}
