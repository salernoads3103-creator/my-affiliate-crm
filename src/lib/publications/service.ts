import { ApiError } from "@/lib/api-error";
import { extractStaticLandingFiles, type StaticLandingFile } from "@/lib/landings/archive";
import { sha256Hex } from "@/lib/landings/fingerprint";
import type { LandingR2Store } from "./r2.server";

export type PublicationOperationStatus =
  | "uploading"
  | "database_switched"
  | "completed"
  | "failed"
  | "recovery_required";

export type PublicationClaim = {
  operationId: string;
  targetVersionId: string;
  targetPrefix: string;
  versionNumber: number | null;
  status: PublicationOperationStatus;
  wasReplay: boolean;
  expectedCurrentVersionId: string | null;
};

export type PublicationClaimInput = {
  operationId: string;
  workspaceId: string;
  hostId: string;
  landingId: string;
  hostname: string;
  expectedCurrentVersionId: string | null;
  operationKind: "publish" | "rollback";
  idempotencyKeyHash: string;
  requestFingerprint: string;
  buildFingerprint: string | null;
  zipFingerprint: string | null;
  targetVersionId: string | null;
  createdByUserId: string;
};

export type ExistingPublicationOperation = {
  id: string;
  landingId: string;
  operationKind: "publish" | "rollback";
  requestFingerprint: string;
  expectedCurrentVersionId: string | null;
  targetVersionId: string;
  status: PublicationOperationStatus;
};

export interface PublicationRepository {
  getCurrentVersionId(workspaceId: string, hostId: string): Promise<string | null>;
  getVersionPrefix(workspaceId: string, hostId: string, versionId: string): Promise<string | null>;
  claim(input: PublicationClaimInput): Promise<PublicationClaim>;
  findOperation(
    workspaceId: string,
    hostId: string,
    idempotencyKeyHash: string,
  ): Promise<ExistingPublicationOperation | null>;
  getOperationStatus(operationId: string): Promise<PublicationOperationStatus | null>;
  advance(operationId: string): Promise<void>;
  complete(operationId: string): Promise<void>;
  fail(operationId: string): Promise<void>;
  requireRecovery(operationId: string): Promise<void>;
}

export type PreparedPublicationArchive = {
  bytes: Uint8Array;
  buildFingerprint: string;
};

export type PublishLandingInput = {
  workspaceId: string;
  hostId: string;
  landingId: string;
  hostname: string;
  idempotencyKeyHash: string;
  createdByUserId: string;
};

export type PublicationResult = {
  hostname: string;
  versionId: string;
  versionNumber: number | null;
  url: string;
  replayed: boolean;
};

function manifestKey(hostname: string): string {
  return `host-manifests/${hostname}.json`;
}

function readSitePrefix(manifest: string | null): string | null {
  if (manifest === null) return null;
  try {
    const parsed: unknown = JSON.parse(manifest);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "sitePrefix" in parsed &&
      typeof parsed.sitePrefix === "string"
    ) {
      return parsed.sitePrefix;
    }
  } catch {
    // The caller treats an invalid manifest as an unknown state and stops.
  }
  return "!invalid!";
}

async function assertManifestMatches(
  storage: LandingR2Store,
  hostname: string,
  expectedPrefix: string | null,
  targetPrefix?: string,
): Promise<void> {
  const currentPrefix = readSitePrefix(await storage.readText(manifestKey(hostname), 4_096));
  if (currentPrefix !== expectedPrefix && currentPrefix !== targetPrefix) {
    throw new ApiError(
      409,
      "The published site state differs from the database. Publication is paused for recovery.",
      "CONFLICT",
    );
  }
}

async function uploadFiles(
  storage: LandingR2Store,
  prefix: string,
  files: StaticLandingFile[],
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, files.length) }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= files.length) return;
      const file = files[index];
      const key = `${prefix}${file.path}`;
      const digest = await sha256Hex(file.bytes);
      await storage.put(key, file.bytes, file.contentType, digest);
      const stored = await storage.head(key);
      if (!stored || stored.size !== file.bytes.byteLength || stored.sha256 !== digest) {
        throw new ApiError(502, "A landing file could not be verified in object storage");
      }
    }
  });
  const outcomes = await Promise.allSettled(workers);
  const failure = outcomes.find((outcome) => outcome.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

async function writeManifestAndConfirm(
  storage: LandingR2Store,
  hostname: string,
  expectedPrefix: string | null,
  targetPrefix: string,
): Promise<void> {
  const key = manifestKey(hostname);
  const content = new TextEncoder().encode(JSON.stringify({ sitePrefix: targetPrefix }));
  const digest = await sha256Hex(content);
  const currentPrefix = readSitePrefix(await storage.readText(key, 4_096));
  if (currentPrefix === targetPrefix) return;
  if (currentPrefix !== expectedPrefix) {
    throw new ApiError(409, "The published site state differs from the database", "CONFLICT");
  }

  try {
    await storage.put(key, content, "application/json; charset=utf-8", digest);
  } catch {
    // A timeout may occur after R2 has committed the atomic object replacement.
    const afterTimeout = readSitePrefix(await storage.readText(key, 4_096));
    if (afterTimeout === targetPrefix) return;
    if (afterTimeout !== expectedPrefix) {
      throw new ApiError(503, "Publication result is unknown; retry with the same idempotency key");
    }
    await storage.put(key, content, "application/json; charset=utf-8", digest);
  }

  const confirmedPrefix = readSitePrefix(await storage.readText(key, 4_096));
  if (confirmedPrefix !== targetPrefix) {
    throw new ApiError(
      503,
      "Publication could not be confirmed; retry with the same idempotency key",
    );
  }
}

async function completeOrRecover(
  repository: PublicationRepository,
  operationId: string,
): Promise<void> {
  try {
    await repository.complete(operationId);
  } catch (error) {
    const status = await repository.getOperationStatus(operationId).catch(() => null);
    if (status !== "completed") {
      await repository.requireRecovery(operationId).catch(() => undefined);
      throw error;
    }
  }
}

async function advanceOrRecover(
  repository: PublicationRepository,
  operationId: string,
  hostId: string,
  workspaceId: string,
  targetVersionId: string,
): Promise<void> {
  const currentVersionId = await repository.getCurrentVersionId(workspaceId, hostId);
  if (currentVersionId === targetVersionId) return;
  try {
    await repository.advance(operationId);
  } catch (error) {
    const [status, currentAfter] = await Promise.all([
      repository.getOperationStatus(operationId).catch(() => null),
      repository.getCurrentVersionId(workspaceId, hostId).catch(() => null),
    ]);
    if (
      status === "database_switched" ||
      status === "completed" ||
      currentAfter === targetVersionId
    ) {
      return;
    }
    if (status === "uploading" || status === "recovery_required") throw error;
    await repository.requireRecovery(operationId).catch(() => undefined);
    throw new ApiError(
      503,
      "Database publication state is unknown; retry with the same idempotency key",
    );
  }
}

async function publishClaimedOperation(
  dependencies: {
    repository: PublicationRepository;
    storage: LandingR2Store;
    getPreparedArchive: () => Promise<PreparedPublicationArchive>;
  },
  claim: PublicationClaim,
  input: PublishLandingInput & { operationKind: "publish" | "rollback" },
  expectedPrefix: string | null,
  buildFingerprint: string,
): Promise<PublicationResult> {
  if (claim.status === "failed") {
    throw new ApiError(409, "This publication attempt failed; start a new attempt", "CONFLICT");
  }
  if (claim.status === "completed") {
    return {
      hostname: input.hostname,
      versionId: claim.targetVersionId,
      versionNumber: claim.versionNumber,
      url: `https://${input.hostname}`,
      replayed: true,
    };
  }

  let stage: "preflight" | "archive_validation" | "upload" | "database_switch" | "manifest" =
    "preflight";
  try {
    await assertManifestMatches(
      dependencies.storage,
      input.hostname,
      expectedPrefix,
      claim.status === "database_switched" || claim.status === "recovery_required"
        ? claim.targetPrefix
        : undefined,
    );
    const currentVersionId = await dependencies.repository.getCurrentVersionId(
      input.workspaceId,
      input.hostId,
    );
    if (
      currentVersionId !== claim.targetVersionId &&
      input.operationKind === "publish" &&
      claim.status !== "recovery_required" &&
      claim.status !== "database_switched"
    ) {
      const prepared = await dependencies.getPreparedArchive();
      if (prepared.buildFingerprint !== buildFingerprint) {
        throw new ApiError(409, "The adapted ZIP changed during publication", "CONFLICT");
      }
      stage = "archive_validation";
      const files = await extractStaticLandingFiles(prepared.bytes);
      stage = "upload";
      await uploadFiles(dependencies.storage, claim.targetPrefix, files);
    } else if (currentVersionId !== claim.targetVersionId) {
      const index = await dependencies.storage.head(`${claim.targetPrefix}index.html`);
      if (!index) {
        throw new ApiError(409, "The selected version files are unavailable in R2", "CONFLICT");
      }
    }

    stage = "database_switch";
    await advanceOrRecover(
      dependencies.repository,
      claim.operationId,
      input.hostId,
      input.workspaceId,
      claim.targetVersionId,
    );
    stage = "manifest";
    await writeManifestAndConfirm(
      dependencies.storage,
      input.hostname,
      expectedPrefix,
      claim.targetPrefix,
    );
    await completeOrRecover(dependencies.repository, claim.operationId);
    return {
      hostname: input.hostname,
      versionId: claim.targetVersionId,
      versionNumber: claim.versionNumber,
      url: `https://${input.hostname}`,
      replayed: claim.wasReplay,
    };
  } catch (error) {
    const status = await dependencies.repository
      .getOperationStatus(claim.operationId)
      .catch(() => null);
    if (status === "database_switched") {
      await dependencies.repository.requireRecovery(claim.operationId).catch(() => undefined);
      throw error;
    }
    if (status === "recovery_required") {
      const currentVersionId = await dependencies.repository
        .getCurrentVersionId(input.workspaceId, input.hostId)
        .catch(() => undefined);
      if (currentVersionId === claim.expectedCurrentVersionId) {
        await dependencies.repository.fail(claim.operationId).catch(() => undefined);
      } else {
        await dependencies.repository.requireRecovery(claim.operationId).catch(() => undefined);
      }
      throw error;
    }
    if (status === "uploading") {
      if (stage === "upload") {
        // A failed PUT can have committed before its response timed out. Keep
        // this immutable prefix retryable with the same idempotency key; a
        // competing retry writes identical bytes to the same object keys.
        throw error;
      }
      await dependencies.repository.fail(claim.operationId).catch(() => undefined);
    }
    throw error;
  }
}

export async function publishLanding(
  dependencies: {
    repository: PublicationRepository;
    storage: LandingR2Store;
    getPreparedArchive: () => Promise<PreparedPublicationArchive>;
  },
  input: PublishLandingInput,
): Promise<PublicationResult> {
  const prepared = await dependencies.getPreparedArchive();
  const zipFingerprint = await sha256Hex(prepared.bytes);
  const requestFingerprint = await sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        operationKind: "publish",
        workspaceId: input.workspaceId,
        hostId: input.hostId,
        landingId: input.landingId,
        buildFingerprint: prepared.buildFingerprint,
        zipFingerprint,
      }),
    ),
  );
  const expectedCurrentVersionId = await dependencies.repository.getCurrentVersionId(
    input.workspaceId,
    input.hostId,
  );

  const claim = await dependencies.repository.claim({
    ...input,
    operationId: crypto.randomUUID(),
    operationKind: "publish",
    expectedCurrentVersionId,
    requestFingerprint,
    buildFingerprint: prepared.buildFingerprint,
    zipFingerprint,
    targetVersionId: null,
  });
  const expectedPrefix = claim.expectedCurrentVersionId
    ? await dependencies.repository.getVersionPrefix(
        input.workspaceId,
        input.hostId,
        claim.expectedCurrentVersionId,
      )
    : null;
  if (claim.expectedCurrentVersionId && !expectedPrefix) {
    throw new ApiError(409, "The current publication could not be verified", "CONFLICT");
  }
  return publishClaimedOperation(
    { ...dependencies, getPreparedArchive: async () => prepared },
    claim,
    { ...input, operationKind: "publish" },
    expectedPrefix,
    prepared.buildFingerprint,
  );
}

export async function resumeLandingPublication(
  dependencies: { repository: PublicationRepository; storage: LandingR2Store },
  input: PublishLandingInput,
  existing: ExistingPublicationOperation,
): Promise<PublicationResult> {
  const claim = await dependencies.repository.claim({
    operationId: crypto.randomUUID(),
    workspaceId: input.workspaceId,
    hostId: input.hostId,
    landingId: input.landingId,
    hostname: input.hostname,
    expectedCurrentVersionId: existing.expectedCurrentVersionId,
    operationKind: "publish",
    idempotencyKeyHash: input.idempotencyKeyHash,
    requestFingerprint: existing.requestFingerprint,
    buildFingerprint: null,
    zipFingerprint: null,
    targetVersionId: null,
    createdByUserId: input.createdByUserId,
  });
  const expectedPrefix = claim.expectedCurrentVersionId
    ? await dependencies.repository.getVersionPrefix(
        input.workspaceId,
        input.hostId,
        claim.expectedCurrentVersionId,
      )
    : null;
  if (claim.expectedCurrentVersionId && !expectedPrefix) {
    throw new ApiError(409, "The previous publication could not be verified", "CONFLICT");
  }
  return publishClaimedOperation(
    {
      ...dependencies,
      getPreparedArchive: async () => {
        throw new ApiError(409, "This publication is resuming; no source ZIP is needed");
      },
    },
    claim,
    { ...input, operationKind: "publish" },
    expectedPrefix,
    "",
  );
}

export async function rollbackLandingPublication(
  dependencies: { repository: PublicationRepository; storage: LandingR2Store },
  input: PublishLandingInput & { targetVersionId: string },
): Promise<PublicationResult> {
  const expectedCurrentVersionId = await dependencies.repository.getCurrentVersionId(
    input.workspaceId,
    input.hostId,
  );
  if (!expectedCurrentVersionId) {
    throw new ApiError(409, "This hostname has no active publication to roll back", "CONFLICT");
  }
  const targetPrefix = await dependencies.repository.getVersionPrefix(
    input.workspaceId,
    input.hostId,
    input.targetVersionId,
  );
  if (!targetPrefix) {
    throw new ApiError(404, "Publication version not found", "NOT_FOUND");
  }
  const index = await dependencies.storage.head(`${targetPrefix}index.html`);
  if (!index)
    throw new ApiError(409, "The selected version files are unavailable in R2", "CONFLICT");
  const requestFingerprint = await sha256Hex(
    new TextEncoder().encode(
      JSON.stringify({
        operationKind: "rollback",
        workspaceId: input.workspaceId,
        hostId: input.hostId,
        landingId: input.landingId,
        targetVersionId: input.targetVersionId,
      }),
    ),
  );
  const claim = await dependencies.repository.claim({
    ...input,
    operationId: crypto.randomUUID(),
    operationKind: "rollback",
    expectedCurrentVersionId,
    requestFingerprint,
    buildFingerprint: null,
    zipFingerprint: null,
    targetVersionId: input.targetVersionId,
  });
  const expectedPrefix = claim.expectedCurrentVersionId
    ? await dependencies.repository.getVersionPrefix(
        input.workspaceId,
        input.hostId,
        claim.expectedCurrentVersionId,
      )
    : null;
  if (!expectedPrefix) {
    throw new ApiError(409, "The current publication could not be verified", "CONFLICT");
  }
  return publishClaimedOperation(
    {
      ...dependencies,
      getPreparedArchive: async () => {
        throw new ApiError(500, "Rollback does not load a new landing archive", "INTERNAL_ERROR");
      },
    },
    claim,
    { ...input, operationKind: "rollback" },
    expectedPrefix,
    "",
  );
}
