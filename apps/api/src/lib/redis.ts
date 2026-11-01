import { Redis } from "ioredis";
import { env } from "../config/env.ts";

/**
 * Producer connections (API) fail fast so a Redis outage never blocks a request;
 * the database outbox re-dispatches anything that could not be enqueued.
 * Worker connections block and must retry indefinitely, as BullMQ requires.
 * `family: 0` resolves both IPv4 and IPv6: some hosts' private networks are IPv6-only, and
 * ioredis looks up IPv4 only by default.
 */
export function createRedisConnection(kind: "producer" | "worker"): Redis {
  if (kind === "producer") {
    return new Redis(env.REDIS_URL, {
      family: 0,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      connectTimeout: 2000,
      lazyConnect: false,
    });
  }
  return new Redis(env.REDIS_URL, { family: 0, maxRetriesPerRequest: null });
}
