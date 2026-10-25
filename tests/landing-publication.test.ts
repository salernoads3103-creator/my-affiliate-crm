import { describe, expect, it } from "bun:test";
import { ApiError } from "../src/lib/api-error";
import { extractStaticLandingFiles } from "../src/lib/landings/archive";
import {
  publishLanding,
  resumeLandingPublication,
  rollbackLandingPublication,
} from "../src/lib/publications/service";
import type {
  PublicationClaim,
  PublicationClaimInput,
  PublicationOperationStatus,
  PublicationRepository,
} from "../src/lib/publications/service";
import type { LandingR2Store, R2ObjectHead } from "../src/lib/publications/r2.server";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const hostId = "22222222-2222-4222-8222-222222222222";
const landingId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const hostname = "shop.example.test";
const buildFingerprint = "a".repeat(64);

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(files: Array<{ path: string; value: string }>): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(file.path);
    const body = encoder.encode(file.value);
    const crc = crc32(body);
    const local = new Uint8Array(30 + name.byteLength + body.byteLength);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, body.byteLength, true);
    localView.setUint32(22, body.byteLength, true);
    localView.setUint16(26, name.byteLength, true);
    local.set(name, 30);
    local.set(body, 30 + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 0x0314, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, body.byteLength, true);
    centralView.setUint32(24, body.byteLength, true);
    centralView.setUint16(28, name.byteLength, true);
    centralView.setUint32(38, (0o100644 << 16) >>> 0, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.byteLength;
  }
  const centralSize = centrals.reduce((sum, record) => sum + record.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + end.byteLength);
  let cursor = 0;
  for (const record of [...locals, ...centrals, end]) {
    result.set(record, cursor);
    cursor += record.byteLength;
  }
  return result;
}

class MemoryR2 implements LandingR2Store {
  readonly objects = new Map<string, { body: Uint8Array; sha256: string }>();
  failNextSitePut = false;
  timeoutAfterSitePut = false;
  timeoutAfterManifestPut = false;
  failManifestWrites = 0;

  async put(key: string, bytes: Uint8Array, _contentType: string, digest: string): Promise<void> {
    if (key.startsWith("host-manifests/") && this.failManifestWrites > 0) {
      this.failManifestWrites -= 1;
      throw new Error("Mock R2 manifest failure");
    }
    if (this.failNextSitePut && !key.startsWith("host-manifests/")) {
      this.failNextSitePut = false;
      throw new Error("Mock R2 upload failure");
    }
    this.objects.set(key, { body: bytes.slice(), sha256: digest });
    if (!key.startsWith("host-manifests/") && this.timeoutAfterSitePut) {
      this.timeoutAfterSitePut = false;
      throw new Error("Mock response timeout after R2 committed a landing file");
    }
    if (key.startsWith("host-manifests/") && this.timeoutAfterManifestPut) {
      this.timeoutAfterManifestPut = false;
      throw new Error("Mock response timeout after R2 committed the manifest");
    }
  }

  async head(key: string): Promise<R2ObjectHead | null> {
    const object = this.objects.get(key);
    return object ? { size: object.body.byteLength, sha256: object.sha256 } : null;
  }

  async readText(key: string, maxBytes: number): Promise<string | null> {
    const object = this.objects.get(key);
    if (!object) return null;
    if (object.body.byteLength > maxBytes) throw new Error("Oversize test object");
    return new TextDecoder().decode(object.body);
  }
}

class MemoryPublicationRepository implements PublicationRepository {
  currentVersionId: string | null = null;
  readonly versions = new Map<
    string,
    { prefix: string; versionNumber: number; status: "completed" | "pending" }
  >();
  readonly operations = new Map<
    string,
    {
      claim: PublicationClaim;
      status: PublicationOperationStatus;
      expected: string | null;
      requestFingerprint: string;
    }
  >();
  readonly idempotency = new Map<string, string>();
  nextVersion = 1;
  hostname = hostname;
  ownerWorkspaceId = workspaceId;
  ready = true;
  foreignReservation = false;

  async getCurrentVersionId(requestedWorkspaceId: string, requestedHostId: string) {
    this.assertHost(requestedWorkspaceId, requestedHostId);
    return this.currentVersionId;
  }

  async getVersionPrefix(_workspaceId: string, _hostId: string, versionId: string) {
    return this.versions.get(versionId)?.prefix ?? null;
  }

  async claim(input: PublicationClaimInput): Promise<PublicationClaim> {
    this.assertHost(input.workspaceId, input.hostId);
    if (!this.ready || this.foreignReservation)
      throw new ApiError(409, "Host unavailable", "CONFLICT");
    const key = `${input.hostId}:${input.idempotencyKeyHash}`;
    const previousOperationId = this.idempotency.get(key);
    if (previousOperationId) {
      const operation = this.operations.get(previousOperationId)!;
      if (operation.requestFingerprint !== input.requestFingerprint) {
        throw new ApiError(409, "Idempotency fingerprint mismatch", "CONFLICT");
      }
      if (operation.claim.targetVersionId) {
        return {
          ...operation.claim,
          wasReplay: true,
          status: operation.status,
          expectedCurrentVersionId: operation.expected,
        };
      }
    }
    if (input.expectedCurrentVersionId !== this.currentVersionId) {
      throw new ApiError(409, "Publication changed", "CONFLICT");
    }
    const versionId = input.targetVersionId ?? crypto.randomUUID();
    let prefix = this.versions.get(versionId)?.prefix;
    let versionNumber: number | null = null;
    if (input.operationKind === "publish") {
      versionNumber = this.nextVersion++;
      prefix = `crmonia/landing-sites/${workspaceId}/${hostId}/${versionId}/`;
      this.versions.set(versionId, { prefix, versionNumber, status: "pending" });
    }
    if (!prefix) throw new ApiError(404, "Target version unavailable", "NOT_FOUND");
    const claim: PublicationClaim = {
      operationId: input.operationId,
      targetVersionId: versionId,
      targetPrefix: prefix,
      versionNumber,
      status: "uploading",
      wasReplay: false,
      expectedCurrentVersionId: input.expectedCurrentVersionId,
    };
    this.operations.set(input.operationId, {
      claim,
      status: "uploading",
      expected: input.expectedCurrentVersionId,
      requestFingerprint: input.requestFingerprint,
    });
    this.idempotency.set(key, input.operationId);
    return claim;
  }

  async findOperation(_workspaceId: string, requestedHostId: string, keyHash: string) {
    const operationId = this.idempotency.get(`${requestedHostId}:${keyHash}`);
    if (!operationId) return null;
    const operation = this.operations.get(operationId)!;
    return {
      id: operationId,
      landingId,
      operationKind: "publish" as const,
      requestFingerprint: operation.requestFingerprint,
      expectedCurrentVersionId: operation.expected,
      targetVersionId: operation.claim.targetVersionId,
      status: operation.status,
    };
  }

  async getOperationStatus(operationId: string) {
    return this.operations.get(operationId)?.status ?? null;
  }

  async advance(operationId: string) {
    const operation = this.operations.get(operationId)!;
    if (this.currentVersionId !== operation.expected)
      throw new ApiError(409, "CAS mismatch", "CONFLICT");
    this.currentVersionId = operation.claim.targetVersionId;
    operation.status = "database_switched";
    const version = this.versions.get(this.currentVersionId);
    if (version) version.status = "completed";
  }

  async complete(operationId: string) {
    this.operations.get(operationId)!.status = "completed";
  }

  async fail(operationId: string) {
    this.operations.get(operationId)!.status = "failed";
  }

  async requireRecovery(operationId: string) {
    this.operations.get(operationId)!.status = "recovery_required";
  }

  private assertHost(requestedWorkspaceId: string, requestedHostId: string): void {
    if (requestedWorkspaceId !== this.ownerWorkspaceId || requestedHostId !== hostId) {
      throw new ApiError(404, "Host not found", "NOT_FOUND");
    }
  }
}

function dependencies() {
  const repository = new MemoryPublicationRepository();
  const storage = new MemoryR2();
  const archives: Uint8Array[] = [
    makeZip([
      { path: "index.html", value: "<h1>v1</h1>" },
      { path: "assets/site.css", value: "body{color:#123}" },
    ]),
  ];
  let archiveIndex = 0;
  const getPreparedArchive = async () => ({
    bytes: archives[Math.min(archiveIndex, archives.length - 1)],
    buildFingerprint,
  });
  const publish = (key: string) =>
    publishLanding(
      { repository, storage, getPreparedArchive },
      {
        workspaceId,
        hostId,
        landingId,
        hostname,
        idempotencyKeyHash: key.padEnd(64, "0").slice(0, 64),
        createdByUserId: userId,
      },
    );
  return {
    repository,
    storage,
    archives,
    setArchiveIndex(index: number) {
      archiveIndex = index;
    },
    publish,
  };
}

describe("Landing Factory R2 publication", () => {
  it("strips one detected siteRootPath while preserving relative assets", async () => {
    const files = await extractStaticLandingFiles(
      makeZip([
        { path: "HARKIV HTML/index.html", value: "<link rel=stylesheet href=css/site.css>" },
        { path: "HARKIV HTML/css/site.css", value: "body{color:#abc}" },
      ]),
    );

    expect(files.map((file) => file.path)).toEqual(["index.html", "css/site.css"]);
    expect(files[1].contentType).toBe("text/css; charset=utf-8");
  });

  it("revalidates and publishes static files under the immutable database prefix", async () => {
    const { publish, storage } = dependencies();
    const result = await publish("first-publish-idempotency-key");
    const manifest = JSON.parse(
      (await storage.readText(`host-manifests/${hostname}.json`, 4096)) ?? "{}",
    ) as { sitePrefix: string };

    expect(result.url).toBe(`https://${hostname}`);
    expect(manifest.sitePrefix).toBe(
      `crmonia/landing-sites/${workspaceId}/${hostId}/${result.versionId}/`,
    );
    expect(await storage.head(`${manifest.sitePrefix}index.html`)).not.toBeNull();
    expect(await storage.head(`${manifest.sitePrefix}assets/site.css`)).not.toBeNull();
  });

  it("replays duplicate idempotency keys without creating a second version", async () => {
    const { publish, repository, storage } = dependencies();
    const first = await publish("same-publish-request-key");
    const replay = await publish("same-publish-request-key");

    expect(replay.versionId).toBe(first.versionId);
    expect(replay.replayed).toBe(true);
    expect(repository.versions.size).toBe(1);
    expect(storage.objects.has(`host-manifests/${hostname}.json`)).toBe(true);
  });

  it("runs concurrent duplicate requests against one immutable version", async () => {
    const { publish, repository, storage } = dependencies();
    const [first, duplicate] = await Promise.all([
      publish("concurrent-publish-idempotency-key"),
      publish("concurrent-publish-idempotency-key"),
    ]);

    expect(first.versionId).toBe(duplicate.versionId);
    expect(repository.versions.size).toBe(1);
    expect(repository.currentVersionId).toBe(first.versionId);
    expect(
      JSON.parse((await storage.readText(`host-manifests/${hostname}.json`, 4096)) ?? "{}")
        .sitePrefix,
    ).toContain(first.versionId);
  });

  it("does not claim a version when the current adapted build is stale", async () => {
    const { repository, storage } = dependencies();
    const result = await publishLanding(
      {
        repository,
        storage,
        getPreparedArchive: async () => {
          throw new ApiError(409, "Prepare the landing ZIP again", "CONFLICT");
        },
      },
      {
        workspaceId,
        hostId,
        landingId,
        hostname,
        idempotencyKeyHash: "1".repeat(64),
        createdByUserId: userId,
      },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(ApiError);
    expect(repository.versions.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it("rejects an archive with an unsafe path before switching the hostname", async () => {
    const { repository, storage } = dependencies();
    const badArchive = makeZip([
      { path: "index.html", value: "<h1>site</h1>" },
      { path: "../outside.js", value: "alert(1)" },
    ]);
    const result = await publishLanding(
      {
        repository,
        storage,
        getPreparedArchive: async () => ({ bytes: badArchive, buildFingerprint }),
      },
      {
        workspaceId,
        hostId,
        landingId,
        hostname,
        idempotencyKeyHash: "4".repeat(64),
        createdByUserId: userId,
      },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(Error);
    expect(repository.currentVersionId).toBeNull();
    expect(storage.objects.has(`host-manifests/${hostname}.json`)).toBe(false);
  });

  it("rejects a host that has not passed the domain readiness check", async () => {
    const { repository, storage, publish } = dependencies();
    repository.ready = false;

    await publish("unready-domain-key").catch(() => undefined);

    expect(repository.versions.size).toBe(0);
    expect(storage.objects.size).toBe(0);
  });

  it("keeps the previous manifest on an R2 failure and retries the same version safely", async () => {
    const { publish, repository, storage, archives, setArchiveIndex } = dependencies();
    const first = await publish("version-one-key");
    archives.push(makeZip([{ path: "index.html", value: "<h1>v2</h1>" }]));
    setArchiveIndex(1);
    storage.failNextSitePut = true;

    await publish("version-two-key").catch(() => undefined);
    const manifest = JSON.parse(
      (await storage.readText(`host-manifests/${hostname}.json`, 4096)) ?? "{}",
    ) as { sitePrefix: string };

    expect(manifest.sitePrefix).toContain(first.versionId);
    expect(repository.currentVersionId).toBe(first.versionId);
    expect(
      [...repository.operations.values()].some((operation) => operation.status === "uploading"),
    ).toBe(true);

    const retry = await publish("version-two-key");
    expect(repository.currentVersionId).toBe(retry.versionId);
    expect(retry.versionId).not.toBe(first.versionId);
    expect(
      JSON.parse((await storage.readText(`host-manifests/${hostname}.json`, 4096)) ?? "{}")
        .sitePrefix,
    ).toContain(retry.versionId);
  });

  it("retries an R2 PUT that committed before its response timed out", async () => {
    const { publish, repository, storage } = dependencies();
    storage.timeoutAfterSitePut = true;

    await publish("r2-put-timeout-idempotency-key").catch(() => undefined);
    expect(repository.currentVersionId).toBeNull();

    const retry = await publish("r2-put-timeout-idempotency-key");
    expect(repository.currentVersionId).toBe(retry.versionId);
    expect(
      JSON.parse((await storage.readText(`host-manifests/${hostname}.json`, 4096)) ?? "{}")
        .sitePrefix,
    ).toContain(retry.versionId);
  });

  it("confirms a manifest committed before an R2 timeout without duplicate versions", async () => {
    const { publish, repository, storage } = dependencies();
    storage.timeoutAfterManifestPut = true;

    const result = await publish("manifest-timeout-key");

    expect(repository.versions.size).toBe(1);
    expect(repository.currentVersionId).toBe(result.versionId);
    expect(result.replayed).toBe(false);
  });

  it("resumes a database-switched operation after the manifest write is unavailable", async () => {
    const { publish, repository, storage } = dependencies();
    storage.failManifestWrites = 2;

    const firstAttempt = await publish("recoverable-manifest-key").catch((error: unknown) => error);
    const operation = await repository.findOperation(
      workspaceId,
      hostId,
      "recoverable-manifest-key".padEnd(64, "0").slice(0, 64),
    );
    if (!operation) throw new Error("Expected a persisted publication operation");
    const resumed = await resumeLandingPublication(
      { repository, storage },
      {
        workspaceId,
        hostId,
        landingId,
        hostname,
        idempotencyKeyHash: "recoverable-manifest-key".padEnd(64, "0").slice(0, 64),
        createdByUserId: userId,
      },
      operation,
    );

    expect(firstAttempt).toBeInstanceOf(Error);
    expect(resumed.replayed).toBe(true);
    expect(repository.versions.size).toBe(1);
    expect(repository.currentVersionId).toBe(resumed.versionId);
    expect(storage.objects.has(`host-manifests/${hostname}.json`)).toBe(true);
  });

  it("rolls back to a previously published immutable version", async () => {
    const { publish, repository, storage, archives, setArchiveIndex } = dependencies();
    const first = await publish("rollback-version-one");
    archives.push(makeZip([{ path: "index.html", value: "<h1>v2</h1>" }]));
    setArchiveIndex(1);
    const second = await publish("rollback-version-two");
    const result = await rollbackLandingPublication(
      { repository, storage },
      {
        workspaceId,
        hostId,
        landingId,
        hostname,
        idempotencyKeyHash: "2".repeat(64),
        createdByUserId: userId,
        targetVersionId: first.versionId,
      },
    );

    expect(second.versionId).not.toBe(first.versionId);
    expect(result.versionId).toBe(first.versionId);
    expect(repository.currentVersionId).toBe(first.versionId);
    expect(
      JSON.parse((await storage.readText(`host-manifests/${hostname}.json`, 4096)) ?? "{}")
        .sitePrefix,
    ).toContain(first.versionId);
  });

  it("rejects a hostname owned by another workspace", async () => {
    const { repository, storage } = dependencies();
    repository.ownerWorkspaceId = "99999999-9999-4999-8999-999999999999";

    const result = await publishLanding(
      {
        repository,
        storage,
        getPreparedArchive: async () => ({
          bytes: makeZip([{ path: "index.html", value: "<h1>site</h1>" }]),
          buildFingerprint,
        }),
      },
      {
        workspaceId,
        hostId,
        landingId,
        hostname,
        idempotencyKeyHash: "3".repeat(64),
        createdByUserId: userId,
      },
    ).catch((error: unknown) => error);

    expect(result).toBeInstanceOf(ApiError);
    expect(storage.objects.size).toBe(0);
  });
});
