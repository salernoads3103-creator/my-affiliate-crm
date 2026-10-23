import { ApiError } from "@/lib/api-error";

const INTAKE_PATH = "/api/v1/intake/leads";

/** Returns the public HTTPS intake endpoint embedded in adapted static archives. */
export function getPublicLandingIntakeEndpoint(
  configuredValue: string | undefined = process.env.CRMONIA_PUBLIC_INTAKE_API_URL,
): string | null {
  const value = configuredValue?.trim();
  if (!value) return null;

  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname.replace(/\/$/, "") !== INTAKE_PATH
    ) {
      throw new Error("Invalid intake URL");
    }
    endpoint.pathname = INTAKE_PATH;
    return endpoint.toString();
  } catch {
    throw new ApiError(
      500,
      "The public HTTPS intake API URL is not configured correctly",
      "INTERNAL_ERROR",
    );
  }
}
