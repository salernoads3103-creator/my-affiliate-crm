import { PublicLeadIntakeSchema, normalizeIntakeInput } from "./validation";
import type { PublicLeadIntakeInput } from "./validation";

export type IntakeResult = "accepted" | "rate_limited" | "unavailable";

export type PublicIntakeBackend = {
  consumeIpRateLimit: (ipHash: string) => Promise<boolean>;
  isOriginAllowed: (origin: string, publicFormId?: string) => Promise<boolean>;
  submit: (input: {
    formId: string;
    requestKeyHash: string;
    ipHash: string;
    origin: string | null;
    payload: ReturnType<typeof normalizeIntakeInput>;
  }) => Promise<IntakeResult>;
};

type HandlerOptions = {
  backend: PublicIntakeBackend;
  hashIp: (request: Request) => string | Promise<string>;
  maxBodyBytes?: number;
  now?: () => number;
  logError?: (code: string) => void;
};

const DEFAULT_MAX_BODY_BYTES = 16 * 1024;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]{8,200}$/;

function json(status: number, body: Record<string, unknown>, headers?: HeadersInit): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json; charset=utf-8");
  responseHeaders.set("Cache-Control", "no-store");
  return Response.json(body, { status, headers: responseHeaders });
}

function corsHeaders(origin: string): Headers {
  return new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Idempotency-Key",
    "Access-Control-Max-Age": "600",
    Vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers",
  });
}

async function readJsonLimited(request: Request, maxBytes: number): Promise<unknown> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) throw new RangeError("BODY_TOO_LARGE");
  if (!request.body) throw new SyntaxError("INVALID_JSON");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RangeError("BODY_TOO_LARGE");
    }
    chunks.push(value);
  }

  const combined = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(combined)) as unknown;
  } catch {
    throw new SyntaxError("INVALID_JSON");
  }
}

async function hashIdempotencyKey(
  request: Request,
  payload: PublicLeadIntakeInput,
  now: number,
): Promise<string | null> {
  const key = request.headers.get("idempotency-key");
  if (key !== null && !IDEMPOTENCY_KEY_PATTERN.test(key)) return null;
  const source = key
    ? `key:${key}`
    : `body:${JSON.stringify(payload)}:${Math.floor(now / 120_000)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createPublicIntakeHandler({
  backend,
  hashIp,
  maxBodyBytes = DEFAULT_MAX_BODY_BYTES,
  now = Date.now,
  logError = (code) => console.error("[landing-intake] request failed", { code }),
}: HandlerOptions) {
  return async function handle(request: Request): Promise<Response> {
    const origin = request.headers.get("origin");

    if (request.method === "OPTIONS") {
      if (!origin) return new Response(null, { status: 204 });
      try {
        const requestedMethod = request.headers.get("access-control-request-method");
        const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "")
          .split(",")
          .map((header) => header.trim().toLowerCase())
          .filter(Boolean);
        if (
          requestedMethod !== "POST" ||
          requestedHeaders.some((header) => !["content-type", "idempotency-key"].includes(header))
        ) {
          return json(403, {
            success: false,
            code: "ORIGIN_NOT_ALLOWED",
            error: "This landing page is not allowed to submit leads.",
          });
        }
        const ipHash = await hashIp(request);
        if (!(await backend.consumeIpRateLimit(ipHash))) {
          return json(429, {
            success: false,
            code: "RATE_LIMITED",
            error: "Too many submissions. Please wait a moment and try again.",
          });
        }
        if (!(await backend.isOriginAllowed(origin))) {
          return json(403, {
            success: false,
            code: "ORIGIN_NOT_ALLOWED",
            error: "This landing page is not allowed to submit leads.",
          });
        }
        return new Response(null, { status: 204, headers: corsHeaders(origin) });
      } catch (error) {
        logError(error instanceof Error ? error.name : "PRELIGHT_CHECK_FAILED");
        return json(503, {
          success: false,
          code: "INTAKE_UNAVAILABLE",
          error: "Lead submission is temporarily unavailable.",
        });
      }
    }

    if (request.method !== "POST") {
      return json(
        405,
        { success: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed." },
        {
          Allow: "POST, OPTIONS",
        },
      );
    }
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      return json(415, {
        success: false,
        code: "UNSUPPORTED_MEDIA_TYPE",
        error: "Send the request as JSON.",
      });
    }

    let rawBody: unknown;
    try {
      rawBody = await readJsonLimited(request, maxBodyBytes);
    } catch (error) {
      if (error instanceof RangeError) {
        return json(413, {
          success: false,
          code: "PAYLOAD_TOO_LARGE",
          error: "The request is too large.",
        });
      }
      return json(400, {
        success: false,
        code: "VALIDATION_ERROR",
        error: "Check the submitted information and try again.",
      });
    }

    const parsed = PublicLeadIntakeSchema.safeParse(rawBody);
    if (!parsed.success) {
      return json(400, {
        success: false,
        code: "VALIDATION_ERROR",
        error: "Check the submitted information and try again.",
      });
    }
    let idempotencyHash: string | null;
    try {
      idempotencyHash = await hashIdempotencyKey(request, parsed.data, now());
    } catch (error) {
      logError(error instanceof Error ? error.name : "IDEMPOTENCY_HASH_FAILED");
      return json(503, {
        success: false,
        code: "INTAKE_UNAVAILABLE",
        error: "Lead submission is temporarily unavailable.",
      });
    }
    if (!idempotencyHash) {
      return json(400, {
        success: false,
        code: "VALIDATION_ERROR",
        error: "The request could not be accepted. Please try again.",
      });
    }

    let ipHash: string;
    try {
      ipHash = await hashIp(request);
      if (!(await backend.consumeIpRateLimit(ipHash))) {
        return json(429, {
          success: false,
          code: "RATE_LIMITED",
          error: "Too many submissions. Please wait a moment and try again.",
        });
      }
    } catch (error) {
      logError(error instanceof Error ? error.name : "IP_RATE_LIMIT_FAILED");
      return json(503, {
        success: false,
        code: "INTAKE_UNAVAILABLE",
        error: "Lead submission is temporarily unavailable.",
      });
    }

    let allowedOrigin: string | null = null;
    if (origin) {
      try {
        if (!(await backend.isOriginAllowed(origin, parsed.data.formId))) {
          return json(404, {
            success: false,
            code: "FORM_UNAVAILABLE",
            error: "This form is not available.",
          });
        }
        allowedOrigin = origin;
      } catch (error) {
        logError(error instanceof Error ? error.name : "ORIGIN_CHECK_FAILED");
        return json(503, {
          success: false,
          code: "INTAKE_UNAVAILABLE",
          error: "Lead submission is temporarily unavailable.",
        });
      }
    }

    const headers = allowedOrigin ? corsHeaders(allowedOrigin) : undefined;
    if (parsed.data.website?.trim()) {
      return json(202, { success: true, accepted: true }, headers);
    }
    try {
      const result = await backend.submit({
        formId: parsed.data.formId,
        requestKeyHash: idempotencyHash,
        ipHash,
        origin: allowedOrigin,
        payload: normalizeIntakeInput(parsed.data),
      });
      if (result === "rate_limited") {
        return json(
          429,
          {
            success: false,
            code: "RATE_LIMITED",
            error: "Too many submissions. Please wait a moment and try again.",
          },
          headers,
        );
      }
      if (result === "unavailable") {
        return json(
          404,
          {
            success: false,
            code: "FORM_UNAVAILABLE",
            error: "This form is not available.",
          },
          headers,
        );
      }
      return json(202, { success: true, accepted: true }, headers);
    } catch (error) {
      logError(error instanceof Error ? error.name : "INTAKE_FAILED");
      return json(
        503,
        {
          success: false,
          code: "INTAKE_UNAVAILABLE",
          error: "Lead submission is temporarily unavailable.",
        },
        headers,
      );
    }
  };
}
