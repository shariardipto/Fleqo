import { createServer } from "node:http";
import { createRunQueue } from "./engine/queue.ts";
import { createRunWorker, startDispatcherLoop } from "./engine/worker.ts";
import { logger as baseLogger } from "./lib/logger.ts";
import { prisma } from "./lib/prisma.ts";

const logger = baseLogger.child({ component: "worker" });

// Producer side for the outbox dispatcher; the consumer side executes runs.
const runQueue = createRunQueue();
const { worker, close: closeWorker } = createRunWorker(logger);
const dispatcher = startDispatcherLoop(runQueue, logger);

logger.info("Fleqo worker started (BullMQ consumer + outbox dispatcher)");

// Optional liveness endpoint for hosts that health-check processes (e.g. Railway).
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 0);
const healthServer =
  healthPort > 0
    ? createServer(async (req, res) => {
        if (req.url !== "/health") {
          res.writeHead(404).end();
          return;
        }
        const [database, redis] = await Promise.all([
          prisma.$queryRaw`SELECT 1`.then(
            () => true,
            () => false,
          ),
          runQueue.ping(),
        ]);
        const ok = database && redis && worker.isRunning();
        res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ service: "fleqo-worker", database, redis, consuming: worker.isRunning() }));
      }).listen(healthPort, () => logger.info({ port: healthPort }, "Worker health endpoint listening"))
    : null;

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down worker");
  dispatcher.stop();
  healthServer?.close();
  await Promise.allSettled([closeWorker(), runQueue.close()]);
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
