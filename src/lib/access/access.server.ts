import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { ApiError, apiErrorResponse, type ApiErrorCode } from "../api-error";
import type { WorkspacePermission } from "./permissions";

export type AccessClient = SupabaseClient<Database>;

export class AccessApiError extends ApiError {
  constructor(status: number, message: string, code?: ApiErrorCode, cause?: unknown) {
    super(status, message, code, cause);
    this.name = "AccessApiError";
  }
}

export type AccessContext = {
  client: AccessClient;
  user: User;
};

function getSupabaseConfig() {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const publishableKey =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new AccessApiError(500, "Supabase server configuration is missing");
  }
  return { url, publishableKey };
}

export async function requireAccessContext(request: Request): Promise<AccessContext> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new AccessApiError(401, "Unauthorized");
  }
  const token = authorization.slice("Bearer ".length).trim();
  if (!token) throw new AccessApiError(401, "Unauthorized");

  const { url, publishableKey } = getSupabaseConfig();
  const client = createClient<Database>(url, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new AccessApiError(401, "Unauthorized");
  return { client, user: data.user };
}

export async function requireWorkspacePermission(
  context: AccessContext,
  workspaceId: string,
  permission: WorkspacePermission,
): Promise<void> {
  const { data, error } = await context.client.rpc("has_workspace_permission", {
    p_workspace_id: workspaceId,
    p_permission_key: permission,
    p_team_id: null,
    p_operator_id: null,
    p_offer_id: null,
  });
  if (error) throw mapRpcError(error.code, error.message, error);
  if (!data) throw new AccessApiError(403, "Insufficient workspace permissions");
}

export function mapRpcError(code?: string, message?: string, cause?: unknown): AccessApiError {
  if (code === "42501") return new AccessApiError(403, "Insufficient workspace permissions");
  if (code === "P0002")
    return new AccessApiError(404, "The requested workspace resource was not found");
  if (code === "23505")
    return new AccessApiError(409, "The requested workspace change conflicts with existing data");
  if (code === "22023") return new AccessApiError(400, "Invalid request", "VALIDATION_ERROR", cause);
  return new AccessApiError(500, "Workspace request failed", "INTERNAL_ERROR", cause ?? message);
}

export function accessErrorResponse(error: unknown): Response {
  let mapped: AccessApiError;
  if (error instanceof AccessApiError) {
    mapped = error;
  } else if (error instanceof ApiError) {
    mapped = new AccessApiError(error.status, error.message, error.code, error.cause);
  } else if (error && typeof error === "object" && "code" in error) {
    const rpcError = error as { code?: unknown; message?: unknown };
    mapped = mapRpcError(String(rpcError.code ?? ""), String(rpcError.message ?? ""), error);
  } else {
    mapped = new AccessApiError(500, "Workspace request failed", "INTERNAL_ERROR", error);
  }

  if (mapped.status >= 500) console.error("[api] Workspace request failed", mapped.cause ?? error);
  return apiErrorResponse(mapped);
}

export function accessSuccessResponse(data: unknown, status = 200): Response {
  return Response.json({ success: true, data }, { status });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new AccessApiError(400, "Invalid JSON request body");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AccessApiError(400, "Expected a JSON object");
  }
  return value as Record<string, unknown>;
}

export function createPublicAccessClient(): AccessClient {
  const { url, publishableKey } = getSupabaseConfig();
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
