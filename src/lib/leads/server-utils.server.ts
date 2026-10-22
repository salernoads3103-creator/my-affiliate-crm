/**
 * Server-side helper to derive an authenticated controller from the request.
 * Server-only. Never import from client code.
 */
import { createClient } from "@supabase/supabase-js";
import { ApiError } from "./api-error";
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
    throw new ApiError(500, "Supabase server configuration is missing");
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
    return new Response(JSON.stringify({ success: false, error: e.message }), {
      status: e.status,
      headers: { "content-type": "application/json" },
    });
  }
  const msg = e instanceof Error ? e.message : "Server error";
  const status = /invalid|required|email/i.test(msg) ? 400 : 500;
  return new Response(JSON.stringify({ success: false, error: msg }), {
    status,
    headers: { "content-type": "application/json" },
  });
}
