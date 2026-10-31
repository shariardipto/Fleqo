import { Queue } from "bullmq";
import { pino } from "pino";
import { env } from "../../src/config/env.ts";
import { createRunQueue, RUN_QUEUE_NAME } from "../../src/engine/queue.ts";
import { createRunWorker } from "../../src/engine/worker.ts";
import { createRedisConnection } from "../../src/lib/redis.ts";
import { prisma } from "../../src/lib/prisma.ts";

export const silentLogger = pino({ level: "silent" });

/** Real BullMQ queue + worker(s) on the isolated test prefix. */
export function startTestWorkers(count = 1) {
  const runQueue = createRunQueue();
  const workers = Array.from({ length: count }, () => createRunWorker(silentLogger, { concurrency: 5 }));
  return {
    runQueue,
    async close() {
      await Promise.all(workers.map((w) => w.close()));
      await runQueue.close();
    },
  };
}

/** Removes all jobs on the test prefix. Refuses to run on any other prefix. */
export async function clearTestQueue() {
  if (!env.QUEUE_PREFIX.includes("test")) throw new Error("Refusing to clear a non-test queue prefix");
  const connection = createRedisConnection("producer");
  const queue = new Queue(RUN_QUEUE_NAME, { connection, prefix: env.QUEUE_PREFIX });
  await queue.obliterate({ force: true });
  await queue.close();
  connection.disconnect();
}

export async function waitFor<T>(check: () => Promise<T | false | null | undefined>, timeoutMs = 20_000, label = "condition") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

export const waitForRunsFinished = (expected: number, timeoutMs = 30_000) =>
  waitFor(
    async () => (await prisma.workflowRun.count({ where: { status: { in: ["succeeded", "failed"] } } })) >= expected,
    timeoutMs,
    `${expected} finished runs`,
  );
