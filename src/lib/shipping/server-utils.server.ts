import { ZodError } from "zod";
import { ApiError } from "@/lib/api-error";
import { accessErrorResponse } from "@/lib/access/access.server";

export function shippingErrorResponse(error: unknown): Response {
  if (error instanceof ZodError) {
    return accessErrorResponse(new ApiError(400, "Check the delivery details", "VALIDATION_ERROR"));
  }
  return accessErrorResponse(error);
}
