const DEVELOPMENT_CORS_ORIGINS = ["http://localhost:8080", "http://localhost:5173"] as const;

function isHttpOrigin(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.origin === value &&
      !parsed.username &&
      !parsed.password
    );
  } catch {
    return false;
  }
}

export function resolveCorsOrigins(raw: string | undefined, nodeEnv: string): string[] {
  const configured = (raw ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins =
    configured.length > 0
      ? configured
      : nodeEnv === "development"
        ? [...DEVELOPMENT_CORS_ORIGINS]
        : [];

  if (nodeEnv === "production" && origins.length === 0) {
    throw new Error("CORS_ORIGINS is required for the production Express API");
  }
  if (origins.some((origin) => !isHttpOrigin(origin))) {
    throw new Error("CORS_ORIGINS must contain exact HTTP(S) origins without paths or wildcards");
  }

  return [...new Set(origins)];
}

export function isCorsOriginAllowed(origin: string | undefined, allowedOrigins: readonly string[]) {
  return origin !== undefined && allowedOrigins.includes(origin);
}
