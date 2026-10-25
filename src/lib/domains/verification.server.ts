import { normalizePublicHostname } from "./validation";
import type { DomainHostProbeResult } from "./types";

export type HttpsProbeFetch = (input: string, init: RequestInit) => Promise<Response>;

/**
 * Confirms that the exact hostname resolves and completes an HTTPS request.
 * Redirects are not followed and response bodies are never read.
 */
export async function probeDomainHttps(
  hostname: string,
  fetcher: HttpsProbeFetch = fetch,
  timeoutMs = 5_000,
): Promise<DomainHostProbeResult> {
  const normalized = normalizePublicHostname(hostname);
  if (!normalized || normalized !== hostname.toLowerCase()) {
    return { ready: false, errorCode: "DNS_OR_HTTPS_UNAVAILABLE" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetcher(`https://${normalized}/`, {
      method: "HEAD",
      redirect: "manual",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: controller.signal,
    });
    await response.body?.cancel();
    return { ready: true, errorCode: null };
  } catch {
    return {
      ready: false,
      errorCode: controller.signal.aborted ? "TIMEOUT" : "DNS_OR_HTTPS_UNAVAILABLE",
    };
  } finally {
    clearTimeout(timeout);
  }
}
