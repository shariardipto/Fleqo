import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import { env } from "../config/env.ts";
import { createRedisConnection } from "../lib/redis.ts";

export const RUN_QUEUE_NAME = "workflow-runs";

export interface RunJobData {
  workflowRunId: string;
  dispatchId: string;
  generation: number;
}

/** Transport for run IDs. PostgreSQL stays the source of truth; the queue only delivers work. */
/** BullMQ job states; "unknown" means the job does not exist (any more). */
export type JobState = "waiting" | "active" | "delayed" | "prioritized" | "waiting-children" | "completed" | "failed" | "unknown";

export interface RunQueue {
  enqueue(job: RunJobData): Promise<void>;
  jobState(job: RunJobData): Promise<JobState>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

// One job per (run, dispatch generation). A manual retry bumps the generation so it gets a fresh job.
export const jobIdFor = (job: Pick<RunJobData, "workflowRunId" | "generation">) =>
  `run-${job.workflowRunId}-g${job.generation}`;

const ENQUEUE_TIMEOUT_MS = 3000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function createRunQueue(connection: Redis = createRedisConnection("producer")): RunQueue {
  // Swallow connection errors here; callers see failures as rejected enqueue calls.
  connection.on("error", () => {});
  const queue = new Queue<RunJobData>(RUN_QUEUE_NAME, {
    connection,
    prefix: env.QUEUE_PREFIX,
    defaultJobOptions: {
      attempts: env.WORKFLOW_MAX_ATTEMPTS,
      backoff: { type: "exponential", delay: env.WORKFLOW_BACKOFF_MS },
      removeOnComplete: { age: 24 * 3600, count: 5000 },
      removeOnFail: { age: 7 * 24 * 3600 },
    },
  });
  queue.on("error", () => {});

  return {
    async enqueue(job) {
      await withTimeout(queue.add("execute-run", job, { jobId: jobIdFor(job) }), ENQUEUE_TIMEOUT_MS, "enqueue");
    },
    async jobState(job) {
      return (await withTimeout(queue.getJobState(jobIdFor(job)), ENQUEUE_TIMEOUT_MS, "getJobState")) as JobState;
    },
    async ping() {
      try {
        return (await withTimeout(connection.ping(), 1000, "ping")) === "PONG";
      } catch {
        return false;
      }
    },
    async close() {
      await queue.close();
      connection.disconnect();
    },
  };
}
