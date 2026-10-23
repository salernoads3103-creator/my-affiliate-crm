export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "INTERNAL_ERROR";

export function apiErrorCodeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case 400:
      return "VALIDATION_ERROR";
    case 401:
      return "UNAUTHENTICATED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 413:
      return "PAYLOAD_TOO_LARGE";
    default:
      return "INTERNAL_ERROR";
  }
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;

  constructor(
    public status: number,
    message: string,
    code = apiErrorCodeForStatus(status),
    public cause?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export function apiErrorResponse(error: ApiError): Response {
  const message =
    error.code === "INTERNAL_ERROR" ? "The request could not be completed" : error.message;
  return Response.json(
    { success: false, code: error.code, error: message },
    { status: error.status },
  );
}
