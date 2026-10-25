import { ApiError } from "@/lib/api-error";
import type { DomainHostProbeResult } from "./types";

export type ReservableHost = {
  id: string;
  workspaceId: string;
  hostname: string;
  status: "available" | "reserved" | "disabled";
  reservedLandingId: string | null;
};

export type ReservationDependencies = {
  getHost: (workspaceId: string, hostId: string) => Promise<ReservableHost | null>;
  verify: (host: ReservableHost) => Promise<DomainHostProbeResult>;
  reserve: (workspaceId: string, hostId: string, landingId: string) => Promise<void>;
};

export async function reserveHostWithVerification(
  input: { workspaceId: string; hostId: string; landingId: string },
  dependencies: ReservationDependencies,
): Promise<{ reserved: true; alreadyReserved: boolean }> {
  const host = await dependencies.getHost(input.workspaceId, input.hostId);
  if (!host || host.workspaceId !== input.workspaceId) {
    throw new ApiError(404, "Domain address not found", "NOT_FOUND");
  }

  if (host.status === "reserved" && host.reservedLandingId === input.landingId) {
    return { reserved: true, alreadyReserved: true };
  }
  if (host.status !== "available") {
    throw new ApiError(409, "Domain address is not available", "CONFLICT");
  }

  const probe = await dependencies.verify(host);
  if (!probe.ready) {
    throw new ApiError(409, "DNS and HTTPS could not be confirmed for this address", "CONFLICT");
  }

  await dependencies.reserve(input.workspaceId, input.hostId, input.landingId);
  return { reserved: true, alreadyReserved: false };
}
