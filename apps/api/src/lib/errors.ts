export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "no_active_organization"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "rate_limited"
  | "invalid_signature"
  | "stale_timestamp"
  | "unknown_connection"
  | "service_unavailable"
  | "internal_error";

const statusByCode: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  no_active_organization: 409,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  rate_limited: 429,
  invalid_signature: 401,
  stale_timestamp: 401,
  unknown_connection: 401,
  service_unavailable: 503,
  internal_error: 500,
};

/** An error whose code and message are safe to return to API clients. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = statusByCode[code];
    this.details = details;
  }
}

export const notFound = (resource: string) => new AppError("not_found", `${resource} not found`);
