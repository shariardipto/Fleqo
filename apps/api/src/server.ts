import { createApp } from "./app.ts";
import { env } from "./config/env.ts";
import { createRunQueue } from "./engine/queue.ts";
import { logger } from "./lib/logger.ts";
import { prisma } from "./lib/prisma.ts";

const runQueue = createRunQueue();
const app = createApp({ runQueue });

const server = app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, `Fleqo API running on port ${env.PORT}`);
});

async function shutdown(signal: string) {
  logger.info({ signal }, "Shutting down API");
  server.close();
  await Promise.allSettled([runQueue.close(), prisma.$disconnect()]);
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
