import { ZodError } from "zod";
import { ApiError } from "@/lib/api-error";
import { accessErrorResponse } from "@/lib/access/access.server";

export function productErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    const message = error.issues.map((issue) => issue.message).join("; ") || "Invalid product data";
    return accessErrorResponse(new ApiError(400, message, "VALIDATION_ERROR"));
  }
  return accessErrorResponse(error);
}
