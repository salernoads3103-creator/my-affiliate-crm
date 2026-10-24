import type {
  LandingArchiveAnalysis,
  LandingFieldAnalysis,
  LandingFormAnalysis,
  LandingPixel,
  LandingAnalysisWarning,
  LandingAdapterReason,
} from "./types";
import { MAX_LANDING_ARCHIVE_BYTES } from "./validation";

const MAX_ZIP_ENTRIES = 500;
const MAX_FILES = 500;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_ENTRY_BYTES = 50 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 200;
const MAX_INDEX_HTML_BYTES = 2 * 1024 * 1024;
const MAX_SCRIPT_SCAN_BYTES = 4 * 1024 * 1024;
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const ALLOWED_TRACKING_SCRIPT_HOSTS = new Set([
  "connect.facebook.net",
  "analytics.tiktok.com",
  "www.googletagmanager.com",
  "www.google-analytics.com",
]);

const ALLOWED_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".json",
  ".txt",
  ".xml",
  ".webmanifest",
  ".map",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
]);

type ZipEntry = {
  name: string;
  lowerName: string;
  isDirectory: boolean;
  method: number;
  flags: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  dataStart: number;
  dataEnd: number;
};

export class LandingArchiveError extends Error {
  constructor() {
    super("The ZIP archive is invalid or contains unsupported files.");
    this.name = "LandingArchiveError";
  }
}

function ensureRange(offset: number, length: number, limit: number): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new LandingArchiveError();
  }
  if (offset + length > limit) throw new LandingArchiveError();
}

function uint16(view: DataView, offset: number): number {
  ensureRange(offset, 2, view.byteLength);
  return view.getUint16(offset, true);
}

function uint32(view: DataView, offset: number): number {
  ensureRange(offset, 4, view.byteLength);
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  const earliest = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (uint32(view, offset) !== EOCD_SIGNATURE) continue;
    const commentLength = uint16(view, offset + 20);
    if (offset + 22 + commentLength === view.byteLength) return offset;
  }
  throw new LandingArchiveError();
}

function decodeFileName(bytes: Uint8Array, utf8: boolean): string {
  if (!utf8 && bytes.some((byte) => byte > 0x7f)) throw new LandingArchiveError();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new LandingArchiveError();
  }
}

function assertSafePath(name: string, isDirectory: boolean): string {
  if (
    !name ||
    name.length > 1024 ||
    name.startsWith("/") ||
    name.startsWith("\\") ||
    name.includes("\\") ||
    name.includes("\0") ||
    /^[a-z]:/i.test(name) ||
    name.includes("//")
  ) {
    throw new LandingArchiveError();
  }

  const path = isDirectory ? name.slice(0, -1) : name;
  const segments = path.split("/");
  if (
    segments.length === 0 ||
    segments.length > 32 ||
    segments.some((segment) => {
      if (
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes(":") ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      ) {
        return true;
      }
      try {
        const decoded = decodeURIComponent(segment);
        return (
          decoded === "." ||
          decoded === ".." ||
          decoded.includes("/") ||
          decoded.includes("\\") ||
          decoded.includes("\0")
        );
      } catch {
        return true;
      }
    })
  ) {
    throw new LandingArchiveError();
  }

  return path;
}

function assertAllowedFileType(path: string): void {
  const name = path.split("/").at(-1) ?? "";
  const extensionIndex = name.lastIndexOf(".");
  const extension = extensionIndex > 0 ? name.slice(extensionIndex).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.has(extension) && name.toLowerCase() !== "cname") {
    throw new LandingArchiveError();
  }
}

function parseEntries(bytes: Uint8Array): { entries: ZipEntry[]; uncompressedBytes: number } {
  if (bytes.byteLength < 22 || bytes.byteLength > MAX_LANDING_ARCHIVE_BYTES) {
    throw new LandingArchiveError();
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocdOffset = findEndOfCentralDirectory(view);
  const diskNumber = uint16(view, eocdOffset + 4);
  const centralDisk = uint16(view, eocdOffset + 6);
  const entriesOnDisk = uint16(view, eocdOffset + 8);
  const entryCount = uint16(view, eocdOffset + 10);
  const centralSize = uint32(view, eocdOffset + 12);
  const centralOffset = uint32(view, eocdOffset + 16);

  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount > MAX_ZIP_ENTRIES ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new LandingArchiveError();
  }
  ensureRange(centralOffset, centralSize, eocdOffset);

  const entries: ZipEntry[] = [];
  const normalizedNames = new Set<string>();
  const dataRanges: Array<{ start: number; end: number }> = [];
  let offset = centralOffset;
  let fileCount = 0;
  let uncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (uint32(view, offset) !== CENTRAL_SIGNATURE) throw new LandingArchiveError();
    const versionMadeBy = uint16(view, offset + 4);
    const flags = uint16(view, offset + 8);
    const method = uint16(view, offset + 10);
    const crc32 = uint32(view, offset + 16);
    const compressedSize = uint32(view, offset + 20);
    const uncompressedSize = uint32(view, offset + 24);
    const nameLength = uint16(view, offset + 28);
    const extraLength = uint16(view, offset + 30);
    const commentLength = uint16(view, offset + 32);
    const startDisk = uint16(view, offset + 34);
    const externalAttributes = uint32(view, offset + 38);
    const localHeaderOffset = uint32(view, offset + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    ensureRange(offset, recordLength, centralOffset + centralSize);

    if (
      (method !== 0 && method !== 8) ||
      (flags & ~(0x0008 | 0x0800 | (method === 8 ? 0x0006 : 0))) !== 0 ||
      startDisk !== 0 ||
      (method === 0 && compressedSize !== uncompressedSize) ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new LandingArchiveError();
    }

    const rawName = decodeFileName(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      (flags & 0x0800) !== 0,
    );
    const isDirectory = rawName.endsWith("/");
    const name = assertSafePath(rawName, isDirectory);
    const lowerName = name.normalize("NFC").toLowerCase();
    if (normalizedNames.has(lowerName)) throw new LandingArchiveError();
    normalizedNames.add(lowerName);

    const platform = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    const fileType = unixMode & 0xf000;
    const dosAttributes = externalAttributes & 0xffff;
    if (
      (platform === 3 && fileType !== 0 && fileType !== 0x8000 && fileType !== 0x4000) ||
      (dosAttributes & 0x0400) !== 0
    ) {
      // Reject symlinks and special files; only ordinary files/directories are accepted.
      throw new LandingArchiveError();
    }
    if (
      (isDirectory && (compressedSize !== 0 || uncompressedSize !== 0)) ||
      (!isDirectory && fileType === 0x4000)
    ) {
      throw new LandingArchiveError();
    }

    if (!isDirectory) {
      fileCount += 1;
      if (fileCount > MAX_FILES) throw new LandingArchiveError();
      assertAllowedFileType(name);
      if (uncompressedSize > MAX_ENTRY_BYTES) throw new LandingArchiveError();
      if (
        uncompressedSize > 0 &&
        (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)
      ) {
        throw new LandingArchiveError();
      }
      uncompressedBytes += uncompressedSize;
      if (uncompressedBytes > MAX_UNCOMPRESSED_BYTES) throw new LandingArchiveError();
    }

    if (localHeaderOffset >= centralOffset || uint32(view, localHeaderOffset) !== LOCAL_SIGNATURE) {
      throw new LandingArchiveError();
    }
    const localFlags = uint16(view, localHeaderOffset + 6);
    const localMethod = uint16(view, localHeaderOffset + 8);
    const localCrc32 = uint32(view, localHeaderOffset + 14);
    const localCompressedSize = uint32(view, localHeaderOffset + 18);
    const localUncompressedSize = uint32(view, localHeaderOffset + 22);
    const localNameLength = uint16(view, localHeaderOffset + 26);
    const localExtraLength = uint16(view, localHeaderOffset + 28);
    if (localFlags !== flags || localMethod !== method || localNameLength !== nameLength) {
      throw new LandingArchiveError();
    }
    const hasDataDescriptor = (flags & 0x0008) !== 0;
    const localValuesMatch =
      localCrc32 === crc32 &&
      localCompressedSize === compressedSize &&
      localUncompressedSize === uncompressedSize;
    const localValuesDeferred =
      [0, crc32].includes(localCrc32) &&
      [0, compressedSize].includes(localCompressedSize) &&
      [0, uncompressedSize].includes(localUncompressedSize);
    if ((!hasDataDescriptor && !localValuesMatch) || (hasDataDescriptor && !localValuesDeferred)) {
      throw new LandingArchiveError();
    }
    ensureRange(localHeaderOffset + 30, localNameLength + localExtraLength, centralOffset);
    const localName = decodeFileName(
      bytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength),
      (localFlags & 0x0800) !== 0,
    );
    if (localName !== rawName) throw new LandingArchiveError();

    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    ensureRange(dataStart, compressedSize, centralOffset);
    const dataEnd = dataStart + compressedSize;
    let localRecordEnd = dataEnd;
    if ((flags & 0x0008) !== 0) {
      let descriptorOffset = dataEnd;
      ensureRange(descriptorOffset, 4, centralOffset);
      if (uint32(view, descriptorOffset) === 0x08074b50) descriptorOffset += 4;
      ensureRange(descriptorOffset, 12, centralOffset);
      if (
        uint32(view, descriptorOffset) !== crc32 ||
        uint32(view, descriptorOffset + 4) !== compressedSize ||
        uint32(view, descriptorOffset + 8) !== uncompressedSize
      ) {
        throw new LandingArchiveError();
      }
      localRecordEnd = descriptorOffset + 12;
    }
    dataRanges.push({ start: localHeaderOffset, end: localRecordEnd });
    const entry: ZipEntry = {
      name,
      lowerName,
      isDirectory,
      method,
      flags,
      crc32,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStart,
      dataEnd,
    };
    entries.push(entry);
    offset += recordLength;
  }

  if (offset !== centralOffset + centralSize) throw new LandingArchiveError();
  dataRanges.sort((left, right) => left.start - right.start);
  for (let index = 1; index < dataRanges.length; index += 1) {
    if (dataRanges[index - 1].end > dataRanges[index].start) throw new LandingArchiveError();
  }

  return { entries, uncompressedBytes };
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function updateCrc32(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return crc;
}

async function inspectEntryContent(
  archiveBytes: Uint8Array,
  entry: ZipEntry,
  captureLimit: number | null,
): Promise<Uint8Array | null> {
  let actualSize = 0;
  let crc = 0xffffffff;
  const chunks: Uint8Array[] = [];
  const consume = (chunk: Uint8Array) => {
    actualSize += chunk.byteLength;
    if (actualSize > entry.uncompressedSize || actualSize > MAX_ENTRY_BYTES) {
      throw new LandingArchiveError();
    }
    if (captureLimit !== null && actualSize > captureLimit) throw new LandingArchiveError();
    crc = updateCrc32(crc, chunk);
    if (captureLimit !== null) chunks.push(chunk.slice());
  };

  try {
    const compressed = archiveBytes.subarray(entry.dataStart, entry.dataEnd);
    if (entry.method === 0) {
      consume(compressed);
    } else {
      const input = new Blob([compressed.slice().buffer]).stream();
      const stream = input.pipeThrough(new DecompressionStream("deflate-raw" as CompressionFormat));
      const reader = stream.getReader();
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        consume(result.value);
      }
    }
  } catch (error) {
    if (error instanceof LandingArchiveError) throw error;
    throw new LandingArchiveError();
  }

  if (
    actualSize !== entry.uncompressedSize ||
    (crc ^ 0xffffffff) >>> 0 !== entry.crc32 ||
    (actualSize > 0 && actualSize / Math.max(entry.compressedSize, 1) > MAX_COMPRESSION_RATIO)
  ) {
    throw new LandingArchiveError();
  }
  if (captureLimit === null) return null;

  const output = new Uint8Array(actualSize);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function readAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const expression = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (const match of source.matchAll(expression)) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function blankMarkup(source: string): string {
  return source.replace(/[^\r\n]/g, " ");
}

function maskNonFormContent(html: string): string {
  const withoutNonMarkup = html.replace(
    /<!--[\s\S]*?-->|<(script|style|title|iframe|noscript|template)\b[\s\S]*?<\/\1\s*>/gi,
    blankMarkup,
  );
  return withoutNonMarkup.replace(
    /(<textarea\b[^>]*>)([\s\S]*?)(<\/textarea\s*>)/gi,
    (_match, opening: string, content: string, closing: string) =>
      `${opening}${blankMarkup(content)}${closing}`,
  );
}

function hasAmbiguousFormMarkup(markup: string): boolean {
  const relevantTags = /<(?:form|input|textarea|select)\b[^>]*>/gi;
  for (const match of markup.matchAll(relevantTags)) {
    let quote: '"' | "'" | null = null;
    for (const character of match[0]) {
      if (quote === character) quote = null;
      else if (!quote && (character === '"' || character === "'")) quote = character;
    }
    if (quote) return true;
  }
  return false;
}

function analyzeForms(html: string): LandingFormAnalysis[] {
  const markup = maskNonFormContent(html);
  const forms = Array.from(markup.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form\s*>/gi)).slice(0, 20);

  return forms.map((form, index) => {
    const formAttributes = readAttributes(form[1]);
    const fields: LandingFieldAnalysis[] = [];
    const fieldExpression = /<(input|textarea|select)\b([^>]*)>/gi;
    for (const fieldMatch of form[2].matchAll(fieldExpression)) {
      if (fields.length >= 40) break;
      const attributes = readAttributes(fieldMatch[2]);
      const name = attributes.name || null;
      const id = attributes.id || null;
      const type =
        attributes.type?.toLowerCase() || (fieldMatch[1].toLowerCase() === "input" ? null : "text");
      const placeholder = attributes.placeholder || null;
      const { isName: isNameCandidate, isPhone: isPhoneCandidate } = candidateFlags(fieldMatch[0]);
      fields.push({ name, id, type, placeholder, isNameCandidate, isPhoneCandidate });
    }

    return {
      index: index + 1,
      action: formAttributes.action || null,
      method: (formAttributes.method || "get").toLowerCase(),
      fields,
      hasNameCandidate: fields.some((field) => field.isNameCandidate),
      hasPhoneCandidate: fields.some((field) => field.isPhoneCandidate),
    };
  });
}

function detectPixels(html: string): LandingPixel[] {
  const pixels: LandingPixel[] = [];
  if (/\bfbq\s*\(|connect\.facebook\.net|facebook\.com\/tr\?/i.test(html)) {
    pixels.push("meta");
  }
  if (/\bttq\.(?:load|page|track)\s*\(|analytics\.tiktok\.com/i.test(html)) {
    pixels.push("tiktok");
  }
  if (/google-analytics\.com\/analytics\.js/i.test(html)) {
    pixels.push("google_analytics");
  }
  if (/\bgtag\s*\(|googletagmanager\.com\/gtag\/js/i.test(html)) {
    pixels.push("google_tag");
  }
  if (/googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]+/i.test(html)) {
    pixels.push("google_tag_manager");
  }
  if (
    /googleadservices\.com\/pagead\/conversion(?:\.js|\b)|\bgoogle_conversion_(?:id|label)\b/i.test(
      html,
    )
  ) {
    pixels.push("google_ads");
  }
  return pixels;
}

type SiteRootSelection = {
  hasIndexHtml: boolean;
  siteRootPath: string | null;
  index: ZipEntry | null;
  ambiguous: boolean;
};

function selectSiteRoot(files: ZipEntry[]): SiteRootSelection {
  const indexFiles = files.filter((entry) => entry.lowerName.split("/").at(-1) === "index.html");
  const archiveRootIndex = indexFiles.find((entry) => entry.lowerName === "index.html");
  if (archiveRootIndex) {
    return { hasIndexHtml: true, siteRootPath: "", index: archiveRootIndex, ambiguous: false };
  }

  const rootCandidates = indexFiles.filter((entry) => entry.lowerName.split("/").length === 2);

  if (rootCandidates.length !== 1) {
    return {
      hasIndexHtml: indexFiles.length > 0,
      siteRootPath: null,
      index: null,
      ambiguous: indexFiles.length > 0,
    };
  }

  const index = rootCandidates[0];
  const slashIndex = index.name.lastIndexOf("/");
  const siteRootPath = index.name.slice(0, slashIndex + 1);
  const allFilesInsideOneFolder = files.every((entry) => entry.name.startsWith(siteRootPath));
  if (!allFilesInsideOneFolder) {
    return { hasIndexHtml: true, siteRootPath: null, index: null, ambiguous: true };
  }

  return { hasIndexHtml: true, siteRootPath, index, ambiguous: false };
}

export async function analyzeLandingArchive(bytes: Uint8Array): Promise<LandingArchiveAnalysis> {
  const parsed = parseEntries(bytes);
  const files = parsed.entries.filter((entry) => !entry.isDirectory);
  const root = selectSiteRoot(files);
  const siteRootPath = root.siteRootPath;
  const siteFiles =
    siteRootPath === null ? [] : files.filter((entry) => entry.name.startsWith(siteRootPath));
  const hasExternalJavaScript = siteFiles.some((entry) => /\.(?:m?js)$/i.test(entry.name));
  let indexHtml = "";
  let scannedScriptBytes = 0;
  let hasUnscannedScripts = false;
  let externalScripts = "";

  for (const entry of files) {
    const isInSiteRoot = siteRootPath !== null && entry.name.startsWith(siteRootPath);
    const isIndex = entry === root.index;
    const isScript = isInSiteRoot && /\.(?:m?js)$/i.test(entry.name);
    const canScanScript =
      isScript && scannedScriptBytes + entry.uncompressedSize <= MAX_SCRIPT_SCAN_BYTES;
    const content = await inspectEntryContent(
      bytes,
      entry,
      isIndex ? MAX_INDEX_HTML_BYTES : canScanScript ? MAX_SCRIPT_SCAN_BYTES : null,
    );
    if (isIndex && content) indexHtml = new TextDecoder("utf-8").decode(content);
    if (isScript) {
      if (canScanScript && content) {
        scannedScriptBytes += content.byteLength;
        externalScripts += `\n${new TextDecoder("utf-8").decode(content)}`;
      } else {
        hasUnscannedScripts = true;
      }
    }
  }

  const hasJavaScript = hasExternalJavaScript || /<script\b/i.test(indexHtml);
  const forms = root.index ? analyzeForms(indexHtml) : [];
  const hasStandardForm = forms.some((form) => form.hasNameCandidate && form.hasPhoneCandidate);
  const hasNameCandidate = forms.some((form) => form.hasNameCandidate);
  const hasPhoneCandidate = forms.some((form) => form.hasPhoneCandidate);
  const warnings: LandingAnalysisWarning[] = [];
  if (!root.hasIndexHtml) warnings.push("index_missing");
  if (root.ambiguous) warnings.push("root_ambiguous");
  if (root.index && forms.length === 0) warnings.push("form_missing");
  if (forms.length > 0 && !hasNameCandidate) warnings.push("name_field_missing");
  if (forms.length > 0 && !hasPhoneCandidate) warnings.push("phone_field_missing");
  if (hasJavaScript) warnings.push("javascript_present");
  if (hasUnscannedScripts) warnings.push("scripts_not_scanned");

  return {
    hasIndexHtml: root.hasIndexHtml,
    siteRootPath,
    fileCount: files.length,
    uncompressedBytes: parsed.uncompressedBytes,
    forms,
    detectedPixels: detectPixels(`${indexHtml}\n${externalScripts}`),
    hasJavaScript,
    requiresAdaptation: siteRootPath === null || !hasStandardForm,
    warnings,
  };
}

type PreparedSite = {
  entries: ZipEntry[];
  root: SiteRootSelection;
  adapterAssetName: string;
  html: string;
  scannedScripts: string[];
  formMatch: { index: number; html: string; analyzedMarkup: string };
  nameFieldOffset: number;
  phoneFieldOffset: number;
};

export class LandingAdapterError extends Error {
  constructor(readonly reason: LandingAdapterReason) {
    super(reason);
    this.name = "LandingAdapterError";
  }
}

function candidateFlags(tag: string): { isName: boolean; isPhone: boolean } {
  const tagName = /^<(input|textarea|select)\b/i.exec(tag)?.[1]?.toLowerCase();
  if (!tagName) return { isName: false, isPhone: false };
  const attributes = readAttributes(tag.slice(tagName.length + 1, -1));
  const type = attributes.type?.toLowerCase() || (tagName === "input" ? null : "text");
  if (
    attributes.disabled !== undefined ||
    attributes.readonly !== undefined ||
    ["hidden", "submit", "button", "reset", "image", "checkbox", "radio", "file"].includes(
      type ?? "",
    )
  ) {
    return { isName: false, isPhone: false };
  }
  const identifiers = [attributes.name, attributes.id].filter(Boolean).map(normalizeFieldHint);
  const isNonPersonName = identifiers.some((value) =>
    /^(?:product|offer|item|campaign|landing|page|file|image|company) name(?:\s|$)/u.test(value),
  );
  const nameSignals = [
    ...identifiers,
    normalizeFieldHint(attributes.placeholder ?? ""),
    normalizeFieldHint(attributes.autocomplete ?? ""),
  ];
  return {
    // Match one physical control by its semantic hints; a control with name,
    // id, autocomplete, and placeholder signals still contributes only once.
    isName:
      !isNonPersonName &&
      nameSignals.some((value) =>
        /(?:^|\s)(?:name|first name|full name|given name|family name|customer name|client name|lead name|ім.?я|им.?я|прізвище|фио)(?:\s|$)/iu.test(
          value,
        ),
      ),
    isPhone:
      type === "tel" ||
      /(?:phone|mobile|tel|телефон|номер)/iu.test(
        [attributes.name, attributes.id, attributes.placeholder, attributes.autocomplete]
          .filter(Boolean)
          .join(" ")
          .toLowerCase(),
      ),
  };
}

function normalizeFieldHint(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scriptsHaveSubmitBehavior(source: string): boolean {
  return (
    /\bonsubmit\s*=|\b(?:addEventListener|attachEvent)\s*\(\s*["']submit["']/i.test(source) ||
    /\b(?:XMLHttpRequest|fetch\s*\(|\.submit\s*\(|requestSubmit\s*\(|\.ajax\s*\()/i.test(source) ||
    /\.on\s*\(\s*["']submit["']/i.test(source)
  );
}

function isAllowedTrackingScript(source: string): boolean {
  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      ALLOWED_TRACKING_SCRIPT_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

async function prepareSite(bytes: Uint8Array): Promise<PreparedSite> {
  const parsed = parseEntries(bytes);
  const files = parsed.entries.filter((entry) => !entry.isDirectory);
  const root = selectSiteRoot(files);
  if (!root.hasIndexHtml) throw new LandingAdapterError("index_missing");
  if (!root.index || root.siteRootPath === null) {
    throw new LandingAdapterError("root_ambiguous");
  }

  const siteEntries = files.filter((entry) => entry.name.startsWith(root.siteRootPath!));
  const sitePaths = new Set(
    parsed.entries
      .filter((entry) => entry.name.startsWith(root.siteRootPath!))
      .map((entry) => entry.name.slice(root.siteRootPath!.length).toLowerCase()),
  );
  let adapterAssetName = "crmonia-intake-adapter.js";
  let suffix = 0;
  while (sitePaths.has(adapterAssetName.toLowerCase())) {
    suffix += 1;
    adapterAssetName = `crmonia-intake-adapter-${suffix}.js`;
  }

  let htmlBytes: Uint8Array | null = null;
  const scripts: string[] = [];
  let scannedScriptBytes = 0;
  let hasUnscannedScript = false;

  for (const entry of siteEntries) {
    const isIndex = entry === root.index;
    const isScript = /\.(?:m?js)$/i.test(entry.name);
    const canScanScript =
      isScript && scannedScriptBytes + entry.uncompressedSize <= MAX_SCRIPT_SCAN_BYTES;
    const content = await inspectEntryContent(
      bytes,
      entry,
      isIndex ? MAX_INDEX_HTML_BYTES : canScanScript ? MAX_SCRIPT_SCAN_BYTES : null,
    );
    if (isIndex) htmlBytes = content;
    if (isScript && canScanScript && content) {
      scannedScriptBytes += content.byteLength;
      try {
        scripts.push(new TextDecoder("utf-8", { fatal: true }).decode(content));
      } catch {
        throw new LandingAdapterError("external_script_unavailable");
      }
    } else if (isScript) {
      hasUnscannedScript = true;
    }
  }

  if (!htmlBytes) throw new LandingAdapterError("index_missing");
  let html: string;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(htmlBytes);
  } catch {
    throw new LandingAdapterError("invalid_html_encoding");
  }

  const markup = maskNonFormContent(html);
  if (hasAmbiguousFormMarkup(markup)) throw new LandingAdapterError("ambiguous_markup");
  if (/<base\b/i.test(markup)) throw new LandingAdapterError("base_url_present");
  const openingForms = Array.from(markup.matchAll(/<form\b/gi)).length;
  const closingForms = Array.from(markup.matchAll(/<\/form\s*>/gi)).length;
  if (openingForms !== closingForms) throw new LandingAdapterError("ambiguous_markup");
  const formMatches = Array.from(markup.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi));
  if (formMatches.length === 0) throw new LandingAdapterError("form_missing");
  if (openingForms !== 1 || formMatches.length !== 1) {
    throw new LandingAdapterError("multiple_forms");
  }
  const analyzedMatch = formMatches[0];
  const formStart = analyzedMatch.index ?? 0;
  const formHtml = html.slice(formStart, formStart + analyzedMatch[0].length);
  const openingTag = /^<form\b[^>]*>/i.exec(analyzedMatch[0])?.[0] ?? "";
  const openingAttributes = readAttributes(openingTag.slice(5, -1));
  if (Object.keys(openingAttributes).some((attribute) => attribute.startsWith("on"))) {
    throw new LandingAdapterError("custom_submit_handler");
  }
  const formTags = Array.from(analyzedMatch[0].matchAll(/<[a-z][^>]*>/gi));
  if (
    formTags.some((tag) =>
      Object.keys(readAttributes(tag[0].replace(/^<[^\s>]+/, ""))).some((attribute) =>
        /^(?:onsubmit|onclick)$/i.test(attribute),
      ),
    )
  ) {
    throw new LandingAdapterError("custom_submit_handler");
  }
  if (/\bdata-(?:netlify|formspree|formcarry|hubspot|tilda|amo|bitrix)\b/i.test(openingTag)) {
    throw new LandingAdapterError("third_party_form_action");
  }
  const action = openingAttributes.action;
  if (action && (/^(?:https?:)?\/\//i.test(action) || /^[a-z][a-z0-9+.-]*:/i.test(action))) {
    throw new LandingAdapterError("third_party_form_action");
  }
  if (/data-crmonia-(?:lead-field|intake)/i.test(analyzedMatch[0])) {
    throw new LandingAdapterError("custom_submit_handler");
  }

  const fieldTags = Array.from(analyzedMatch[0].matchAll(/<(input|textarea|select)\b[^>]*>/gi));
  const nameFields = fieldTags.flatMap((match, index) =>
    candidateFlags(match[0]).isName ? [index] : [],
  );
  const phoneFields = fieldTags.flatMap((match, index) =>
    candidateFlags(match[0]).isPhone ? [index] : [],
  );
  if (nameFields.length === 0) throw new LandingAdapterError("name_field_missing");
  if (nameFields.length !== 1) throw new LandingAdapterError("name_field_ambiguous");
  if (phoneFields.length === 0) throw new LandingAdapterError("phone_field_missing");
  if (phoneFields.length !== 1 || phoneFields[0] === nameFields[0]) {
    throw new LandingAdapterError("phone_field_ambiguous");
  }

  const inlineScripts = Array.from(html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi));
  const remoteScripts = inlineScripts.filter((match) => {
    const attributes = readAttributes(match[1]);
    const source = attributes.src;
    if (!source) return false;
    if (/^(?:https?:)?\/\//i.test(source)) {
      return !isAllowedTrackingScript(source);
    }
    const resolved = source.split(/[?#]/, 1)[0];
    const relative = resolved.startsWith("/") ? resolved.slice(1) : resolved;
    const fileName = `${root.siteRootPath}${relative}`.replace(/\.\//g, "");
    return !siteEntries.some((entry) => entry.name === fileName);
  });
  if (remoteScripts.length > 0) throw new LandingAdapterError("external_script_unavailable");
  if (
    scriptsHaveSubmitBehavior(
      `${inlineScripts.map((match) => match[2]).join("\n")}\n${scripts.join("\n")}`,
    )
  ) {
    throw new LandingAdapterError("custom_submit_handler");
  }
  if (hasUnscannedScript) throw new LandingAdapterError("external_script_unavailable");

  return {
    entries: siteEntries,
    root,
    adapterAssetName,
    html,
    scannedScripts: scripts,
    formMatch: { index: formStart, html: formHtml, analyzedMarkup: analyzedMatch[0] },
    nameFieldOffset: fieldTags[nameFields[0]].index ?? 0,
    phoneFieldOffset: fieldTags[phoneFields[0]].index ?? 0,
  };
}

// Kept as a separate preflight so integrations are not created for unsupported forms.
export async function checkLandingAdapterCompatibility(
  bytes: Uint8Array,
): Promise<LandingAdapterReason | null> {
  try {
    await prepareSite(bytes);
    return null;
  } catch (error) {
    if (error instanceof LandingAdapterError) return error.reason;
    if (error instanceof LandingArchiveError) return "invalid_archive";
    throw error;
  }
}

type OutputZipEntry = {
  name: string;
  method: 0 | 8;
  crc32: number;
  uncompressedSize: number;
  compressed: Uint8Array;
};

function write16(view: DataView, offset: number, value: number): void {
  view.setUint16(offset, value, true);
}

function write32(view: DataView, offset: number, value: number): void {
  view.setUint32(offset, value, true);
}

function checksum(bytes: Uint8Array): number {
  return (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const stream = new Blob([bytes.slice().buffer])
      .stream()
      .pipeThrough(new CompressionStream("deflate-raw" as CompressionFormat));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

function escapeAttribute(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
}

function safeJavaScriptString(value: string): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function adapterScript(
  formId: string,
  endpoint: string | null,
  pixelId: string | null,
  googleAdsConversionId: string | null,
  googleAdsConversionLabel: string | null,
): string {
  return `(() => {
  const formId = ${safeJavaScriptString(formId)};
  const endpoint = ${safeJavaScriptString(endpoint ?? "")};
  const pixelId = ${safeJavaScriptString(pixelId ?? "")};
  const googleAdsConversionId = ${safeJavaScriptString(googleAdsConversionId ?? "")};
  const googleAdsConversionLabel = ${safeJavaScriptString(googleAdsConversionLabel ?? "")};
  const bind = () => {
    document.querySelectorAll('form[data-crmonia-intake="1"]').forEach((form) => {
      if (form.getAttribute("data-crmonia-form-id") !== formId) return;
      if (form.dataset.crmoniaBound === "1") return;
      form.dataset.crmoniaBound = "1";
      let submitting = false;
      let attempt = null;
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitting) return;
        const status = form.nextElementSibling;
        const copy = document.documentElement.lang.toLowerCase().startsWith("en")
          ? { sending: "Sending…", success: "Thank you. Your request has been received.", failed: "We couldn't send your request. Please check your details and try again.", config: "Lead intake is not configured yet." }
          : { sending: "Надсилаємо…", success: "Дякуємо! Заявку отримано.", failed: "Не вдалося надіслати заявку. Перевірте дані й спробуйте ще раз.", config: "Приймання заявок ще не налаштовано." };
        if (!endpoint) {
          if (status) { status.textContent = copy.config; status.setAttribute("data-state", "error"); }
          return;
        }
        const nameField = form.querySelector('[data-crmonia-lead-field="name"]');
        const phoneField = form.querySelector('[data-crmonia-lead-field="phone"]');
        if (!nameField || !phoneField) {
          if (status) { status.textContent = copy.failed; status.setAttribute("data-state", "error"); }
          return;
        }
        const query = new URLSearchParams(window.location.search);
        const honeypot = form.querySelector('[name="website"]');
        const payload = {
          formId,
          name: nameField.value,
          phone: phoneField.value,
          website: honeypot ? honeypot.value : "",
          utmSource: query.get("utm_source") || undefined,
          utmMedium: query.get("utm_medium") || undefined,
          utmCampaign: query.get("utm_campaign") || undefined,
          utmContent: query.get("utm_content") || undefined,
          utmTerm: query.get("utm_term") || undefined,
          ttclid: query.get("ttclid") || undefined,
          gclid: query.get("gclid") || undefined,
          gbraid: query.get("gbraid") || undefined,
          wbraid: query.get("wbraid") || undefined,
          subId: query.get("sub_id") || undefined
        };
        const fingerprint = JSON.stringify(payload);
        if (!attempt || attempt.fingerprint !== fingerprint) {
          const cryptoApi = globalThis.crypto;
          let requestKey = cryptoApi && typeof cryptoApi.randomUUID === "function"
            ? cryptoApi.randomUUID()
            : null;
          if (!requestKey && cryptoApi && typeof cryptoApi.getRandomValues === "function") {
            const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
            bytes[6] = (bytes[6] & 15) | 64;
            bytes[8] = (bytes[8] & 63) | 128;
            const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
            requestKey = hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
          }
          if (!requestKey) {
            if (status) { status.textContent = copy.failed; status.setAttribute("data-state", "error"); }
            return;
          }
          attempt = { fingerprint, key: requestKey };
        }
        submitting = true;
        const submitters = Array.from(form.querySelectorAll('button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]'));
        const priorDisabled = submitters.map((button) => button.disabled);
        submitters.forEach((button) => { button.disabled = true; });
        if (status) { status.textContent = copy.sending; status.setAttribute("data-state", "pending"); }
        let accepted = false;
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.key },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          const result = await response.json().catch(() => null);
          if (response.status !== 202 || result?.success !== true || result?.accepted !== true) {
            throw new Error("INTAKE_FAILED");
          }
          accepted = true;
        } catch {
          if (status) { status.textContent = copy.failed; status.setAttribute("data-state", "error"); }
        } finally {
          window.clearTimeout(timeout);
          submitters.forEach((button, index) => { button.disabled = priorDisabled[index]; });
          submitting = false;
        }
        if (accepted) {
          const isHoneypotSubmission = Boolean(honeypot && honeypot.value.trim());
          form.reset();
          attempt = null;
          if (status) { status.textContent = copy.success; status.setAttribute("data-state", "success"); }
          if (!isHoneypotSubmission && pixelId && window.ttq && typeof window.ttq.instance === "function") {
            try {
              const pixel = window.ttq.instance(pixelId);
              if (pixel && typeof pixel.track === "function") pixel.track("SubmitForm");
            } catch { /* Pixel tracking must not change the accepted lead result. */ }
          }
          if (
            !isHoneypotSubmission &&
            googleAdsConversionId &&
            googleAdsConversionLabel &&
            typeof window.gtag === "function"
          ) {
            try {
              window.gtag("event", "conversion", {
                send_to: googleAdsConversionId + "/" + googleAdsConversionLabel,
              });
            } catch { /* Google Ads tracking must not change the accepted lead result. */ }
          }
        }
      });
    });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
`;
}

function tiktokPixelBaseScript(pixelId: string): string {
  const safePixelId = safeJavaScriptString(pixelId);
  return `!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=i,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};var o=d.createElement("script");o.type="text/javascript",o.async=!0,o.src=i+"?sdkid="+e+"&lib="+t;var a=d.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load(${safePixelId});ttq.page()}(window,document,"ttq");`;
}

function googleAdsBaseScript(conversionId: string): string {
  const safeConversionId = safeJavaScriptString(conversionId);
  return `window.dataLayer=window.dataLayer||[];window.gtag=window.gtag||function(){window.dataLayer.push(arguments)};window.gtag('js',new Date());window.gtag('config',${safeConversionId});var crmoniaGoogleTag=document.createElement('script');crmoniaGoogleTag.async=true;crmoniaGoogleTag.src='https://www.googletagmanager.com/gtag/js?id='+encodeURIComponent(${safeConversionId});var crmoniaFirstScript=document.getElementsByTagName('script')[0];if(crmoniaFirstScript&&crmoniaFirstScript.parentNode)crmoniaFirstScript.parentNode.insertBefore(crmoniaGoogleTag,crmoniaFirstScript);`;
}

function getTikTokPixelIds(source: string): Set<string> {
  const ids = new Set<string>();
  for (const match of source.matchAll(/\bttq\s*\.\s*load\s*\(\s*(['"])([A-Za-z0-9_-]{1,64})\1/gi)) {
    if (match[2]) ids.add(match[2]);
  }
  for (const match of source.matchAll(/[?&]sdkid=([A-Za-z0-9_-]{1,64})/gi)) {
    if (match[1]) ids.add(match[1]);
  }
  return ids;
}

function addAdapterToHtml(
  html: string,
  formMatch: PreparedSite["formMatch"],
  nameOffset: number,
  phoneOffset: number,
  formId: string,
  adapterAssetName: string,
  trackingBaseCodes: readonly string[],
): string {
  const formHtml = formMatch.html;
  const tagAt = (offset: number): string => {
    const match = /^<(?:input|textarea|select)\b[^>]*>/i.exec(
      formMatch.analyzedMarkup.slice(offset),
    );
    return match?.[0] ?? "";
  };
  const edits = [
    { offset: nameOffset, tag: tagAt(nameOffset), field: "name" },
    { offset: phoneOffset, tag: tagAt(phoneOffset), field: "phone" },
  ].sort((left, right) => right.offset - left.offset);
  let marked = formHtml;
  for (const edit of edits) {
    const replacement = edit.tag.replace(/\/?\s*>$/, ` data-crmonia-lead-field="${edit.field}">`);
    marked = `${marked.slice(0, edit.offset)}${replacement}${marked.slice(edit.offset + edit.tag.length)}`;
  }
  const withFormMarker = marked.replace(
    /^<form\b/i,
    `<form data-crmonia-intake="1" data-crmonia-form-id="${escapeAttribute(formId)}"`,
  );
  const withHoneypot = withFormMarker.replace(
    /<\/form\s*>$/i,
    '<label aria-hidden="true" data-crmonia-honeypot style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden" tabindex="-1">Website<input name="website" tabindex="-1" autocomplete="off"></label></form>',
  );
  const withStatus = withHoneypot.replace(
    /<\/form\s*>$/i,
    '</form><div data-crmonia-intake-status role="status" aria-live="polite"></div>',
  );
  const scriptTag = `<script src="${adapterAssetName}" defer></script>`;
  const at = formMatch.index;
  let result = html.slice(0, at) + withStatus + html.slice(at + formHtml.length);
  const bodyClose = /<\/body\s*>/i.exec(result);
  const htmlClose = /<\/html\s*>/i.exec(result);
  const insertAt = bodyClose?.index ?? htmlClose?.index ?? result.length;
  result = result.slice(0, insertAt) + scriptTag + result.slice(insertAt);
  if (trackingBaseCodes.length > 0) {
    const trackingScripts = trackingBaseCodes.map((code) => `<script>${code}</script>`).join("");
    const headClose = /<\/head\s*>/i.exec(result);
    const adapterAt = result.indexOf(scriptTag);
    const pixelAt = headClose?.index ?? (adapterAt >= 0 ? adapterAt : result.length);
    result = result.slice(0, pixelAt) + trackingScripts + result.slice(pixelAt);
  }
  return result;
}

async function buildZip(entries: OutputZipEntry[]): Promise<Uint8Array> {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name);
    const local = new Uint8Array(30 + name.byteLength + entry.compressed.byteLength);
    const localView = new DataView(local.buffer);
    write32(localView, 0, LOCAL_SIGNATURE);
    write16(localView, 4, 20);
    write16(localView, 6, 0x0800);
    write16(localView, 8, entry.method);
    write16(localView, 10, 0);
    write16(localView, 12, 0x21);
    write32(localView, 14, entry.crc32);
    write32(localView, 18, entry.compressed.byteLength);
    write32(localView, 22, entry.uncompressedSize);
    write16(localView, 26, name.byteLength);
    local.set(name, 30);
    local.set(entry.compressed, 30 + name.byteLength);
    locals.push(local);

    const central = new Uint8Array(46 + name.byteLength);
    const centralView = new DataView(central.buffer);
    write32(centralView, 0, CENTRAL_SIGNATURE);
    write16(centralView, 4, 0x0314);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0x0800);
    write16(centralView, 10, entry.method);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0x21);
    write32(centralView, 16, entry.crc32);
    write32(centralView, 20, entry.compressed.byteLength);
    write32(centralView, 24, entry.uncompressedSize);
    write16(centralView, 28, name.byteLength);
    write32(centralView, 38, 0x81a40000);
    write32(centralView, 42, localOffset);
    central.set(name, 46);
    centrals.push(central);
    localOffset += local.byteLength;
  }

  const centralSize = centrals.reduce((sum, record) => sum + record.byteLength, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, EOCD_SIGNATURE);
  write16(endView, 8, entries.length);
  write16(endView, 10, entries.length);
  write32(endView, 12, centralSize);
  write32(endView, 16, localOffset);
  const archive = new Uint8Array(localOffset + centralSize + end.byteLength);
  let offset = 0;
  for (const record of [...locals, ...centrals, end]) {
    archive.set(record, offset);
    offset += record.byteLength;
  }
  if (archive.byteLength > MAX_LANDING_ARCHIVE_BYTES) {
    throw new LandingAdapterError("archive_too_large");
  }
  return archive;
}

/** Builds a new static ZIP from the private source archive; the source remains untouched. */
export async function buildAdaptedLandingArchive(
  bytes: Uint8Array,
  input: {
    publicFormId: string;
    intakeEndpoint: string | null;
    tiktokPixelId?: string | null;
    googleAdsConversionId?: string | null;
    googleAdsConversionLabel?: string | null;
  },
): Promise<Uint8Array> {
  if (!/^[0-9a-f-]{36}$/i.test(input.publicFormId)) {
    throw new LandingAdapterError("custom_submit_handler");
  }
  const pixelId = input.tiktokPixelId?.trim() || null;
  if (pixelId && !/^[A-Za-z0-9_-]{1,64}$/.test(pixelId)) {
    throw new LandingAdapterError("tiktok_pixel_conflict");
  }
  const googleAdsConversionId = input.googleAdsConversionId?.trim() || null;
  const googleAdsConversionLabel = input.googleAdsConversionLabel?.trim() || null;
  if (
    Boolean(googleAdsConversionId) !== Boolean(googleAdsConversionLabel) ||
    (googleAdsConversionId !== null && !/^AW-[0-9]{1,20}$/.test(googleAdsConversionId)) ||
    (googleAdsConversionLabel !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(googleAdsConversionLabel))
  ) {
    throw new LandingAdapterError("google_ads_configuration_invalid");
  }
  const prepared = await prepareSite(bytes);
  const trackingBaseCodes: string[] = [];
  const trackingSource = `${prepared.html}\n${prepared.scannedScripts.join("\n")}`;
  const detectedPixels = detectPixels(trackingSource);
  if (
    googleAdsConversionId &&
    (detectedPixels.includes("google_analytics") ||
      detectedPixels.includes("google_tag") ||
      detectedPixels.includes("google_tag_manager") ||
      detectedPixels.includes("google_ads"))
  ) {
    throw new LandingAdapterError("google_ads_tag_conflict");
  }
  if (pixelId) {
    if (detectedPixels.includes("google_tag_manager")) {
      throw new LandingAdapterError("tiktok_pixel_conflict");
    }
    if (detectedPixels.includes("tiktok")) {
      const installedPixelIds = getTikTokPixelIds(trackingSource);
      if (installedPixelIds.size !== 1 || !installedPixelIds.has(pixelId)) {
        throw new LandingAdapterError("tiktok_pixel_conflict");
      }
    } else {
      trackingBaseCodes.push(tiktokPixelBaseScript(pixelId));
    }
  }
  if (googleAdsConversionId) trackingBaseCodes.push(googleAdsBaseScript(googleAdsConversionId));
  const adaptedForm = addAdapterToHtml(
    prepared.html,
    prepared.formMatch,
    prepared.nameFieldOffset,
    prepared.phoneFieldOffset,
    input.publicFormId,
    prepared.adapterAssetName,
    trackingBaseCodes,
  );
  const indexBytes = new TextEncoder().encode(adaptedForm);
  const outputEntries: OutputZipEntry[] = [];
  for (const entry of prepared.entries) {
    if (entry.isDirectory) continue;
    const name = entry.name.slice(prepared.root.siteRootPath!.length);
    if (entry === prepared.root.index) {
      const compressedHtml = entry.method === 0 ? null : await deflate(indexBytes);
      const method: 0 | 8 = compressedHtml ? 8 : 0;
      const compressed = compressedHtml ?? indexBytes;
      outputEntries.push({
        name: entry === prepared.root.index ? "index.html" : name,
        method,
        crc32: checksum(indexBytes),
        uncompressedSize: indexBytes.byteLength,
        compressed,
      });
    } else {
      outputEntries.push({
        name,
        method: entry.method as 0 | 8,
        crc32: entry.crc32,
        uncompressedSize: entry.uncompressedSize,
        compressed: bytes.subarray(entry.dataStart, entry.dataEnd).slice(),
      });
    }
  }
  if (outputEntries.length >= MAX_FILES) throw new LandingAdapterError("too_many_files");
  const adapterBytes = new TextEncoder().encode(
    adapterScript(
      input.publicFormId,
      input.intakeEndpoint,
      pixelId,
      googleAdsConversionId,
      googleAdsConversionLabel,
    ),
  );
  outputEntries.push({
    name: prepared.adapterAssetName,
    method: 0,
    crc32: checksum(adapterBytes),
    uncompressedSize: adapterBytes.byteLength,
    compressed: adapterBytes,
  });
  const result = await buildZip(outputEntries);
  const verifiedEntries = parseEntries(result).entries.filter((entry) => !entry.isDirectory);
  const verifiedIndex = verifiedEntries.find((entry) => entry.name.toLowerCase() === "index.html");
  const verifiedAdapter = verifiedEntries.find(
    (entry) => entry.name.toLowerCase() === prepared.adapterAssetName.toLowerCase(),
  );
  const verifiedIndexBytes = verifiedIndex
    ? await inspectEntryContent(result, verifiedIndex, MAX_INDEX_HTML_BYTES)
    : null;
  const verifiedHtml = verifiedIndexBytes
    ? new TextDecoder("utf-8", { fatal: true }).decode(verifiedIndexBytes)
    : "";
  if (
    !verifiedAdapter ||
    !verifiedHtml.includes(`<script src="${prepared.adapterAssetName}" defer></script>`) ||
    (verifiedHtml.match(/data-crmonia-intake="1"/g) ?? []).length !== 1
  ) {
    throw new LandingAdapterError("invalid_archive");
  }
  return result;
}
