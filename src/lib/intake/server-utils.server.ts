type TrustedProxyHeader = "cf-connecting-ip" | "x-real-ip";

function getTrustedProxyHeader(): TrustedProxyHeader | null {
  const configured = process.env.LANDING_INTAKE_TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  if (configured === "cf-connecting-ip" || configured === "x-real-ip") return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("LANDING_INTAKE_TRUSTED_PROXY_HEADER is required in production");
  }
  return null;
}

export function getClientIpForRateLimit(request: Request): string {
  const header = getTrustedProxyHeader();
  return getClientIpFromTrustedHeader(request, header);
}

export function getClientIpFromTrustedHeader(
  request: Request,
  header: TrustedProxyHeader | null,
): string {
  if (!header) return "unknown";
  const value = request.headers.get(header)?.trim() ?? "";
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
