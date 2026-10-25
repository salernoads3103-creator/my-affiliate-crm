export type R2ProbeResult =
  | { status: "connected" }
  | { status: "not_found" }
  | { status: "configuration_error" }
  | { status: "unreachable" }
  | { status: "unavailable" }
  | {
      status: "provider_rejected";
      providerStatus: number;
      providerCode?: string;
      requestId?: string;
    };

export type R2HealthResult = {
  bucket: R2ProbeResult;
  testObject: R2ProbeResult;
};
