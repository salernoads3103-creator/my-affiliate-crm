import { z } from "zod";

const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const RESERVED_SUFFIXES = new Set([
  "arpa",
  "example",
  "internal",
  "invalid",
  "local",
  "localhost",
  "onion",
  "test",
]);

export const DomainRouteIdSchema = z.string().uuid();

export const CreateDomainRequestSchema = z
  .object({ domainName: z.string().trim().min(1).max(253) })
  .strict();

export const BulkDomainHostsRequestSchema = z
  .object({ hostnames: z.string().max(160_000) })
  .strict();

export const DomainHostReservationRequestSchema = z
  .object({ landingId: z.string().uuid() })
  .strict();

export type BulkDomainLine = {
  lineNumber: number;
  input: string;
  hostname: string | null;
  error: "invalid" | "outside_domain" | null;
};

export function normalizePublicHostname(value: string): string | null {
  const input = value.trim().replace(/\.$/, "");
  if (
    !input ||
    input.length > 253 ||
    /[\s/:@?#%\\]/.test(input) ||
    !/^[\p{L}\p{N}.-]+$/u.test(input)
  ) {
    return null;
  }

  let hostname: string;
  try {
    const parsed = new URL(`https://${input}`);
    if (parsed.username || parsed.password || parsed.port || parsed.pathname !== "/") return null;
    hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }

  if (hostname.length > 253 || hostname.includes(":")) return null;
  const labels = hostname.split(".");
  if (labels.length < 2 || labels.some((label) => !DOMAIN_LABEL.test(label))) return null;
  const tld = labels.at(-1);
  if (!tld || /^\d+$/.test(tld) || RESERVED_SUFFIXES.has(tld)) return null;

  // WHATWG URL parsing canonicalizes shorthand and integer IPv4 forms.
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return null;
  return hostname;
}

export function normalizeDomainName(value: string): string | null {
  return normalizePublicHostname(value);
}

export function normalizeSubdomainInput(
  input: string,
  apexDomain: string,
): BulkDomainLine["hostname"] | null {
  const value = input.trim();
  if (!value) return null;

  const hostname = normalizePublicHostname(value.includes(".") ? value : `${value}.${apexDomain}`);
  if (!hostname || hostname === apexDomain || !hostname.endsWith(`.${apexDomain}`)) return null;
  return hostname;
}

export function parseBulkDomainHostnames(text: string, apexDomain: string): BulkDomainLine[] {
  const lines = text.split(/\r?\n/);
  if (lines.filter((line) => line.trim()).length > 500) {
    throw new Error("A batch can contain at most 500 hostnames");
  }
  const results: BulkDomainLine[] = [];
  for (const [index, input] of lines.entries()) {
    const trimmed = input.trim();
    if (!trimmed) continue;

    const hostname = normalizeSubdomainInput(trimmed, apexDomain);
    if (hostname) {
      results.push({ lineNumber: index + 1, input: trimmed, hostname, error: null });
      continue;
    }

    const parsed = normalizePublicHostname(trimmed);
    results.push({
      lineNumber: index + 1,
      input: trimmed,
      hostname: null,
      error: parsed ? "outside_domain" : "invalid",
    });
  }
  return results;
}
