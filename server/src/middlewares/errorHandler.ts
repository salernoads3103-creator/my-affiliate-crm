import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { ApiError } from "../utils/ApiError";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    if (err.status >= 500) console.error("[api] Request failed", err.cause ?? err);
    return res.status(err.status).json({
      success: false,
      code: err.code,
      error: err.code === "INTERNAL_ERROR" ? "The request could not be completed" : err.message,
    });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      error: err.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "),
    });
  }
  if (
    err instanceof Error &&
    "type" in err &&
    err.type === "entity.too.large" &&
    "status" in err &&
    err.status === 413
  ) {
    return res.status(413).json({
      success: false,
      code: "PAYLOAD_TOO_LARGE",
      error: "Request body is too large",
    });
  }
  if (
    err instanceof SyntaxError &&
    "type" in err &&
    err.type === "entity.parse.failed" &&
    "status" in err &&
    err.status === 400
  ) {
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      error: "Invalid JSON request body",
    });
  }
  console.error("[api] Unhandled request error", err);
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error: "The request could not be completed",
  });
}
