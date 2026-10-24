import { describe, expect, it } from "bun:test";
import { runInNewContext } from "node:vm";
import { analyzeLandingArchive, LandingArchiveError } from "../src/lib/landings/archive";
import {
  buildAdaptedLandingArchive,
  checkLandingAdapterCompatibility,
  LandingAdapterError,
} from "../src/lib/landings/archive";
import { getPublicLandingIntakeEndpoint } from "../src/lib/landings/config.server";
import {
  connectLandingDraft,
  createLandingDraft,
  deleteLandingDraft,
  getDownloadableAdaptedArchive,
  updateLandingDraft,
} from "../src/lib/landings/service";
import { requireWorkspacePermission, type AccessContext } from "../src/lib/access/access.server";
import { LandingArchiveAnalysisSchema, LandingCreateSchema } from "../src/lib/landings/validation";
import type {
  LandingArchiveAnalysis,
  LandingArchiveStorage,
  LandingDraftRecord,
  LandingRepository,
  LandingStatus,
} from "../src/lib/landings/types";
import { trackingFingerprint } from "../src/lib/tracking-profiles/logic";

const encoder = new TextEncoder();
const TEST_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const TEST_USER_ID = "22222222-2222-4222-8222-222222222222";
const TEST_LANDING_ID = "33333333-3333-4333-8333-333333333333";
const TEST_OFFER_A_ID = "44444444-4444-4444-8444-444444444444";
const TEST_OFFER_B_ID = "55555555-5555-4555-8555-555555555555";

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

function readStoredZipEntry(archive: Uint8Array, entryName: string): string | null {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const decoder = new TextDecoder();
  let offset = 0;
  while (offset + 30 <= archive.byteLength && view.getUint32(offset, true) === 0x04034b50) {
    const method = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const contentStart = nameStart + fileNameLength + extraLength;
    const name = decoder.decode(archive.subarray(nameStart, nameStart + fileNameLength));
    if (name === entryName && method === 0) {
      return decoder.decode(archive.subarray(contentStart, contentStart + compressedSize));
    }
    offset = contentStart + compressedSize;
  }
  return null;
}

type AdapterResponseBody = { success: boolean; accepted: boolean };
type AdapterRequest = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal;
};
type AdapterResponse = { status: number; json: () => Promise<AdapterResponseBody> };
type AdapterFetch = (url: string, request: AdapterRequest) => Promise<AdapterResponse>;

function runGeneratedAdapter(script: string, fetcher: AdapterFetch) {
  let submitHandler: ((event: { preventDefault: () => void }) => Promise<void>) | null = null;
  const timeouts = new Map<number, () => void>();
  let nextTimeoutId = 0;
  const nameField = { value: "Олена" };
  const phoneField = { value: "0501234567" };
  const honeypot = { value: "" };
  const submitButton = { disabled: false };
  const status = {
    textContent: "",
    state: "",
    setAttribute(_name: string, value: string) {
      this.state = value;
    },
  };
  const form = {
    dataset: {} as Record<string, string>,
    nextElementSibling: status,
    getAttribute(name: string) {
      return name === "data-crmonia-form-id" ? "66666666-6666-4666-8666-666666666666" : null;
    },
    querySelector(selector: string) {
      if (selector === '[data-crmonia-lead-field="name"]') return nameField;
      if (selector === '[data-crmonia-lead-field="phone"]') return phoneField;
      if (selector === '[name="website"]') return honeypot;
      return null;
    },
    querySelectorAll() {
      return [submitButton];
    },
    addEventListener(_name: string, callback: typeof submitHandler) {
      submitHandler = callback as typeof submitHandler;
    },
    reset() {
      nameField.value = "";
      phoneField.value = "";
      honeypot.value = "";
    },
  };
  const pixelEvents: Array<{ id: string; event: string }> = [];
  const googleAdsEvents: unknown[][] = [];
  const context = {
    document: {
      readyState: "complete",
      documentElement: { lang: "uk" },
      querySelectorAll: () => [form],
    },
    window: {
      location: {
        search:
          "?utm_source=tiktok&utm_campaign=launch-26-10&utm_content=video-a&ttclid=click-123&gclid=g-click-1&gbraid=g-bridge-1&wbraid=w-bridge-1",
      },
      setTimeout(callback: () => void) {
        const id = ++nextTimeoutId;
        timeouts.set(id, callback);
        return id;
      },
      clearTimeout(id: number) {
        timeouts.delete(id);
      },
      ttq: {
        instance(id: string) {
          return { track: (event: string) => pixelEvents.push({ id, event }) };
        },
      },
      gtag(...args: unknown[]) {
        googleAdsEvents.push(args);
      },
    },
    fetch: fetcher,
    crypto: { randomUUID: () => "attempt-key-12345678" },
    URLSearchParams,
    AbortController,
  };
  runInNewContext(script, context);

  return {
    nameField,
    phoneField,
    honeypot,
    status,
    submitButton,
    pixelEvents,
    googleAdsEvents,
    get pendingTimeouts() {
      return [...timeouts.values()];
    },
    async submit() {
      if (!submitHandler) throw new Error("Generated adapter did not bind the form");
      await submitHandler({ preventDefault() {} });
    },
    submitWithoutWaiting() {
      if (!submitHandler) throw new Error("Generated adapter did not bind the form");
      return submitHandler({ preventDefault() {} });
    },
  };
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
  const uploadedPaths: string[] = [];
  const removedPaths: string[] = [];
  let statusAfterFailure = "draft";
  let record: LandingDraftRecord | null = null;
  let failUpdate = false;
  let failRemove = false;
  const archiveObjects = new Map<string, Blob>();
  const now = "2026-10-23T12:00:00.000Z";
  const repository: LandingRepository = {
    async list() {
      return [];
    },
    async ensureOffer(workspaceId, offerId, activeOnly) {
      if (
        !["workspace-a", TEST_WORKSPACE_ID].includes(workspaceId) ||
        !["offer-a", "offer-b", "offer-inactive", TEST_OFFER_A_ID, TEST_OFFER_B_ID].includes(
          offerId,
        ) ||
        (activeOnly && offerId === "offer-inactive")
      ) {
        throw new Error("The selected offer is not available");
      }
      return {
        name: offerId === "offer-b" || offerId === TEST_OFFER_B_ID ? "Offer B" : "Offer A",
      };
    },
    async insertDraft(input) {
      inserted = input;
      record = {
        id: input.id,
        workspace_id: input.workspaceId,
        name: input.name,
        offer_id: input.offerId,
        status: "draft",
        published_url: null,
        created_at: now,
        created_by_user_id: input.createdByUserId,
        source_archive_path: input.sourceArchivePath,
        source_archive_bytes: input.sourceArchiveBytes,
        deletion_started_at: null,
        adapted_archive_path: null,
        adapted_archive_bytes: null,
        adapter_status: "not_connected",
        adapter_reason: null,
        tiktok_pixel_id: null,
        google_ads_conversion_id: null,
        google_ads_conversion_label: null,
        google_ads_tracking_profile_id: null,
        tiktok_tracking_profile_id: null,
        adapted_tracking_fingerprint: null,
        intake_public_id: null,
        analysis: input.analysis,
      };
      return { createdAt: now };
    },
    async markError() {
      statusAfterFailure = "error";
    },
    async getDraft(workspaceId, landingId) {
      if (!record || record.workspace_id !== workspaceId || record.id !== landingId) return null;
      return { ...record };
    },
    async updateDraft(input) {
      if (failUpdate) throw new Error("database update failed");
      if (
        !record ||
        record.workspace_id !== input.workspaceId ||
        record.id !== input.landingId ||
        record.status !== "draft" ||
        record.deletion_started_at
      ) {
        throw new Error("This landing draft is no longer editable");
      }
      record = {
        ...record,
        name: input.name,
        offer_id: input.offerId,
        ...(input.sourceArchivePath === undefined
          ? {}
          : { source_archive_path: input.sourceArchivePath }),
        ...(input.sourceArchiveBytes === undefined
          ? {}
          : { source_archive_bytes: input.sourceArchiveBytes }),
        ...(input.analysis === undefined ? {} : { analysis: input.analysis }),
        ...(input.sourceArchivePath === undefined
          ? {}
          : {
              adapted_archive_path: null,
              adapted_archive_bytes: null,
              adapter_status: "not_connected",
              adapter_reason: null,
              intake_public_id: null,
            }),
      };
      return { ...record };
    },
    async updateAdapter(input) {
      if (
        !record ||
        record.workspace_id !== input.workspaceId ||
        record.id !== input.landingId ||
        record.status !== "draft" ||
        record.deletion_started_at
      ) {
        throw new Error("This landing draft is no longer editable");
      }
      record = {
        ...record,
        adapted_archive_path: input.adaptedArchivePath,
        adapted_archive_bytes: input.adaptedArchiveBytes,
        adapter_status: input.status,
        adapter_reason: input.reason,
        ...(input.tiktokPixelId === undefined ? {} : { tiktok_pixel_id: input.tiktokPixelId }),
        ...(input.googleAdsConversionId === undefined
          ? {}
          : { google_ads_conversion_id: input.googleAdsConversionId }),
        ...(input.googleAdsConversionLabel === undefined
          ? {}
          : { google_ads_conversion_label: input.googleAdsConversionLabel }),
        ...(input.tiktokTrackingProfileId === undefined
          ? {}
          : { tiktok_tracking_profile_id: input.tiktokTrackingProfileId }),
        ...(input.googleAdsTrackingProfileId === undefined
          ? {}
          : { google_ads_tracking_profile_id: input.googleAdsTrackingProfileId }),
        ...(input.adaptedTrackingFingerprint === undefined
          ? {}
          : { adapted_tracking_fingerprint: input.adaptedTrackingFingerprint }),
        intake_public_id: input.publicFormId ?? null,
      };
      return { ...record };
    },
    async beginDraftDeletion(workspaceId, landingId) {
      if (!record || record.workspace_id !== workspaceId || record.id !== landingId) return null;
      if (record.status !== "draft") throw new Error("Only landing drafts can be deleted");
      record = { ...record, deletion_started_at: record.deletion_started_at ?? now };
      return {
        sourceArchivePath: record.source_archive_path,
        adaptedArchivePath: record.adapted_archive_path,
      };
    },
    async finishDraftDeletion(workspaceId, landingId) {
      if (record?.workspace_id === workspaceId && record.id === landingId) record = null;
    },
  };
  const storage: LandingArchiveStorage = {
    async put(path, archive) {
      uploadedPaths.push(path);
      archiveObjects.set(path, archive);
    },
    async remove(path) {
      if (failRemove) throw new Error("storage removal failed");
      removedPaths.push(path);
      archiveObjects.delete(path);
    },
    async download(path) {
      const archive = archiveObjects.get(path);
      if (!archive) throw new Error("archive not found");
      return archive;
    },
  };
  return {
    repository,
    storage,
    get inserted() {
      return inserted;
    },
    get uploadedPaths() {
      return uploadedPaths;
    },
    get removedPaths() {
      return removedPaths;
    },
    get statusAfterFailure() {
      return statusAfterFailure;
    },
    get record() {
      return record;
    },
    set failUpdate(value: boolean) {
      failUpdate = value;
    },
    set failRemove(value: boolean) {
      failRemove = value;
    },
    set status(value: LandingStatus) {
      if (record) record = { ...record, status: value };
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

  it("adapts a standard root form and preserves static assets without a local API URL", async () => {
    const source = makeZip([
      { name: "index.html", content: validHtml },
      { name: "assets/site.css", content: "body{color:#123}" },
      { name: "images/product.svg", content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' },
    ]);
    const adapted = await buildAdaptedLandingArchive(source, {
      publicFormId: "66666666-6666-4666-8666-666666666666",
      intakeEndpoint: null,
    });
    const analysis = await analyzeLandingArchive(adapted);

    expect(analysis.siteRootPath).toBe("");
    expect(analysis.forms).toHaveLength(1);
    expect(analysis.forms[0].hasNameCandidate).toBe(true);
    expect(analysis.forms[0].hasPhoneCandidate).toBe(true);
    const archiveText = new TextDecoder().decode(adapted);
    expect(archiveText).toContain('data-crmonia-intake="1"');
    expect(archiveText).toContain('data-crmonia-lead-field="name"');
    expect(archiveText).toContain("crmonia-intake-adapter.js");
    expect(archiveText).toContain("body{color:#123}");
    expect(archiveText).not.toContain("localhost");
    expect(archiveText).not.toContain("service_role");
    expect(archiveText).not.toContain("workspace_id");
    expect(archiveText).not.toContain(TEST_WORKSPACE_ID);
    expect(archiveText).not.toContain("supabase.co");
  });

  it("injects one TikTok base code and honeypot, then tracks SubmitForm only after API acceptance", async () => {
    const pixelId = "TT1234567890";
    const archive = await buildAdaptedLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
      {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        tiktokPixelId: pixelId,
      },
    );
    const html = readStoredZipEntry(archive, "index.html");
    const script = readStoredZipEntry(archive, "crmonia-intake-adapter.js");
    expect(html).toContain('name="website"');
    expect(html).toContain('ttq.load("TT1234567890")');
    expect(html).toContain("ttq.page()");
    expect(script).toContain('pixel.track("SubmitForm")');

    const requests: AdapterRequest[] = [];
    const harness = runGeneratedAdapter(script!, async (_url, request) => {
      requests.push(request);
      return { status: 202, json: async () => ({ success: true, accepted: true }) };
    });
    await harness.submit();

    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      utmSource: "tiktok",
      utmCampaign: "launch-26-10",
      utmContent: "video-a",
      ttclid: "click-123",
      website: "",
    });
    expect(harness.pixelEvents).toEqual([{ id: pixelId, event: "SubmitForm" }]);
    expect(harness.status.state).toBe("success");
  });

  it("tracks a Google Ads conversion once after acceptance and forwards Google click IDs", async () => {
    const archive = await buildAdaptedLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
      {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        tiktokPixelId: "TT1234567890",
        googleAdsConversionId: "AW-123456789",
        googleAdsConversionLabel: "AbC-D_efG-h12_34-567",
      },
    );
    const html = readStoredZipEntry(archive, "index.html")!;
    const script = readStoredZipEntry(archive, "crmonia-intake-adapter.js")!;
    expect(html).toContain("googletagmanager.com/gtag/js?id=");
    expect(html).toContain("window.gtag('config',\"AW-123456789\")");

    const requests: AdapterRequest[] = [];
    const harness = runGeneratedAdapter(script, async (_url, request) => {
      requests.push(request);
      return { status: 202, json: async () => ({ success: true, accepted: true }) };
    });
    await harness.submit();

    expect(JSON.parse(requests[0]!.body)).toMatchObject({
      gclid: "g-click-1",
      gbraid: "g-bridge-1",
      wbraid: "w-bridge-1",
    });
    expect(harness.pixelEvents).toEqual([{ id: "TT1234567890", event: "SubmitForm" }]);
    expect(harness.googleAdsEvents).toEqual([
      ["event", "conversion", { send_to: "AW-123456789/AbC-D_efG-h12_34-567" }],
    ]);
  });

  it("does not track SubmitForm when the intake API rejects the request", async () => {
    const archive = await buildAdaptedLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
      {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        tiktokPixelId: "TT1234567890",
        googleAdsConversionId: "AW-123456789",
        googleAdsConversionLabel: "conversion-label",
      },
    );
    const harness = runGeneratedAdapter(
      readStoredZipEntry(archive, "crmonia-intake-adapter.js")!,
      async () => ({ status: 503, json: async () => ({ success: false, accepted: false }) }),
    );

    await harness.submit();

    expect(harness.pixelEvents).toEqual([]);
    expect(harness.googleAdsEvents).toEqual([]);
    expect(harness.status.state).toBe("error");
  });

  it("ignores a second submit while the first request is in flight", async () => {
    const archive = await buildAdaptedLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
      {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        tiktokPixelId: "TT1234567890",
        googleAdsConversionId: "AW-123456789",
        googleAdsConversionLabel: "conversion-label",
      },
    );
    const requests: AdapterRequest[] = [];
    let resolveRequest: ((response: AdapterResponse) => void) | undefined;
    const harness = runGeneratedAdapter(
      readStoredZipEntry(archive, "crmonia-intake-adapter.js")!,
      async (_url, request) => {
        requests.push(request);
        return new Promise((resolve) => {
          resolveRequest = resolve;
        });
      },
    );

    const first = harness.submitWithoutWaiting();
    const second = harness.submitWithoutWaiting();
    expect(requests).toHaveLength(1);
    resolveRequest?.({ status: 202, json: async () => ({ success: true, accepted: true }) });
    await Promise.all([first, second]);
    expect(harness.pixelEvents).toHaveLength(1);
    expect(harness.googleAdsEvents).toHaveLength(1);
  });

  it("reuses the same idempotency key when retrying after a request timeout", async () => {
    const archive = await buildAdaptedLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
      {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        tiktokPixelId: "TT1234567890",
        googleAdsConversionId: "AW-123456789",
        googleAdsConversionLabel: "conversion-label",
      },
    );
    const requests: AdapterRequest[] = [];
    let callCount = 0;
    const harness = runGeneratedAdapter(
      readStoredZipEntry(archive, "crmonia-intake-adapter.js")!,
      async (_url, request) => {
        requests.push(request);
        callCount += 1;
        if (callCount === 1) {
          return new Promise((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(new Error("timeout")), {
              once: true,
            });
          });
        }
        return { status: 202, json: async () => ({ success: true, accepted: true }) };
      },
    );

    const timedOutRequest = harness.submitWithoutWaiting();
    harness.pendingTimeouts[0]?.();
    await timedOutRequest;
    expect(harness.status.state).toBe("error");
    expect(harness.pixelEvents).toEqual([]);
    await harness.submit();

    expect(requests).toHaveLength(2);
    expect(requests[0]?.headers["Idempotency-Key"]).toBe(requests[1]?.headers["Idempotency-Key"]);
    expect(harness.pixelEvents).toEqual([{ id: "TT1234567890", event: "SubmitForm" }]);
    expect(harness.googleAdsEvents).toHaveLength(1);
  });

  it("reuses an existing matching Pixel without injecting another base code and blocks conflicts", async () => {
    const pixelHtml = `${validHtml}<script>ttq.load('TT1234567890');ttq.page();</script>`;
    const matching = await buildAdaptedLandingArchive(
      makeZip([{ name: "index.html", content: pixelHtml }]),
      {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        tiktokPixelId: "TT1234567890",
      },
    );
    const matchingHtml = readStoredZipEntry(matching, "index.html")!;
    expect((matchingHtml.match(/ttq\.load\(/g) ?? []).length).toBe(1);
    expect(matchingHtml).not.toContain("analytics.tiktok.com/i18n/pixel/events.js");

    await expect(
      buildAdaptedLandingArchive(makeZip([{ name: "index.html", content: pixelHtml }]), {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        tiktokPixelId: "DIFFERENTPIXEL",
      }),
    ).rejects.toMatchObject({ reason: "tiktok_pixel_conflict" });

    await expect(
      buildAdaptedLandingArchive(
        makeZip([
          {
            name: "index.html",
            content: `${validHtml}<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABCDE"></script>`,
          },
        ]),
        {
          publicFormId: "66666666-6666-4666-8666-666666666666",
          intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
          tiktokPixelId: "TT1234567890",
        },
      ),
    ).rejects.toMatchObject({ reason: "tiktok_pixel_conflict" });
  });

  it("blocks Google Ads when another Google tag is already installed", async () => {
    const existingTags = [
      `${validHtml}<script>var gtagUrl = "https://www.googletagmanager.com/gtag/js?id=AW-123456789";</script>`,
      `${validHtml}<script>window.google_conversion_id = 123456789;window.google_conversion_label = 'existing';var conversionUrl = "https://www.googleadservices.com/pagead/conversion.js";</script>`,
      `${validHtml}<script>gtag('config', 'AW-123456789');</script>`,
    ];
    for (const existingGoogleTag of existingTags) {
      await expect(
        buildAdaptedLandingArchive(makeZip([{ name: "index.html", content: existingGoogleTag }]), {
          publicFormId: "66666666-6666-4666-8666-666666666666",
          intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
          googleAdsConversionId: "AW-123456789",
          googleAdsConversionLabel: "conversion-label",
        }),
      ).rejects.toMatchObject({ reason: "google_ads_tag_conflict" });
    }

    await expect(
      buildAdaptedLandingArchive(makeZip([{ name: "index.html", content: validHtml }]), {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: "https://crm.example.test/api/v1/intake/leads",
        googleAdsConversionId: "AW-123456789",
      }),
    ).rejects.toMatchObject({ reason: "google_ads_configuration_invalid" });
  });

  it("strips one detected site-root folder while retaining relative asset paths", async () => {
    const source = makeZip([
      { name: "HARKIV HTML/index.html", content: validHtml },
      { name: "HARKIV HTML/assets/site.css", content: "body{background:#fff}" },
    ]);
    const adapted = await buildAdaptedLandingArchive(source, {
      publicFormId: "66666666-6666-4666-8666-666666666666",
      intakeEndpoint: "https://crm.example.com/api/v1/intake/leads",
    });
    const analysis = await analyzeLandingArchive(adapted);
    const archiveText = new TextDecoder().decode(adapted);

    expect(analysis.siteRootPath).toBe("");
    expect(analysis.hasIndexHtml).toBe(true);
    expect(archiveText).toContain("assets/site.css");
    expect(archiveText).toContain("body{background:#fff}");
    expect(archiveText).not.toContain("HARKIV HTML/index.html");
    expect(archiveText).toContain("https://crm.example.com/api/v1/intake/leads");
  });

  it("requires manual adaptation when JavaScript already handles form submission", async () => {
    const archive = makeZip([
      {
        name: "index.html",
        content: `${validHtml}<script>document.querySelector('form').addEventListener('submit', () => fetch('/send'));</script>`,
      },
    ]);
    expect(await checkLandingAdapterCompatibility(archive)).toBe("custom_submit_handler");
    await expect(
      buildAdaptedLandingArchive(archive, {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: null,
      }),
    ).rejects.toMatchObject({ reason: "custom_submit_handler" });
  });

  it("requires adaptation for inline submit behavior and does not count form-like script text", async () => {
    const standard = makeZip([
      {
        name: "index.html",
        content: `<script>const example = '<form><input name="name"></form>';</script><form><input name="name"><input type="tel" name="phone"></form>`,
      },
    ]);
    const custom = makeZip([
      {
        name: "index.html",
        content: `<form onclick="sendLead()"><input name="name"><input type="tel" name="phone"></form>`,
      },
    ]);
    expect(await checkLandingAdapterCompatibility(standard)).toBeNull();
    expect(await checkLandingAdapterCompatibility(custom)).toBe("custom_submit_handler");
  });

  it("adapts one name field despite multiple hints and ignores unrelated name-like fields", async () => {
    const archive = makeZip([
      {
        name: "index.html",
        content: `<form>
          <label for="name">Ім'я</label><input id="name" name="name" autocomplete="name">
          <input id="customer-email" name="customer_email" type="email">
          <input id="product-name" name="product_name" type="text">
          <input id="account-username" name="username" type="text">
          <input id="phone" name="phone" type="tel">
        </form>`,
      },
    ]);
    const analysis = await analyzeLandingArchive(archive);
    const nameCandidates = analysis.forms[0].fields.filter((field) => field.isNameCandidate);

    expect(nameCandidates).toHaveLength(1);
    expect(nameCandidates[0]).toMatchObject({ name: "name", id: "name" });
    expect(await checkLandingAdapterCompatibility(archive)).toBeNull();
    await expect(
      buildAdaptedLandingArchive(archive, {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: null,
      }),
    ).resolves.toBeInstanceOf(Uint8Array);
  });

  it("still requires adaptation when two distinct customer-name fields are present", async () => {
    const archive = makeZip([
      {
        name: "index.html",
        content: `<form><input name="first_name"><input name="last_name"><input name="phone" type="tel"></form>`,
      },
    ]);

    expect(await checkLandingAdapterCompatibility(archive)).toBe("name_field_ambiguous");
  });

  it("requires adaptation for ambiguous tags and base URL overrides", async () => {
    const ambiguous = makeZip([
      {
        name: "index.html",
        content: `<form data-note="greater > sign"><input name="name"><input type="tel" name="phone"></form>`,
      },
    ]);
    const baseOverride = makeZip([
      {
        name: "index.html",
        content: `<base href="https://other.example/"><form><input name="name"><input type="tel" name="phone"></form>`,
      },
    ]);

    expect(await checkLandingAdapterCompatibility(ambiguous)).toBe("ambiguous_markup");
    expect(await checkLandingAdapterCompatibility(baseOverride)).toBe("base_url_present");
  });

  it("does not mistake an attacker-controlled script URL for a pixel integration", async () => {
    const malicious = makeZip([
      {
        name: "index.html",
        content: `<script src="https://attacker.example/connect.facebook.net/fbevents.js"></script>${validHtml}`,
      },
    ]);
    const knownPixel = makeZip([
      {
        name: "index.html",
        content: `<script src="https://connect.facebook.net/en_US/fbevents.js"></script>${validHtml}`,
      },
    ]);

    expect(await checkLandingAdapterCompatibility(malicious)).toBe("external_script_unavailable");
    expect(await checkLandingAdapterCompatibility(knownPixel)).toBeNull();
  });

  it("produces repeatable ZIPs when connected more than once", async () => {
    const source = makeZip([{ name: "index.html", content: validHtml }]);
    const options = {
      publicFormId: "66666666-6666-4666-8666-666666666666",
      intakeEndpoint: null,
    };
    const first = await buildAdaptedLandingArchive(source, options);
    const second = await buildAdaptedLandingArchive(source, options);
    expect(second).toEqual(first);
    expect(
      (new TextDecoder().decode(first).match(/<form data-crmonia-intake="1"/g) ?? []).length,
    ).toBe(1);
  });

  it("reports a specific error for malformed ZIP input", async () => {
    expect(await checkLandingAdapterCompatibility(encoder.encode("not zip"))).toBe(
      "invalid_archive",
    );
    await expect(
      buildAdaptedLandingArchive(encoder.encode("not zip"), {
        publicFormId: "66666666-6666-4666-8666-666666666666",
        intakeEndpoint: null,
      }),
    ).rejects.toBeInstanceOf(LandingArchiveError);
  });

  it("embeds only an exact public HTTPS intake endpoint", () => {
    expect(getPublicLandingIntakeEndpoint("https://crm.example.com/api/v1/intake/leads")).toBe(
      "https://crm.example.com/api/v1/intake/leads",
    );
    expect(getPublicLandingIntakeEndpoint("")).toBeNull();
    expect(() =>
      getPublicLandingIntakeEndpoint("http://crm.example.com/api/v1/intake/leads"),
    ).toThrow("not configured correctly");
    expect(() =>
      getPublicLandingIntakeEndpoint("http://localhost:8080/api/v1/intake/leads"),
    ).toThrow("not configured correctly");
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
    expect(dependencies.uploadedPaths).toEqual(["workspace-a/landing-a/source.zip"]);
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
    expect(dependencies.uploadedPaths).toEqual([]);
  });

  it("stores a private prepared bundle but requires API configuration before publication", async () => {
    const dependencies = fakeDependencies();
    const source = makeZip([{ name: "index.html", content: validHtml }]);
    const analysis = await analyzeLandingArchive(source);
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob([source]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );

    const connected = await connectLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        workspaceId: TEST_WORKSPACE_ID,
        landingId: TEST_LANDING_ID,
        publicFormId: "66666666-6666-4666-8666-666666666666",
        allowedOriginConfigured: false,
        intakeEndpoint: null,
        createArchiveVersion: () => "77777777-7777-4777-8777-777777777777",
      },
    );

    expect(connected.adapter_status).toBe("configuration_required");
    expect(connected.adapter_reason).toBe("api_url_not_configured");
    expect(connected.has_adapted_archive).toBe(true);
    expect("adapted_archive_path" in connected).toBe(false);
    expect(dependencies.record?.source_archive_path).toBe(
      `${TEST_WORKSPACE_ID}/${TEST_LANDING_ID}/source.zip`,
    );

    const preparedZip = await dependencies.storage.download(
      dependencies.record!.adapted_archive_path!,
    );
    expect(
      await analyzeLandingArchive(new Uint8Array(await preparedZip.arrayBuffer())),
    ).toMatchObject({
      hasIndexHtml: true,
      siteRootPath: "",
    });
  });

  it("persists the Pixel ID and refuses to download a configuration-required ZIP", async () => {
    const dependencies = fakeDependencies();
    const source = makeZip([{ name: "index.html", content: validHtml }]);
    const analysis = await analyzeLandingArchive(source);
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob([source]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );
    const connected = await connectLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        workspaceId: TEST_WORKSPACE_ID,
        landingId: TEST_LANDING_ID,
        publicFormId: "66666666-6666-4666-8666-666666666666",
        allowedOriginConfigured: false,
        intakeEndpoint: null,
        tiktokPixelId: "TT1234567890",
        googleAdsConversionId: "AW-123456789",
        googleAdsConversionLabel: "conversion-label",
      },
    );

    expect(connected.tiktok_pixel_id).toBe("TT1234567890");
    expect(connected.google_ads_conversion_id).toBe("AW-123456789");
    expect(connected.google_ads_conversion_label).toBe("conversion-label");
    expect(dependencies.record?.tiktok_pixel_id).toBe("TT1234567890");
    await expect(
      getDownloadableAdaptedArchive(
        { repository: dependencies.repository, storage: dependencies.storage },
        { workspaceId: TEST_WORKSPACE_ID, landingId: TEST_LANDING_ID },
      ),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("stores the selected profile IDs and a tracking snapshot with the prepared ZIP", async () => {
    const dependencies = fakeDependencies();
    const source = makeZip([{ name: "index.html", content: validHtml }]);
    const analysis = await analyzeLandingArchive(source);
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob([source]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );

    const prepared = await connectLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        workspaceId: TEST_WORKSPACE_ID,
        landingId: TEST_LANDING_ID,
        publicFormId: "66666666-6666-4666-8666-666666666666",
        allowedOriginConfigured: true,
        intakeEndpoint: "https://crm.example.com/api/v1/intake/leads",
        tiktokPixelId: "TikTokProfilePixel1",
        tiktokTrackingProfileId: "77777777-7777-4777-8777-777777777777",
        googleAdsConversionId: "AW-123456789",
        googleAdsConversionLabel: "conversion-label",
        googleAdsTrackingProfileId: "88888888-8888-4888-8888-888888888888",
        createArchiveVersion: () => "99999999-9999-4999-8999-999999999999",
      },
    );

    expect(prepared.adapter_status).toBe("prepared");
    expect(dependencies.record).toMatchObject({
      tiktok_tracking_profile_id: "77777777-7777-4777-8777-777777777777",
      google_ads_tracking_profile_id: "88888888-8888-4888-8888-888888888888",
      tiktok_pixel_id: "TikTokProfilePixel1",
      google_ads_conversion_id: "AW-123456789",
    });
    const storedFingerprint = dependencies.record!.adapted_tracking_fingerprint;
    expect(storedFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      await trackingFingerprint({
        tiktokProfileId: dependencies.record!.tiktok_tracking_profile_id,
        tiktokPixelId: dependencies.record!.tiktok_pixel_id,
        googleAdsProfileId: dependencies.record!.google_ads_tracking_profile_id,
        googleAdsConversionId: dependencies.record!.google_ads_conversion_id,
        googleAdsConversionLabel: dependencies.record!.google_ads_conversion_label,
      }),
    ).toBe(storedFingerprint);
  });

  it("does not adapt a draft through another workspace route", async () => {
    const dependencies = fakeDependencies();
    const source = makeZip([{ name: "index.html", content: validHtml }]);
    const analysis = await analyzeLandingArchive(source);
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob([source]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );

    await expect(
      connectLandingDraft(
        { repository: dependencies.repository, storage: dependencies.storage },
        {
          workspaceId: "99999999-9999-4999-8999-999999999999",
          landingId: TEST_LANDING_ID,
          publicFormId: "66666666-6666-4666-8666-666666666666",
          allowedOriginConfigured: false,
          intakeEndpoint: null,
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(dependencies.uploadedPaths).toEqual([
      `${TEST_WORKSPACE_ID}/${TEST_LANDING_ID}/source.zip`,
    ]);
  });

  it("rebuilds from the original and replaces its adapted archive without duplicate handlers", async () => {
    const dependencies = fakeDependencies();
    const source = makeZip([{ name: "index.html", content: validHtml }]);
    const analysis = await analyzeLandingArchive(source);
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob([source]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );
    const input = {
      workspaceId: TEST_WORKSPACE_ID,
      landingId: TEST_LANDING_ID,
      publicFormId: "66666666-6666-4666-8666-666666666666",
      allowedOriginConfigured: true,
      intakeEndpoint: "https://crm.example.com/api/v1/intake/leads",
    };
    await connectLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      { ...input, createArchiveVersion: () => "77777777-7777-4777-8777-777777777777" },
    );
    const firstPath = dependencies.record!.adapted_archive_path!;
    await connectLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      { ...input, createArchiveVersion: () => "88888888-8888-4888-8888-888888888888" },
    );

    expect(dependencies.record?.adapter_status).toBe("prepared");
    expect(dependencies.removedPaths).toContain(firstPath);
    const current = await dependencies.storage.download(dependencies.record!.adapted_archive_path!);
    const text = new TextDecoder().decode(new Uint8Array(await current.arrayBuffer()));
    expect((text.match(/<form data-crmonia-intake="1"/g) ?? []).length).toBe(1);
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
      async remove() {},
      async download() {
        throw new Error("storage failure");
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

  it("updates a draft name and offer without requiring a replacement ZIP", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob(["zip"]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );

    const updated = await updateLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing B",
        offerId: TEST_OFFER_B_ID,
        workspaceId: TEST_WORKSPACE_ID,
        landingId: TEST_LANDING_ID,
      },
    );

    expect(updated.name).toBe("Landing B");
    expect(updated.offer_id).toBe(TEST_OFFER_B_ID);
    expect(updated.offer_name).toBe("Offer B");
    expect(updated.source_archive_path).toBe(`${TEST_WORKSPACE_ID}/${TEST_LANDING_ID}/source.zip`);
    expect(dependencies.uploadedPaths).toHaveLength(1);
    expect(dependencies.removedPaths).toEqual([]);
  });

  it("uploads a replacement before switching the draft and removes the old ZIP afterward", async () => {
    const dependencies = fakeDependencies();
    const initialAnalysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: "<main>old</main>" }]),
    );
    const replacementAnalysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob(["old archive"]),
        analysis: initialAnalysis,
        createId: () => TEST_LANDING_ID,
      },
    );

    const updated = await updateLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        landingId: TEST_LANDING_ID,
        archive: new Blob(["replacement archive"]),
        analysis: replacementAnalysis,
        createArchiveVersion: () => "11111111-1111-4111-8111-111111111111",
      },
    );

    expect(updated.source_archive_path).toBe(
      `${TEST_WORKSPACE_ID}/${TEST_LANDING_ID}/source-11111111-1111-4111-8111-111111111111.zip`,
    );
    expect(updated.source_archive_bytes).toBe("replacement archive".length);
    expect(updated.analysis.forms).toHaveLength(1);
    expect(dependencies.removedPaths).toEqual([
      `${TEST_WORKSPACE_ID}/${TEST_LANDING_ID}/source.zip`,
    ]);
  });

  it("keeps the original archive when the metadata switch fails", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob(["old archive"]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );
    const originalPath = dependencies.record?.source_archive_path;
    dependencies.failUpdate = true;

    await expect(
      updateLandingDraft(
        { repository: dependencies.repository, storage: dependencies.storage },
        {
          name: "Renamed",
          offerId: TEST_OFFER_A_ID,
          workspaceId: TEST_WORKSPACE_ID,
          landingId: TEST_LANDING_ID,
          archive: new Blob(["replacement archive"]),
          analysis,
          createArchiveVersion: () => "11111111-1111-4111-8111-111111111111",
        },
      ),
    ).rejects.toThrow("database update failed");

    expect(dependencies.record?.source_archive_path).toBe(originalPath);
    expect(dependencies.removedPaths).toEqual([
      `${TEST_WORKSPACE_ID}/${TEST_LANDING_ID}/source-11111111-1111-4111-8111-111111111111.zip`,
    ]);
  });

  it("removes a draft archive and metadata, and supports retry after a Storage failure", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: "offer-a",
        workspaceId: "workspace-a",
        createdByUserId: "user-a",
        archive: new Blob(["archive"]),
        analysis,
        createId: () => "landing-a",
      },
    );
    dependencies.failRemove = true;

    await expect(
      deleteLandingDraft(
        { repository: dependencies.repository, storage: dependencies.storage },
        { workspaceId: "workspace-a", landingId: "landing-a" },
      ),
    ).rejects.toThrow("storage removal failed");
    expect(dependencies.record?.deletion_started_at).toBeTruthy();
    expect(dependencies.record?.source_archive_path).toBe("workspace-a/landing-a/source.zip");

    dependencies.failRemove = false;
    await deleteLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      { workspaceId: "workspace-a", landingId: "landing-a" },
    );
    expect(dependencies.removedPaths).toEqual(["workspace-a/landing-a/source.zip"]);
    expect(dependencies.record).toBeNull();
  });

  it("does not expose or delete a draft from another workspace", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: "offer-a",
        workspaceId: "workspace-a",
        createdByUserId: "user-a",
        archive: new Blob(["archive"]),
        analysis,
        createId: () => "landing-a",
      },
    );

    await deleteLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      { workspaceId: "workspace-b", landingId: "landing-a" },
    );
    expect(dependencies.record?.workspace_id).toBe("workspace-a");
    expect(dependencies.removedPaths).toEqual([]);
    await expect(
      connectLandingDraft(
        { repository: dependencies.repository, storage: dependencies.storage },
        {
          workspaceId: "workspace-b",
          landingId: "landing-a",
          publicFormId: "66666666-6666-4666-8666-666666666666",
          allowedOriginConfigured: true,
          intakeEndpoint: "https://crm.example.com/api/v1/intake/leads",
        },
      ),
    ).rejects.toThrow("Landing draft not found");
    expect(dependencies.uploadedPaths).toEqual(["workspace-a/landing-a/source.zip"]);
  });

  it("does not update a landing through a different workspace route", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: TEST_OFFER_A_ID,
        workspaceId: TEST_WORKSPACE_ID,
        createdByUserId: TEST_USER_ID,
        archive: new Blob(["archive"]),
        analysis,
        createId: () => TEST_LANDING_ID,
      },
    );

    await expect(
      updateLandingDraft(
        { repository: dependencies.repository, storage: dependencies.storage },
        {
          name: "Forged workspace",
          offerId: TEST_OFFER_A_ID,
          workspaceId: "66666666-6666-4666-8666-666666666666",
          landingId: TEST_LANDING_ID,
          archive: new Blob(["replacement"]),
          analysis,
        },
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(dependencies.record?.workspace_id).toBe(TEST_WORKSPACE_ID);
    expect(dependencies.uploadedPaths).toEqual([
      `${TEST_WORKSPACE_ID}/${TEST_LANDING_ID}/source.zip`,
    ]);
  });

  it("does not delete a published landing page", async () => {
    const dependencies = fakeDependencies();
    const analysis = await analyzeLandingArchive(
      makeZip([{ name: "index.html", content: validHtml }]),
    );
    await createLandingDraft(
      { repository: dependencies.repository, storage: dependencies.storage },
      {
        name: "Landing A",
        offerId: "offer-a",
        workspaceId: "workspace-a",
        createdByUserId: "user-a",
        archive: new Blob(["archive"]),
        analysis,
        createId: () => "landing-a",
      },
    );
    dependencies.status = "published";

    await expect(
      deleteLandingDraft(
        { repository: dependencies.repository, storage: dependencies.storage },
        { workspaceId: "workspace-a", landingId: "landing-a" },
      ),
    ).rejects.toThrow("Only landing drafts can be deleted");
    expect(dependencies.removedPaths).toEqual([]);
    expect(dependencies.record?.status).toBe("published");
  });

  it("rejects a landing mutation when the workspace permission check denies access", async () => {
    const deniedContext = {
      client: {
        rpc: async () => ({ data: false, error: null }),
      },
    } as unknown as AccessContext;

    await expect(
      requireWorkspacePermission(deniedContext, TEST_WORKSPACE_ID, "landing_pages.manage"),
    ).rejects.toMatchObject({ status: 403 });
  });
});
