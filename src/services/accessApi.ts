import { supabase } from "@/integrations/supabase/client";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const response = await fetch(path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    data?: T;
    error?: string;
  };
  if (!response.ok || result.success === false) {
    throw new Error(result.error || `Request failed (${response.status})`);
  }
  return result.data as T;
}

export const accessApi = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
};
