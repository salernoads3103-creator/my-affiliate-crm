type TrustedProxyHeader = "cf-connecting-ip" | "x-forwarded-for";

export function resolveTrustedProxyHeader(
  configuredValue: string | undefined,
  isProduction: boolean,
): TrustedProxyHeader | null {
  const configured = configuredValue?.trim().toLowerCase();
  if (configured === "cf-connecting-ip" || configured === "x-forwarded-for") return configured;
  if (isProduction) {
    throw new Error(
      "LANDING_INTAKE_TRUSTED_PROXY_HEADER must be cf-connecting-ip or x-forwarded-for in production",
    );
  }
  if (configured) throw new Error("Unsupported LANDING_INTAKE_TRUSTED_PROXY_HEADER");
  return null;
}

export function getClientIpForRateLimit(request: Request): string {
  const header = resolveTrustedProxyHeader(
    process.env.LANDING_INTAKE_TRUSTED_PROXY_HEADER,
    process.env.NODE_ENV === "production",
  );
  const ip = getClientIpFromTrustedHeader(request, header);
  if (process.env.NODE_ENV === "production" && ip === "unknown") {
    throw new Error("The configured trusted proxy did not provide one valid client IP");
  }
  return ip;
}

export function getClientIpFromTrustedHeader(
  request: Request,
  header: TrustedProxyHeader | null,
): string {
  if (!header) return "unknown";
  const rawValue = request.headers.get(header)?.trim() ?? "";
  // Never choose an address from a forwarded chain: clients can supply entries
  // in X-Forwarded-For. Render uses Cloudflare's single-address client header;
  // a custom proxy must overwrite its configured header and send one address.
  if (!rawValue || rawValue.includes(",")) return "unknown";
  const value = rawValue;
  return isValidIpAddress(value) ? value.toLowerCase() : "unknown";
}

function isValidIpAddress(value: string): boolean {
  const octets = value.split(".");
  if (
    octets.length === 4 &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  ) {
    return true;
  }

  // URL parsing validates IPv6 literals without depending on Node-only modules.
  if (!value.includes(":") || !/^[\da-f:.]+$/i.test(value)) return false;
  try {
    const parsed = new URL(`http://[${value}]/`);
    return parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]");
  } catch {
    return false;
  }
}

export async function hashClientIpForRateLimit(request: Request): Promise<string> {
  const secret = process.env.LANDING_INTAKE_IP_HASH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("LANDING_INTAKE_IP_HASH_SECRET must contain at least 32 characters");
  }
  const ip = getClientIpForRateLimit(request);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
