import { ApiError } from "@/lib/api-error";

export type OfferLaunchStage =
  | "offer_created"
  | "landing_created"
  | "adapter_prepared"
  | "published";

export type OfferLaunchErrorCode =
  | "LANDING_ARCHIVE_UNAVAILABLE"
  | "LANDING_ADAPTATION_REQUIRED"
  | "INTAKE_API_NOT_CONFIGURED"
  | "DOMAIN_CONFLICT"
  | "DOMAIN_NOT_READY"
  | "PUBLICATION_CONFLICT"
  | "PUBLICATION_FAILED"
  | "INTERNAL_ERROR";

export type OfferLaunchState = {
  id: string;
  workspace_id: string;
  offer_id: string;
  offer_name: string;
  product_id: string;
  domain_host_id: string;
  stage: OfferLaunchStage;
  publication_attempt: number;
  publication_version_id: string | null;
  published_url: string | null;
  last_error_code: OfferLaunchErrorCode | null;
};

export type OfferLaunchResult = {
  launchId: string;
  offerId: string;
  landingId: string;
  offerName: string;
  hostname: string | null;
  stage: OfferLaunchStage;
  lastErrorCode: OfferLaunchErrorCode | null;
  url: string | null;
};

function safeErrorType(error: unknown): string {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : "UnknownError";
}

export type OfferLaunchWorkflowPort = {
  get: (workspaceId: string, launchId: string) => Promise<OfferLaunchState | null>;
  ensureLanding: (launch: OfferLaunchState) => Promise<void>;
  changeHostname: (launch: OfferLaunchState, hostId: string) => Promise<void>;
  reserveHostname: (launch: OfferLaunchState) => Promise<void>;
  prepareAdapter: (
    launch: OfferLaunchState,
  ) => Promise<
    "prepared" | { blocked: "LANDING_ADAPTATION_REQUIRED" | "INTAKE_API_NOT_CONFIGURED" }
  >;
  publish: (launch: OfferLaunchState) => Promise<{ versionId: string; url: string }>;
  advance: (launch: OfferLaunchState, stage: OfferLaunchStage) => Promise<void>;
  complete: (
    launch: OfferLaunchState,
    publication: { versionId: string; url: string },
  ) => Promise<void>;
  recordError: (launch: OfferLaunchState, code: OfferLaunchErrorCode) => Promise<void>;
  hostname: (workspaceId: string, hostId: string) => Promise<string | null>;
};

export async function withOfferLaunchLeaseHeartbeat<T>(
  input: {
    workspaceId: string;
    launchId: string;
    renew: () => Promise<void>;
    intervalMs?: number;
  },
  action: () => Promise<T>,
): Promise<T> {
  const intervalMs = input.intervalMs ?? 60_000;
  await input.renew();
  let pendingRenewal: Promise<void> | null = null;
  let renewalFailed = false;
  const timer = setInterval(() => {
    if (pendingRenewal) return;
    const renewal = Promise.resolve()
      .then(input.renew)
      .catch((error: unknown) => {
        renewalFailed = true;
        console.warn("[offer-launch] lease_renewal_failed", {
          workspaceId: input.workspaceId,
          launchId: input.launchId,
          ...(error instanceof ApiError
            ? { httpStatus: error.status, apiCode: error.code }
            : { errorType: safeErrorType(error) }),
        });
      })
      .finally(() => {
        if (pendingRenewal === renewal) pendingRenewal = null;
      });
    pendingRenewal = renewal;
  }, intervalMs);

  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try {
    outcome = { ok: true, value: await action() };
  } catch (error) {
    outcome = { ok: false, error };
  } finally {
    clearInterval(timer);
    if (pendingRenewal) await pendingRenewal;
  }

  if (!outcome.ok) throw outcome.error;
  if (renewalFailed) {
    throw new ApiError(
      409,
      "The offer launch lease could not be renewed; continue the saved launch to resume safely",
      "CONFLICT",
    );
  }
  return outcome.value;
}

export function launchRequestFingerprint(input: {
  workspaceId: string;
  productId: string;
  offerName: string;
  offerPriceMinor: number;
  sourceArchiveSha256: string;
  tracking: {
    tiktokProfileId: string | null;
    tiktokPixelId: string | null;
    googleAdsProfileId: string | null;
    googleAdsConversionId: string | null;
    googleAdsConversionLabel: string | null;
  };
}): Promise<string> {
  const canonical = JSON.stringify({ version: 1, ...input });
  return globalThis.crypto.subtle
    .digest("SHA-256", new TextEncoder().encode(canonical))
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(""),
    );
}

function safeErrorCode(
  error: unknown,
  step: "landing" | "domain" | "adapter" | "publication",
): OfferLaunchErrorCode {
  if (error instanceof OfferLaunchStepError) return error.launchErrorCode;
  if (step === "landing") return "LANDING_ARCHIVE_UNAVAILABLE";
  if (step === "domain") {
    return error instanceof ApiError && error.code === "CONFLICT"
      ? "DOMAIN_CONFLICT"
      : "DOMAIN_NOT_READY";
  }
  if (step === "adapter") {
    if (error instanceof OfferLaunchStepError) return error.launchErrorCode;
    return error instanceof ApiError && error.status < 500
      ? "LANDING_ADAPTATION_REQUIRED"
      : "INTERNAL_ERROR";
  }
  if (error instanceof ApiError && error.code === "CONFLICT") return "PUBLICATION_CONFLICT";
  return error instanceof ApiError && error.status >= 500
    ? "PUBLICATION_FAILED"
    : "PUBLICATION_CONFLICT";
}

export class OfferLaunchStepError extends ApiError {
  constructor(
    readonly launchErrorCode:
      | "LANDING_ADAPTATION_REQUIRED"
      | "INTAKE_API_NOT_CONFIGURED"
      | "DOMAIN_NOT_READY",
  ) {
    super(
      409,
      launchErrorCode === "INTAKE_API_NOT_CONFIGURED"
        ? "The public Intake API is not configured"
        : launchErrorCode === "DOMAIN_NOT_READY"
          ? "DNS and HTTPS need a fresh successful check before publication can continue"
          : "This landing form needs adaptation before it can be published",
      "CONFLICT",
    );
    this.name = "OfferLaunchStepError";
  }
}

function toResult(launch: OfferLaunchState, hostname: string | null): OfferLaunchResult {
  const published = launch.stage === "published" && launch.published_url !== null;
  return {
    launchId: launch.id,
    offerId: launch.offer_id,
    landingId: launch.id,
    offerName: launch.offer_name,
    hostname,
    stage: launch.stage,
    lastErrorCode: launch.last_error_code,
    // Never expose a URL until the publication transaction completed.
    url: published ? launch.published_url : null,
  };
}

export async function continueOfferLaunch(
  workspaceId: string,
  launchId: string,
  port: OfferLaunchWorkflowPort,
  requestedHostId?: string,
): Promise<OfferLaunchResult> {
  let launch = await port.get(workspaceId, launchId);
  if (!launch) throw new ApiError(404, "Offer launch was not found", "NOT_FOUND");

  if (launch.stage === "published") {
    return toResult(launch, await port.hostname(workspaceId, launch.domain_host_id));
  }

  let step: "landing" | "domain" | "adapter" | "publication" = "landing";
  try {
    if (launch.stage === "offer_created") {
      await port.ensureLanding(launch);
      await port.advance(launch, "landing_created");
      launch = { ...launch, stage: "landing_created", last_error_code: null };
    }

    step = "domain";
    if (requestedHostId && requestedHostId !== launch.domain_host_id) {
      await port.changeHostname(launch, requestedHostId);
      launch = { ...launch, domain_host_id: requestedHostId, last_error_code: null };
    }
    await port.reserveHostname(launch);

    if (launch.stage === "landing_created") {
      step = "adapter";
      const adapter = await port.prepareAdapter(launch);
      if (adapter !== "prepared") {
        throw new OfferLaunchStepError(adapter.blocked);
      }
      await port.advance(launch, "adapter_prepared");
      launch = { ...launch, stage: "adapter_prepared", last_error_code: null };
    }

    step = "publication";
    const publication = await port.publish(launch);
    await port.complete(launch, publication);
    launch = {
      ...launch,
      stage: "published",
      publication_version_id: publication.versionId,
      published_url: publication.url,
      last_error_code: null,
    };
    return toResult(launch, await port.hostname(workspaceId, launch.domain_host_id));
  } catch (error) {
    const errorCode = safeErrorCode(error, step);
    console.warn("[offer-launch] step_failed", {
      workspaceId: launch.workspace_id,
      launchId: launch.id,
      failedAtStep: step,
      savedStage: launch.stage,
      errorCode,
      ...(error instanceof ApiError
        ? { httpStatus: error.status, apiCode: error.code }
        : { errorType: safeErrorType(error) }),
    });
    await port.recordError(launch, errorCode).catch(() => undefined);
    throw error;
  }
}

export function offerLaunchStageProgress(stage: OfferLaunchStage): number {
  switch (stage) {
    case "offer_created":
      return 1;
    case "landing_created":
      return 2;
    case "adapter_prepared":
      return 3;
    case "published":
      return 4;
  }
}
