export type R2HealthResult =
  | { status: "connected" }
  | { status: "configuration_error" }
  | { status: "unreachable" }
  | { status: "unavailable" }
  | { status: "provider_rejected"; providerStatus: number; requestId?: string };
