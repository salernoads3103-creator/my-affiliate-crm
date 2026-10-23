import type {
  LandingArchiveAnalysis,
  LandingFieldAnalysis,
  LandingFormAnalysis,
  LandingPixel,
  LandingAnalysisWarning,
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

function updateCrc32(crc: number, bytes: Uint8Array): number {
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
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

function analyzeForms(html: string): LandingFormAnalysis[] {
  const markup = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, "");
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
      const description = [name, id, type, placeholder, attributes.autocomplete]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const isNameCandidate =
        /(?:name|first.?name|full.?name|customer|ім.?я|им.?я|прізвище|фио)/iu.test(description);
      const isPhoneCandidate =
        type === "tel" || /(?:phone|mobile|tel|телефон|номер)/iu.test(description);
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
  if (/\bgtag\s*\(|google-analytics\.com\/analytics\.js/i.test(html)) {
    pixels.push("google_analytics");
  }
  if (/googletagmanager\.com\/gtm\.js|\bGTM-[A-Z0-9]+/i.test(html)) {
    pixels.push("google_tag_manager");
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
