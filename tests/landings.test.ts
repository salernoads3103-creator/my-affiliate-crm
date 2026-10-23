import { describe, expect, it } from "bun:test";
import { analyzeLandingArchive, LandingArchiveError } from "../src/lib/landings/archive";
import { createLandingDraft } from "../src/lib/landings/service";
import { LandingArchiveAnalysisSchema, LandingCreateSchema } from "../src/lib/landings/validation";
import type {
  LandingArchiveAnalysis,
  LandingArchiveStorage,
  LandingRepository,
} from "../src/lib/landings/types";

const encoder = new TextEncoder();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function write16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true);
}

type ZipFixtureEntry = {
  name: string;
  content: string;
  method?: 0 | 8;
  compressedContent?: Uint8Array;
  declaredUncompressedSize?: number;
  unixMode?: number;
};

function makeZip(entries: ZipFixtureEntry[]): Uint8Array {
  const localRecords: Uint8Array[] = [];
  const centralRecords: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const content = encoder.encode(entry.content);
    const compressed = entry.compressedContent ?? content;
    const method = entry.method ?? 0;
    const declaredSize = entry.declaredUncompressedSize ?? content.byteLength;
    const crc = crc32(content);
    const local = new Uint8Array(30 + name.byteLength + compressed.byteLength);
    const localView = new DataView(local.buffer);
    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, method);
    write32(localView, 14, crc);
    write32(localView, 18, compressed.byteLength);
    write32(localView, 22, declaredSize);
    write16(localView, 26, name.byteLength);
    local.set(name, 30);
    local.set(compressed, 30 + name.byteLength);
    localRecords.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 0x0314);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, method);
    write32(centralView, 16, crc);
    write32(centralView, 20, compressed.byteLength);
    write32(centralView, 24, declaredSize);
    write16(centralView, 28, name.byteLength);
    write32(centralView, 38, ((entry.unixMode ?? 0o100644) << 16) >>> 0);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centralRecords.push(central);
    localOffset += local.byteLength;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50);
  write16(endView, 8, entries.length);
  write16(endView, 10, entries.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);

  const archive = new Uint8Array(localOffset + centralSize + end.byteLength);
  let offset = 0;
  for (const record of [...localRecords, ...centralRecords, end]) {
    archive.set(record, offset);
    offset += record.byteLength;
  }
  return archive;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice().buffer])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw" as CompressionFormat));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

const validHtml = `<!doctype html><form action="/lead" method="post">
  <input name="customer_name" autocomplete="name">
  <input name="phone" type="tel">
</form><script>fbq('init', 'pixel');</script>`;

function fakeDependencies() {
  let inserted: Parameters<LandingRepository["insertDraft"]>[0] | null = null;
  let uploadedPath = "";
  let statusAfterFailure = "draft";
  const repository: LandingRepository = {
    async list() {
      return [];
    },
    async ensureActiveOffer(workspaceId, offerId) {
      if (workspaceId !== "workspace-a" || offerId !== "offer-a") {
        throw new Error("The selected offer is not available");
      }
      return { name: "Offer A" };
    },
    async insertDraft(input) {
      inserted = input;
      return { createdAt: "2026-10-23T12:00:00.000Z" };
    },
    async markError() {
      statusAfterFailure = "error";
    },
  };
  const storage: LandingArchiveStorage = {
    async put(path) {
      uploadedPath = path;
    },
  };
  return {
    repository,
    storage,
    get inserted() {
      return inserted;
    },
    get uploadedPath() {
      return uploadedPath;
    },
    get statusAfterFailure() {
      return statusAfterFailure;
    },
  };
}

describe("Landing Factory ZIP intake", () => {
  it("analyzes index.html, form fields, JavaScript, and known pixels", async () => {
    const archive = makeZip([
      { name: "index.html", content: validHtml },
      { name: "assets/main.js", content: "console.log('landing')" },
      { name: "assets/site.css", content: "body { color: black }" },
    ]);

    const analysis = await analyzeLandingArchive(archive);
    expect(analysis.hasIndexHtml).toBe(true);
    expect(analysis.siteRootPath).toBe("");
    expect(analysis.fileCount).toBe(3);
    expect(analysis.forms).toHaveLength(1);
    expect(analysis.forms[0].hasNameCandidate).toBe(true);
    expect(analysis.forms[0].hasPhoneCandidate).toBe(true);
    expect(analysis.detectedPixels).toContain("meta");
    expect(analysis.hasJavaScript).toBe(true);
    expect(analysis.requiresAdaptation).toBe(false);
    expect(analysis.warnings).not.toContain("scripts_not_scanned");
  });

  it("reads a deflated index.html without extracting files", async () => {
    const content = encoder.encode(validHtml);
    const archive = makeZip([
      {
        name: "index.html",
        content: validHtml,
        method: 8,
        compressedContent: await deflateRaw(content),
      },
    ]);

    const analysis = await analyzeLandingArchive(archive);
    expect(analysis.hasIndexHtml).toBe(true);
    expect(analysis.siteRootPath).toBe("");
    expect(analysis.forms[0].hasPhoneCandidate).toBe(true);
  });

  it("detects a single top-level folder as the site root and analyzes its files", async () => {
    const archive = makeZip([
      { name: "HARKIV HTML/index.html", content: validHtml },
      { name: "HARKIV HTML/assets/site.css", content: "body { color: black }" },
      { name: "HARKIV HTML/scripts/pixel.js", content: "ttq.load('pixel')" },
      { name: "HARKIV HTML/product/index.html", content: "<main>Product details</main>" },
    ]);

    const analysis = await analyzeLandingArchive(archive);
    expect(analysis.hasIndexHtml).toBe(true);
    expect(analysis.siteRootPath).toBe("HARKIV HTML/");
    expect(analysis.forms).toHaveLength(1);
    expect(analysis.forms[0].hasNameCandidate).toBe(true);
    expect(analysis.forms[0].hasPhoneCandidate).toBe(true);
    expect(analysis.detectedPixels).toEqual(["meta", "tiktok"]);
    expect(analysis.requiresAdaptation).toBe(false);
  });

  it("marks multiple possible site roots for adaptation without choosing one", async () => {
    const archive = makeZip([
      { name: "HARKIV HTML/index.html", content: validHtml },
      { name: "ANOTHER LANDING/index.html", content: validHtml },
    ]);

    const analysis = await analyzeLandingArchive(archive);
    expect(analysis.hasIndexHtml).toBe(true);
    expect(analysis.siteRootPath).toBeNull();
    expect(analysis.forms).toHaveLength(0);
    expect(analysis.requiresAdaptation).toBe(true);
    expect(analysis.warnings).toContain("root_ambiguous");
    expect(LandingArchiveAnalysisSchema.parse(analysis).siteRootPath).toBeNull();
  });

  it("does not select a wrapper folder when archive files also exist outside it", async () => {
    const archive = makeZip([
      { name: "HARKIV HTML/index.html", content: validHtml },
      { name: "README.txt", content: "Archive notes" },
    ]);

    const analysis = await analyzeLandingArchive(archive);
    expect(analysis.siteRootPath).toBeNull();
    expect(analysis.requiresAdaptation).toBe(true);
    expect(analysis.warnings).toContain("root_ambiguous");
  });

  it("marks an archive without an index or standard form for adaptation", async () => {
    const archive = makeZip([
      { name: "site/landing.html", content: "<main>Landing content</main>" },
    ]);

    const analysis = await analyzeLandingArchive(archive);
    expect(analysis.hasIndexHtml).toBe(false);
    expect(analysis.siteRootPath).toBeNull();
    expect(analysis.requiresAdaptation).toBe(true);
    expect(analysis.warnings).toContain("index_missing");
  });

  it("keeps previously saved root-level analyses readable", () => {
    const previousAnalysis = LandingArchiveAnalysisSchema.parse({
      hasIndexHtml: true,
      fileCount: 1,
      uncompressedBytes: 100,
      forms: [],
      detectedPixels: [],
      hasJavaScript: false,
      requiresAdaptation: true,
      warnings: ["form_missing"],
    });

    expect(previousAnalysis.siteRootPath).toBe("");
  });

  it("rejects malformed archives, path traversal, executable files, and symlinks", async () => {
    await expect(analyzeLandingArchive(encoder.encode("not a zip"))).rejects.toBeInstanceOf(
      LandingArchiveError,
    );
    await expect(
      analyzeLandingArchive(makeZip([{ name: "../outside.html", content: "x" }])),
    ).rejects.toBeInstanceOf(LandingArchiveError);
    await expect(
      analyzeLandingArchive(makeZip([{ name: "/outside.html", content: "x" }])),
    ).rejects.toBeInstanceOf(LandingArchiveError);
    await expect(
      analyzeLandingArchive(makeZip([{ name: "index.php", content: "<?php" }])),
    ).rejects.toBeInstanceOf(LandingArchiveError);
    await expect(
      analyzeLandingArchive(makeZip([{ name: "link.html", content: "x", unixMode: 0o120777 }])),
    ).rejects.toBeInstanceOf(LandingArchiveError);
  });

  it("rejects a high-ratio ZIP bomb before decompressing its payload", async () => {
    const archive = makeZip([
      {
        name: "assets/large.css",
        content: "x",
        method: 8,
        compressedContent: new Uint8Array([0]),
        declaredUncompressedSize: 201,
      },
    ]);

    await expect(analyzeLandingArchive(archive)).rejects.toBeInstanceOf(LandingArchiveError);
  });

  it("stops decompression when an archive lies about an entry's expanded size", async () => {
    const content = encoder.encode("x".repeat(1024 * 1024));
    const archive = makeZip([
      {
        name: "assets/large.css",
        content: "x".repeat(content.byteLength),
        method: 8,
        compressedContent: await deflateRaw(content),
        declaredUncompressedSize: 1,
      },
    ]);

    await expect(analyzeLandingArchive(archive)).rejects.toBeInstanceOf(LandingArchiveError);
  });

  it("validates a static ZIP filename and rejects extra client-owned fields", () => {
    const valid = LandingCreateSchema.safeParse({
      name: "Landing A",
      offerId: "11111111-1111-4111-8111-111111111111",
    });
    const forged = LandingCreateSchema.safeParse({
      name: "Landing A",
      offerId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
    });
    expect(valid.success).toBe(true);
    expect(forged.success).toBe(false);
  });

  it("creates a draft with server-owned workspace and author data, then stores the ZIP privately", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    const created = await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: "offer-a",
        workspaceId: "workspace-a",
        createdByUserId: "user-a",
        archive: new Blob(["zip"]),
        analysis,
        createId: () => "landing-a",
      },
    );

    expect(created.status).toBe("draft");
    expect(created.workspace_id).toBe("workspace-a");
    expect(created.created_by_user_id).toBe("user-a");
    expect(created.source_archive_path).toBe("workspace-a/landing-a/source.zip");
    expect(dependencies.inserted?.workspaceId).toBe("workspace-a");
    expect(dependencies.inserted?.createdByUserId).toBe("user-a");
    expect(dependencies.inserted?.analysis.siteRootPath).toBe("");
    expect(dependencies.uploadedPath).toBe("workspace-a/landing-a/source.zip");
  });

  it("does not create or upload a draft when the offer is outside the workspace", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await expect(
      createLandingDraft(
        { repository: dependencies.repository, storage: dependencies.storage },
        {
          name: "Landing A",
          offerId: "offer-from-another-workspace",
          workspaceId: "workspace-a",
          createdByUserId: "user-a",
          archive: new Blob(["zip"]),
          analysis,
          createId: () => "landing-a",
        },
      ),
    ).rejects.toThrow("The selected offer is not available");
    expect(dependencies.inserted).toBeNull();
    expect(dependencies.uploadedPath).toBe("");
  });

  it("marks the draft as error if the private archive upload fails", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    const failingStorage: LandingArchiveStorage = {
      async put() {
        throw new Error("storage failure detail");
      },
    };

    await expect(
      createLandingDraft(
        { repository: dependencies.repository, storage: failingStorage },
        {
          name: "Landing A",
          offerId: "offer-a",
          workspaceId: "workspace-a",
          createdByUserId: "user-a",
          archive: new Blob(["zip"]),
          analysis,
          createId: () => "landing-a",
        },
      ),
    ).rejects.toThrow("Could not store the landing archive");
    expect(dependencies.statusAfterFailure).toBe("error");
  });
});
