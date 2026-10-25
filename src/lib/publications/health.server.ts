import { ApiError } from "@/lib/api-error";
import type { R2HealthResult, R2ProbeResult } from "./health.types";

export type { R2HealthResult } from "./health.types";

// Existing static PoC asset; HEAD checks authorization without returning its contents.
export const R2_DIAGNOSTIC_OBJECT_KEY = "sites/landing-1/version-1/index.html";

export function isR2DiagnosticEndpointEnabled(env: Record<string, string | undefined>): boolean {
  return (
    env.RENDER === "true" &&
    env.RENDER_SERVICE_NAME === "crmonia-intake-api-test" &&
    env.RENDER_GIT_BRANCH === "develop" &&
    env.CRMONIA_R2_DIAGNOSTICS_ENABLED === "true"
  );
}

export async function runR2ReadOnlyHealthcheck(
  checkBucket: () => Promise<void>,
  checkTestObject: () => Promise<unknown | null>,
): Promise<R2HealthResult> {
  const [bucket, testObject] = await Promise.all([
    runProbe(checkBucket),
    runProbe(checkTestObject, true),
  ]);
  return { bucket, testObject };
}

async function runProbe(
  check: () => Promise<unknown>,
  missingIsExpected = false,
): Promise<R2ProbeResult> {
  try {
    const result = await check();
    return missingIsExpected && result === null ? { status: "not_found" } : { status: "connected" };
  } catch (error) {
    if (!(error instanceof ApiError) || !error.cause || typeof error.cause !== "object") {
      return { status: "unavailable" };
    }
    const cause = error.cause as Record<string, unknown>;
    if (cause.subsystem !== "cloudflare_r2") return { status: "unavailable" };
    if (cause.outcome === "configuration_error") return { status: "configuration_error" };
    if (cause.outcome === "network_error" || cause.outcome === "timeout") {
      return { status: "unreachable" };
    }
    if (cause.outcome === "http_error" && typeof cause.status === "number") {
      const requestId = cause.providerRequestId;
      const providerCode = cause.providerCode;
      return {
        status: "provider_rejected",
        providerStatus: cause.status,
        ...(typeof providerCode === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(providerCode)
          ? { providerCode }
          : {}),
        ...(typeof requestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(requestId)
          ? { requestId }
          : {}),
      };
    }
    return { status: "unavailable" };
  }
}
