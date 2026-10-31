import type { Request } from "express";
import { AppError } from "./errors.ts";

/** Reads a route ID parameter; malformed IDs are reported as not found rather than leaking validation detail. */
export function idParam(req: Request, name = "id"): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^[\w-]+$/.test(value)) {
    throw new AppError("not_found", "Resource not found");
  }
  return value;
}
