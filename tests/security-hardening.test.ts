import { afterAll, beforeAll, describe, expect, it, spyOn } from "bun:test";
import type { Server } from "node:http";
import { z } from "zod";
import { ApiError } from "../src/lib/api-error";
import { accessErrorResponse } from "../src/lib/access/access.server";
import { fail, getController } from "../src/lib/leads/server-utils.server";
import { parseServerEnvironment } from "../server/src/config/env-schema";

const allowedOrigin = "http://localhost:5173";

// Use non-secret test values before loading the standalone server environment.
process.env.NODE_ENV = "test";
process.env.PORT = "4000";
process.env.SUPABASE_URL = "https://supabase.example.test";
process.env.SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
process.env.CORS_ORIGINS = allowedOrigin;

type CapturedResponse = {
  statusCode: number;
  body: Record<string, unknown>;
};

function createResponseCapture() {
  const captured: CapturedResponse = { statusCode: 0, body: {} };
  const response = {
    status(statusCode: number) {
      captured.statusCode = statusCode;
      return this;
    },
    json(body: Record<string, unknown>) {
      captured.body = body;
      return this;
    },
  };
  return { captured, response };
}

async function callExpressErrorHandler(error: unknown) {
  const { errorHandler } = await import("../server/src/middlewares/errorHandler");
  const capture = createResponseCapture();
  errorHandler(error, {} as never, capture.response as never, (() => {}) as never);
  return capture.captured;
}

describe("API error responses", () => {
  it("returns a readable validation error with a stable code and HTTP 400", async () => {
    const validationError = z
      .object({ email: z.string().email("Invalid email") })
      .safeParse({ email: "bad" }).error;
    expect(validationError).toBeDefined();

    const response = fail(validationError);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(body.error).toContain("Invalid email");
  });

  it("does not expose internal database details from TanStack lead routes", async () => {
    const logger = spyOn(console, "error").mockImplementation(() => {});
    const response = fail(new Error("PostgreSQL relation private.users does not exist"));
    const body = await response.json();
    logger.mockRestore();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      code: "INTERNAL_ERROR",
      error: "The request could not be completed",
    });
    expect(JSON.stringify(body)).not.toContain("PostgreSQL");
  });

  it("does not expose raw Supabase RPC messages", async () => {
    const logger = spyOn(console, "error").mockImplementation(() => {});
    const response = accessErrorResponse({
      code: "22023",
      message: "PostgreSQL internal constraint detail",
    });
    const body = await response.json();
    logger.mockRestore();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      success: false,
      code: "VALIDATION_ERROR",
      error: "Invalid request",
    });
    expect(JSON.stringify(body)).not.toContain("constraint");
  });

  it("returns an unauthenticated response before creating a Supabase client", async () => {
    let error: unknown;
    try {
      await getController(new Request("http://localhost/api/leads"));
    } catch (caught) {
      error = caught;
    }

    const response = fail(error instanceof ApiError ? error : new Error("Expected an auth error"));
    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toMatchObject({ success: false, code: "UNAUTHENTICATED", error: "Unauthorized" });
  });

  it("maps Express validation and internal errors without leaking server details", async () => {
    const logger = spyOn(console, "error").mockImplementation(() => {});
    const internal = await callExpressErrorHandler(new Error("PostgreSQL private schema detail"));
    logger.mockRestore();
    expect(internal.statusCode).toBe(500);
    expect(internal.body).toEqual({
      success: false,
      code: "INTERNAL_ERROR",
      error: "The request could not be completed",
    });
    expect(JSON.stringify(internal.body)).not.toContain("PostgreSQL");
  });

  it("rejects a request without a bearer token in Express", async () => {
    const { requireAuth } = await import("../server/src/middlewares/auth");
    let authError: unknown;
    await requireAuth({ headers: {} } as never, {} as never, (error?: unknown) => {
      authError = error;
    });

    const response = await callExpressErrorHandler(authError);
    expect(response.statusCode).toBe(401);
    expect(response.body).toMatchObject({ success: false, code: "UNAUTHENTICATED" });
  });
});

describe("Express CORS configuration", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const { createApp } = await import("../server/src/app");
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Test server did not bind a TCP port");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("allows an exact configured origin and handles authorization preflight", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: allowedOrigin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization,content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(allowedOrigin);
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    expect(response.headers.get("access-control-allow-methods")).toContain("GET");
    expect(response.headers.get("access-control-allow-headers")).toContain("Authorization");
  });

  it("returns a validation error for malformed Express JSON", async () => {
    const response = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ success: false, code: "VALIDATION_ERROR" });
    expect(body.error).toBe("Invalid JSON request body");
  });

  it("returns a sanitized 413 error when the Express JSON body exceeds 1 MB", async () => {
    const body = JSON.stringify({ payload: "x".repeat(1024 * 1024) });
    const response = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    const responseBody = await response.json();

    expect(response.status).toBe(413);
    expect(responseBody).toEqual({
      success: false,
      code: "PAYLOAD_TOO_LARGE",
      error: "Request body is too large",
    });
    expect(JSON.stringify(responseBody)).not.toContain("entity.too.large");
  });

  it("does not grant CORS access to an unlisted origin", async () => {
    const response = await fetch(`${baseUrl}/health`, {
      method: "OPTIONS",
      headers: {
        Origin: "https://untrusted.example.test",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("access-control-allow-credentials")).toBeNull();
  });
});

describe("standalone server environment", () => {
  const baseEnvironment = {
    NODE_ENV: "production",
    PORT: "4000",
    SUPABASE_URL: "https://supabase.example.test",
    SUPABASE_PUBLISHABLE_KEY: "test-publishable-key",
  };

  it("rejects production startup configuration without a CORS allowlist", () => {
    const parsed = parseServerEnvironment(baseEnvironment);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.errors.CORS_ORIGINS?.[0]).toContain("required");
    }
  });

  it("uses a finite localhost allowlist in development and rejects wildcards", () => {
    const development = parseServerEnvironment({ ...baseEnvironment, NODE_ENV: "development" });
    expect(development.success).toBe(true);
    if (development.success) {
      expect(development.data.CORS_ORIGINS).toEqual([
        "http://localhost:8080",
        "http://localhost:5173",
      ]);
    }

    const wildcard = parseServerEnvironment({ ...baseEnvironment, CORS_ORIGINS: "*" });
    expect(wildcard.success).toBe(false);
  });
});
