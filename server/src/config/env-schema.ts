import { z } from "zod";
import { resolveCorsOrigins } from "./cors";

const Schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(4000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(10),
  CORS_ORIGINS: z.string().optional(),
});

type ServerEnvironment = Omit<z.infer<typeof Schema>, "CORS_ORIGINS"> & {
  CORS_ORIGINS: string[];
};

type ServerEnvironmentResult =
  | { success: true; data: ServerEnvironment }
  | { success: false; errors: Record<string, string[]> };

export function parseServerEnvironment(input: Record<string, unknown>): ServerEnvironmentResult {
  const parsed = Schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      errors: Object.fromEntries(
        Object.entries(fieldErrors).map(([key, messages]) => [key, messages ?? []]),
      ),
    };
  }

  try {
    return {
      success: true,
      data: {
        ...parsed.data,
        CORS_ORIGINS: resolveCorsOrigins(parsed.data.CORS_ORIGINS, parsed.data.NODE_ENV),
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid CORS configuration";
    return { success: false, errors: { CORS_ORIGINS: [message] } };
  }
}
