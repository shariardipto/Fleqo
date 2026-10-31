import type { Logger } from "pino";
import { prisma } from "../lib/prisma.ts";
import type { JobState, RunQueue } from "./queue.ts";

const STALE_DISPATCH_MS = 2 * 60_000;

// BullMQ still owns these jobs: it will deliver them (or re-deliver stalled ones) itself.
const LIVE_JOB_STATES = new Set<JobState>(["waiting", "active", "delayed", "prioritized", "waiting-children"]);

/**
 * Re-dispatches unfinished runs whose queue job is gone or already finished (Redis data loss,
 * a job removed by hand, or a worker that died while recording the outcome of its final attempt).
 * It only resets outbox rows to `pending` with a new generation; execution itself stays
 * idempotent through run leases and action states.
 */
export async function recoverStaleRuns(queue: RunQueue, logger?: Logger): Promise<number> {
  const now = Date.now();
  const candidates = await prisma.workflowRun.findMany({
    where: {
      OR: [
        { status: "running", leaseExpiresAt: { lt: new Date(now - 5_000) } },
        { status: { in: ["queued", "retrying"] }, updatedAt: { lt: new Date(now - STALE_DISPATCH_MS) } },
      ],
      dispatch: { status: "dispatched" },
    },
    select: { id: true, organizationId: true, dispatch: { select: { id: true, generation: true } } },
    take: 50,
  });

  let recovered = 0;
  for (const run of candidates) {
    if (!run.dispatch) continue;
    const job = { workflowRunId: run.id, dispatchId: run.dispatch.id, generation: run.dispatch.generation };
    const state = await queue.jobState(job);
    if (LIVE_JOB_STATES.has(state)) continue;

    const reset = await prisma.eventDispatch.updateMany({
      where: { id: run.dispatch.id, generation: run.dispatch.generation, status: "dispatched" },
      data: { status: "pending", generation: { increment: 1 }, nextAttemptAt: new Date(), lastError: `Recovered: queue job ${state}` },
    });
    if (reset.count === 1) {
      recovered++;
      await prisma.executionLog.create({
        data: {
          organizationId: run.organizationId,
          workflowRunId: run.id,
          level: "warn",
          message: `Queue job ${state === "unknown" ? "missing" : state} for an unfinished run; re-dispatching from the outbox`,
        },
      });
      logger?.warn({ workflowRunId: run.id }, "Recovered stale run");
    }
  }
  return recovered;
}
