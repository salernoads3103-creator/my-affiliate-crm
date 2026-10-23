import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { AccessContext } from "./access.server";
import { AccessApiError, mapRpcError } from "./access.server";
import type { WorkspaceRole } from "./permissions";

export async function createWorkspaceInvitation(
  request: Request,
  context: AccessContext,
  workspaceId: string,
  email: string,
  role: Exclude<WorkspaceRole, "super_admin">,
) {
  const isProduction = process.env.NODE_ENV === "production";
  const configuredBaseUrl = process.env.APP_BASE_URL;
  if (isProduction && !configuredBaseUrl) {
    throw new AccessApiError(500, "APP_BASE_URL is required in production");
  }

  let appBaseUrl: URL;
  try {
    appBaseUrl = new URL(configuredBaseUrl ?? new URL(request.url).origin);
  } catch {
    throw new AccessApiError(500, "Invalid APP_BASE_URL server configuration");
  }
  const isLocalDevelopment =
    process.env.NODE_ENV !== "production" &&
    appBaseUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(appBaseUrl.hostname);
  if (
    appBaseUrl.username ||
    appBaseUrl.password ||
    appBaseUrl.search ||
    appBaseUrl.hash ||
    appBaseUrl.pathname !== "/" ||
    (appBaseUrl.protocol !== "https:" && !isLocalDevelopment)
  ) {
    throw new AccessApiError(500, "APP_BASE_URL must be a secure HTTPS origin");
  }

  const inviteUrl = new URL("/auth", appBaseUrl.origin);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  inviteUrl.searchParams.set("invite", token);
  const { data: invitationId, error } = await context.client.rpc("create_workspace_invitation", {
    p_workspace_id: workspaceId,
    p_email: email,
    p_role: role,
    p_token_hash: tokenHash,
  });
  if (error) throw mapRpcError(error.code, error.message, error);

  let emailSent = false;
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (supabaseUrl && serviceRoleKey) {
    try {
      const adminClient = createClient<Database>(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
        redirectTo: inviteUrl.toString(),
      });
      emailSent = !inviteError;
    } catch {
      emailSent = false;
    }
  }

  return { invitationId, inviteUrl: inviteUrl.toString(), emailSent };
}

export function hashInvitationToken(token: unknown): string {
  if (typeof token !== "string" || token.length < 40 || token.length > 100) {
    throw new AccessApiError(400, "Invalid invitation token");
  }
  return createHash("sha256").update(token).digest("hex");
}
