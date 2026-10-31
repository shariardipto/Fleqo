import { Worker, type Job } from "bullmq";
import type { Logger } from "pino";
import { env } from "../config/env.ts";
import { createRedisConnection } from "../lib/redis.ts";
import { dispatchPending } from "./dispatcher.ts";
import { executeRun } from "./executor.ts";
import { RUN_QUEUE_NAME, type RunJobData, type RunQueue } from "./queue.ts";
import { recoverStaleRuns } from "./recovery.ts";

export function createRunWorker(logger: Logger, options: { concurrency?: number } = {}) {
  const connection = createRedisConnection("worker");
  const worker = new Worker<RunJobData>(
    RUN_QUEUE_NAME,
    async (job: Job<RunJobData>) => {
      const maxAttempts = job.opts.attempts ?? 1;
      return executeRun(job.data.workflowRunId, { attempt: job.attemptsMade + 1, maxAttempts }, logger);
    },
    {
      connection,
      prefix: env.QUEUE_PREFIX,
      concurrency: options.concurrency ?? env.WORKER_CONCURRENCY,
      lockDuration: Math.max(30_000, env.RUN_LEASE_MS),
    },
  );

  worker.on("completed", (job, outcome) => logger.info({ jobId: job.id, outcome }, "Job completed"));
  worker.on("failed", (job, error) =>
    logger.warn({ jobId: job?.id, attemptsMade: job?.attemptsMade, err: error.message }, "Job attempt failed"),
  );
  worker.on("error", (error) => logger.error({ err: error }, "Worker error"));

  return {
    worker,
    async close() {
      await worker.close();
      connection.disconnect();
    },
  };
}

/** Periodic outbox dispatch + stale-run recovery. Survives transient Redis/DB errors. */
export function startDispatcherLoop(queue: RunQueue, logger: Logger, intervalMs = env.DISPATCH_POLL_MS) {
  let running = false;
  let ticks = 0;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await dispatchPending(queue, { logger });
      if (result.dispatched || result.failed) logger.info(result, "Outbox dispatch pass");
      // Recovery is cheaper to run less often.
      if (++ticks % 10 === 0) await recoverStaleRuns(queue, logger);
    } catch (error) {
      logger.error({ err: error }, "Dispatcher pass failed");
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), intervalMs);
  void tick();
  return {
    tick,
    stop() {
      clearInterval(timer);
    },
  };
}
