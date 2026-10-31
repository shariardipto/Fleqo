import { Redis } from "ioredis";
import { env } from "../config/env.ts";

/**
 * Producer connections (API) fail fast so a Redis outage never blocks a request;
 * the database outbox re-dispatches anything that could not be enqueued.
 * Worker connections block and must retry indefinitely, as BullMQ requires.
 */
export function createRedisConnection(kind: "producer" | "worker"): Redis {
  if (kind === "producer") {
    return new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: false,
    });
  }
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
