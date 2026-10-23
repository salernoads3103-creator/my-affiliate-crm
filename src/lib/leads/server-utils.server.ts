/**
 * Server-side helper to derive an authenticated controller from the request.
 * Server-only. Never import from client code.
 */
import { createClient } from "@supabase/supabase-js";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse } from "../api-error";
import { LeadController } from "./controller";

export { ApiError } from "./api-error";

export async function getController(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) throw new ApiError(401, "Unauthorized");
  const token = auth.slice(7);

  const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY =
    process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new ApiError(500, "The request could not be completed");
  }
  const client = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) throw new ApiError(401, "Unauthorized");
  return new LeadController(client, data.user.id);
}

export function ok(data: unknown, status = 200) {
  return new Response(JSON.stringify({ success: true, data }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function fail(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status >= 500) console.error("[api] Lead request failed", e.cause ?? e);
    return apiErrorResponse(e);
  }
  if (e instanceof ZodError) {
    const message = e.issues.map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`).join("; ");
    return apiErrorResponse(new ApiError(400, message || "Invalid request", "VALIDATION_ERROR"));
  }
  if (e instanceof SyntaxError) {
    return apiErrorResponse(new ApiError(400, "Invalid JSON request body", "VALIDATION_ERROR"));
  }

  console.error("[api] Unhandled lead request error", e);
  return apiErrorResponse(new ApiError(500, "The request could not be completed"));
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ApiError(400, "Invalid JSON request body", "VALIDATION_ERROR");
  }
}
