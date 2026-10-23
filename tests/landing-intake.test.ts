import { describe, expect, it } from "bun:test";
import { createPublicIntakeHandler, type PublicIntakeBackend } from "../src/lib/intake/handler";
import { getClientIpFromTrustedHeader } from "../src/lib/intake/server-utils.server";

const PUBLIC_FORM_ID = "11111111-1111-4111-8111-111111111111";
const ALLOWED_ORIGIN = "https://shop.example.test";
const BASE_PAYLOAD = {
  formId: PUBLIC_FORM_ID,
  name: "Олена",
  phone: "050 123 45 67",
};

function createBackend(options: { active?: boolean; limit?: number; ipLimit?: number } = {}) {
  const idempotencyKeys = new Set<string>();
  const submissions: Array<{ formId: string; payload: unknown }> = [];
  const requestsPerIpAndForm = new Map<string, number>();
  let ipRequests = 0;
  const backend: PublicIntakeBackend = {
    consumeIpRateLimit: async () => {
      ipRequests += 1;
      return ipRequests <= (options.ipLimit ?? Number.MAX_SAFE_INTEGER);
    },
    isOriginAllowed: async (origin, formId) =>
      origin === ALLOWED_ORIGIN &&
      (!formId || formId === PUBLIC_FORM_ID) &&
      options.active !== false,
    submit: async (input) => {
      if (options.active === false || input.formId !== PUBLIC_FORM_ID) return "unavailable";
      if (idempotencyKeys.has(input.requestKeyHash)) return "accepted";
      const limitKey = `${input.formId}:${input.ipHash}`;
      const count = (requestsPerIpAndForm.get(limitKey) ?? 0) + 1;
      requestsPerIpAndForm.set(limitKey, count);
      if (count > (options.limit ?? 5)) return "rate_limited";
      idempotencyKeys.add(input.requestKeyHash);
      submissions.push({ formId: input.formId, payload: input.payload });
      return "accepted";
    },
  };
  return { backend, submissions };
}

function createHandler(options: { active?: boolean; limit?: number; ipLimit?: number } = {}) {
  const { backend, submissions } = createBackend(options);
  const handler = createPublicIntakeHandler({
    backend,
    hashIp: () => "ip-hash-for-test",
    now: () => 1_800_000_000_000,
    logError: () => {},
  });
  return { handler, submissions };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://crm.example.test/api/v1/intake/leads", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("public landing lead intake", () => {
  it("uses only a configured, valid proxy address header for IP limiting", () => {
    const request = new Request("https://crm.example.test/api/v1/intake/leads", {
      headers: { "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "198.51.100.8" },
    });
    expect(getClientIpFromTrustedHeader(request, null)).toBe("unknown");
    expect(getClientIpFromTrustedHeader(request, "cf-connecting-ip")).toBe("203.0.113.10");
    expect(
      getClientIpFromTrustedHeader(
        new Request(request.url, {
          headers: { "cf-connecting-ip": "forged" },
        }),
        "cf-connecting-ip",
      ),
    ).toBe("unknown");
    expect(
      getClientIpFromTrustedHeader(
        new Request(request.url, {
          headers: { "cf-connecting-ip": "2001:db8::10" },
        }),
        "cf-connecting-ip",
      ),
    ).toBe("2001:db8::10");
    expect(
      getClientIpFromTrustedHeader(
        new Request(request.url, {
          headers: { "cf-connecting-ip": "999.1.1.1" },
        }),
        "cf-connecting-ip",
      ),
    ).toBe("unknown");
  });

  it("accepts a valid Ukrainian phone and returns no lead or workspace details", async () => {
    const { handler, submissions } = createHandler();
    const response = await handler(post(BASE_PAYLOAD, { origin: ALLOWED_ORIGIN }));

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true, accepted: true });
    expect(response.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(submissions).toHaveLength(1);
    expect(submissions[0]?.payload).toMatchObject({
      name: "Олена",
      phoneNormalized: "+380501234567",
      email: null,
    });
    expect(submissions[0]?.payload).not.toHaveProperty("workspace_id");
  });

  it("rejects invalid Ukrainian phones before calling the backend", async () => {
    const { handler, submissions } = createHandler();
    const response = await handler(post({ ...BASE_PAYLOAD, phone: "+1 202 555 0100" }));
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("VALIDATION_ERROR");
    expect(submissions).toHaveLength(0);
  });

  it("rejects attempts to choose a workspace or other server-owned fields", async () => {
    const { handler, submissions } = createHandler();
    const response = await handler(post({ ...BASE_PAYLOAD, workspace_id: "foreign-workspace" }));
    expect(response.status).toBe(400);
    expect(submissions).toHaveLength(0);
  });

  it("quietly discards automated submissions that fill the honeypot field", async () => {
    const { handler, submissions } = createHandler();
    const response = await handler(post({ ...BASE_PAYLOAD, website: "bot-filled-value" }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ success: true, accepted: true });
    expect(submissions).toHaveLength(0);
  });

  it("returns the same unavailable response for inactive forms and unknown form IDs", async () => {
    const inactive = createHandler({ active: false });
    const inactiveResponse = await inactive.handler(post(BASE_PAYLOAD));
    expect(inactiveResponse.status).toBe(404);
    expect((await inactiveResponse.json()).code).toBe("FORM_UNAVAILABLE");

    const unknown = createHandler();
    const unknownResponse = await unknown.handler(
      post({ ...BASE_PAYLOAD, formId: "22222222-2222-4222-8222-222222222222" }),
    );
    expect(unknownResponse.status).toBe(404);
    expect((await unknownResponse.json()).code).toBe("FORM_UNAVAILABLE");
  });

  it("deduplicates requests that reuse their idempotency key", async () => {
    const { handler, submissions } = createHandler();
    const headers = { "idempotency-key": "same-request-key-123", origin: ALLOWED_ORIGIN };
    const first = await handler(post(BASE_PAYLOAD, headers));
    const replay = await handler(post(BASE_PAYLOAD, headers));
    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(submissions).toHaveLength(1);
  });

  it("enforces the per-form request limit", async () => {
    const { handler } = createHandler({ limit: 2 });
    const first = await handler(post(BASE_PAYLOAD, { "idempotency-key": "request-key-one" }));
    const second = await handler(
      post({ ...BASE_PAYLOAD, name: "Олена 2" }, { "idempotency-key": "request-key-two" }),
    );
    const limited = await handler(
      post({ ...BASE_PAYLOAD, name: "Олена 3" }, { "idempotency-key": "request-key-three" }),
    );
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(limited.status).toBe(429);
    expect((await limited.json()).code).toBe("RATE_LIMITED");
  });

  it("enforces the IP request limit before looking up form origins", async () => {
    const { handler } = createHandler({ ipLimit: 1 });
    const first = await handler(post(BASE_PAYLOAD));
    const limited = await handler(post({ ...BASE_PAYLOAD, name: "Інша заявка" }));
    expect(first.status).toBe(202);
    expect(limited.status).toBe(429);
  });

  it("allows preflight only for a configured origin and rejects other origins", async () => {
    const { handler } = createHandler();
    const preflight = await handler(
      new Request("https://crm.example.test/api/v1/intake/leads", {
        method: "OPTIONS",
        headers: {
          origin: ALLOWED_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type,idempotency-key",
        },
      }),
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(ALLOWED_ORIGIN);
    expect(preflight.headers.get("access-control-allow-credentials")).toBeNull();

    const denied = await handler(
      new Request("https://crm.example.test/api/v1/intake/leads", {
        method: "OPTIONS",
        headers: {
          origin: "https://evil.example.test",
          "access-control-request-method": "POST",
        },
      }),
    );
    expect(denied.status).toBe(403);
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not grant CORS access to a disallowed request origin", async () => {
    const { handler } = createHandler();
    const response = await handler(post(BASE_PAYLOAD, { origin: "https://evil.example.test" }));
    expect(response.status).toBe(404);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects a JSON body above the configured limit", async () => {
    const response = await createPublicIntakeHandler({
      backend: createBackend().backend,
      hashIp: () => "ip-hash-for-test",
      maxBodyBytes: 32,
      logError: () => {},
    })(post({ ...BASE_PAYLOAD, name: "x".repeat(80) }));
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("PAYLOAD_TOO_LARGE");
  });
});
