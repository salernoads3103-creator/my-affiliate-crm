import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const invalidMessage =
  "VITE_SUPABASE_URL must be a valid HTTP(S) Supabase project base URL without a path, query, or fragment.";

export function validateSupabaseBuildUrl(value) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(invalidMessage);
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error(invalidMessage);
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(invalidMessage);
  }

  return url;
}

function validateBuildEnvironment() {
  try {
    validateSupabaseBuildUrl(process.env.VITE_SUPABASE_URL);
    console.info("[build config] VITE_SUPABASE_URL is valid.");
  } catch {
    console.error(
      "[build config] VITE_SUPABASE_URL is missing or invalid. Set it to the base Supabase project URL (for example, https://project.supabase.co).",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  validateBuildEnvironment();
}
