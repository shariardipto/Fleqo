import express, { Router } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "../../config/env.ts";
import type { RunQueue } from "../../engine/queue.ts";
import { AppError } from "../../lib/errors.ts";
import { ingestOrderEvent, WEBHOOK_HEADERS } from "./ingest.service.ts";

const header = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * Public signed webhook receiver. Mounted BEFORE express.json() so the HMAC is computed
 * over the exact bytes the sender signed.
 */
export function webhooksRouter(queue: RunQueue) {
  const router = Router();

  router.post(
    "/webhooks/mock-store",
    rateLimit({
      windowMs: 60_000,
      limit: env.RATE_LIMIT_WEBHOOK_PER_MIN,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      // Keyed by client IP only: a key that included the (attacker-chosen) connection header
      // could be rotated to bypass the limit and force a connection lookup per request.
      keyGenerator: (req) => ipKeyGenerator(req.ip ?? ""),
      handler: () => {
        throw new AppError("rate_limited", "Too many webhook deliveries");
      },
    }),
    express.raw({ type: "application/json", limit: "64kb" }),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError("bad_request", "Content-Type must be application/json");
      const result = await ingestOrderEvent(
        {
          rawBody: req.body,
          connectionPublicId: header(req.headers[WEBHOOK_HEADERS.connection]),
          timestamp: header(req.headers[WEBHOOK_HEADERS.timestamp]),
          signature: header(req.headers[WEBHOOK_HEADERS.signature]),
          source: "webhook",
        },
        queue,
        req.log,
      );
      res.status(result.status === "accepted" ? 202 : 200).json(result);
    },
  );

  return router;
}
