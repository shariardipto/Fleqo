import { isAPIError } from "better-auth/api";
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError, type ErrorCode } from "../lib/errors.ts";
import { logger } from "../lib/logger.ts";

const codeByStatus: Record<number, ErrorCode> = {
  400: "bad_request",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "validation_failed",
  429: "rate_limited",
};

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError("not_found", `Route ${req.method} ${req.path} not found`));
};

/** Converts every error into `{ error: { code, message, details?, requestId } }` without leaking internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = String(req.id ?? "");
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (err instanceof ZodError) {
    appError = new AppError(
      "validation_failed",
      "Request validation failed",
      err.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  } else if (isAPIError(err)) {
    // Errors raised by Better Auth endpoints called from our routes (messages are user-safe).
    const code = codeByStatus[err.statusCode] ?? "bad_request";
    appError = new AppError(code, err.body?.message ?? err.message ?? "Request failed");
  } else if (err?.type === "entity.too.large") {
    appError = new AppError("payload_too_large", "Request body is too large");
  } else if (err?.type === "entity.parse.failed") {
    appError = new AppError("bad_request", "Request body is not valid JSON");
  } else {
    (req.log ?? logger).error({ err }, "Unhandled request error");
    appError = new AppError("internal_error", "An unexpected error occurred");
  }

  if (res.headersSent) return;
  res.status(appError.status).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
      requestId,
    },
  });
};
