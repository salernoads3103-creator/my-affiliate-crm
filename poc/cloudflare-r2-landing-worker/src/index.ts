export interface R2ObjectBodyLike {
  body: ReadableStream<Uint8Array>;
  size: number;
}

export interface R2BucketReader {
  get(key: string): Promise<R2ObjectBodyLike | null>;
}

export interface Env {
  LANDING_BUCKET: R2BucketReader;
}

type HostManifest = {
  sitePrefix: string;
};

const MANIFEST_PREFIX = "host-manifests/";
const MAX_MANIFEST_BYTES = 4_096;
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const SITE_SEGMENT = /^[a-zA-Z0-9_-]{1,64}$/;
const UUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  css: "text/css; charset=utf-8",
  eot: "application/vnd.ms-fontobject",
  gif: "image/gif",
  html: "text/html; charset=utf-8",
  ico: "image/x-icon",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript; charset=utf-8",
  json: "application/json; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  map: "application/json; charset=utf-8",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml; charset=utf-8",
};

function normalizeHostname(hostname: string): string | null {
  const normalized = hostname.toLowerCase();
  if (normalized.length > 253 || normalized.endsWith(".")) return null;

  const labels = normalized.split(".");
  if (labels.length < 2 || labels.some((label) => label.length > 63 || !DNS_LABEL.test(label))) {
    return null;
  }

  return normalized;
}

function resolveRelativePath(pathname: string): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (
    !decodedPath.startsWith("/") ||
    decodedPath.includes("\\") ||
    hasControlCharacters(decodedPath)
  ) {
    return null;
  }

  let relativePath = decodedPath.slice(1);
  if (relativePath === "") relativePath = "index.html";
  else if (relativePath.endsWith("/")) relativePath += "index.html";

  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) => segment === "" || segment === "." || segment === ".." || segment.startsWith("."),
    )
  ) {
    return null;
  }

  return relativePath;
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || codePoint === 127) return true;
  }
  return false;
}

function isValidSitePrefix(value: unknown): value is string {
  if (typeof value !== "string" || !value.endsWith("/")) return false;

  const segments = value.slice(0, -1).split("/");
  const legacyPocPrefix =
    segments.length === 3 &&
    segments[0] === "sites" &&
    segments.slice(1).every((segment) => SITE_SEGMENT.test(segment));
  const crmoniaPublicationPrefix =
    segments.length === 5 &&
    segments[0] === "crmonia" &&
    segments[1] === "landing-sites" &&
    segments.slice(2).every((segment) => UUID_SEGMENT.test(segment));
  return legacyPocPrefix || crmoniaPublicationPrefix;
}

async function readManifest(
  bucket: R2BucketReader,
  hostname: string,
): Promise<HostManifest | null> {
  const object = await bucket.get(`${MANIFEST_PREFIX}${hostname}.json`);
  if (!object || object.size > MAX_MANIFEST_BYTES) return null;

  const text = await new Response(object.body).text();
  if (text.length > MAX_MANIFEST_BYTES) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("sitePrefix" in parsed) ||
    !isValidSitePrefix(parsed.sitePrefix)
  ) {
    return null;
  }

  return { sitePrefix: parsed.sitePrefix };
}

function contentTypeFor(path: string): string {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return CONTENT_TYPES[extension] ?? "application/octet-stream";
}

function responseHeaders(contentType?: string): Headers {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
  });
  if (contentType) headers.set("Content-Type", contentType);
  return headers;
}

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: responseHeaders("text/plain; charset=utf-8"),
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const headers = responseHeaders("text/plain; charset=utf-8");
    headers.set("Allow", "GET, HEAD");
    return new Response("Method not allowed", {
      status: 405,
      headers,
    });
  }

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response("Bad request", {
      status: 400,
      headers: responseHeaders("text/plain; charset=utf-8"),
    });
  }

  const hostname = normalizeHostname(url.hostname);
  const relativePath = resolveRelativePath(url.pathname);
  if (!hostname || !relativePath) {
    return new Response("Bad request", {
      status: 400,
      headers: responseHeaders("text/plain; charset=utf-8"),
    });
  }

  try {
    const manifest = await readManifest(env.LANDING_BUCKET, hostname);
    if (!manifest) return notFound();

    const object = await env.LANDING_BUCKET.get(`${manifest.sitePrefix}${relativePath}`);
    if (!object) return notFound();

    const headers = responseHeaders(contentTypeFor(relativePath));
    if (request.method === "HEAD") {
      await object.body.cancel();
      return new Response(null, { status: 200, headers });
    }

    return new Response(object.body, { status: 200, headers });
  } catch {
    return new Response("Storage unavailable", {
      status: 502,
      headers: responseHeaders("text/plain; charset=utf-8"),
    });
  }
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
