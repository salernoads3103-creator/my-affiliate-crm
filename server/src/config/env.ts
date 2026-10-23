import { parseServerEnvironment } from "./env-schema";

const parsed = parseServerEnvironment(process.env);
if (!parsed.success) {
  console.error("[env] Invalid environment configuration:", parsed.errors);
  process.exit(1);
}

export const env = parsed.data;
