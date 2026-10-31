import { Prisma } from "../generated/prisma/client.ts";
import type { Logger } from "pino";
import { prisma } from "../lib/prisma.ts";
import type { RunQueue } from "./queue.ts";

interface ClaimedDispatch {
  id: string;
  workflowRunId: string;
  generation: number;
  attempts: number;
}

const CLAIM_LEASE_SECONDS = 30;
const backoffMs = (attempts: number) => Math.min(60_000, 1000 * 2 ** Math.max(0, attempts - 1));

/**
 * Outbox dispatcher: moves committed `pending` dispatch rows onto the queue.
 * Rows are claimed with FOR UPDATE SKIP LOCKED and a short lease, so concurrent dispatchers
 * (API best-effort path + worker poller) never enqueue the same row at the same time.
 * Enqueue failures leave the row pending with backoff; nothing persisted is ever lost.
 */
export async function dispatchPending(
  queue: RunQueue,
  options: { ids?: string[]; batchSize?: number; logger?: Logger } = {},
): Promise<{ dispatched: number; failed: number }> {
  const batchSize = options.batchSize ?? 100;
  const idFilter = options.ids ? Prisma.sql`AND id IN (${Prisma.join(options.ids)})` : Prisma.empty;
  if (options.ids && options.ids.length === 0) return { dispatched: 0, failed: 0 };

  const claimed = await prisma.$queryRaw<ClaimedDispatch[]>`
    UPDATE "event_dispatch"
       SET "nextAttemptAt" = now() + make_interval(secs => ${CLAIM_LEASE_SECONDS}),
           "attempts" = "attempts" + 1,
           "updatedAt" = now()
     WHERE id IN (
       SELECT id FROM "event_dispatch"
        WHERE status = 'pending' AND "nextAttemptAt" <= now() ${idFilter}
        ORDER BY "nextAttemptAt"
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED)
    RETURNING id, "workflowRunId", generation, attempts`;

  let dispatched = 0;
  let failed = 0;
  for (const row of claimed) {
    try {
      await queue.enqueue({ workflowRunId: row.workflowRunId, dispatchId: row.id, generation: row.generation });
      await prisma.eventDispatch.updateMany({
        where: { id: row.id, generation: row.generation, status: "pending" },
        data: { status: "dispatched", dispatchedAt: new Date(), lastError: null },
      });
      dispatched++;
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      await prisma.eventDispatch.update({
        where: { id: row.id },
        data: { lastError: message.slice(0, 500), nextAttemptAt: new Date(Date.now() + backoffMs(row.attempts)) },
      });
      options.logger?.warn({ dispatchId: row.id, err: message }, "Enqueue failed; dispatch stays pending for recovery");
    }
  }
  return { dispatched, failed };
}
