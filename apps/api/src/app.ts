import { randomUUID } from "node:crypto";
import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.ts";
import type { RunQueue } from "./engine/queue.ts";
import { auth } from "./lib/auth.ts";
import { AppError } from "./lib/errors.ts";
import { logger } from "./lib/logger.ts";
import { prisma } from "./lib/prisma.ts";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.ts";
import { requireTrustedOrigin } from "./middleware/origin-check.ts";
import { connectionsRouter } from "./modules/connections/connections.routes.ts";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes.ts";
import { executionsRouter } from "./modules/executions/executions.routes.ts";
import { demoRouter } from "./modules/demo/demo.routes.ts";
import type { FetchJson } from "./modules/demo/import.service.ts";
import { organizationsRouter } from "./modules/organizations/organizations.routes.ts";
import { publicRouter } from "./modules/public/public.routes.ts";
import { webhooksRouter } from "./modules/webhooks/webhooks.routes.ts";
import { workflowsRouter } from "./modules/workflows/workflows.routes.ts";

const limiterHandler = () => {
  throw new AppError("rate_limited", "Too many requests, slow down");
};

export interface AppDeps {
  runQueue: RunQueue;
  /** Overrides the public-data HTTP client (tests run offline). */
  fetchJson?: FetchJson;
}

export function createApp(deps: AppDeps) {
  const app = express();

  app.disable("x-powered-by");
  if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader("X-Request-Id", id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === "/api/health" },
      // Client IP as resolved through TRUST_PROXY; used to verify proxy settings after deployment.
      customProps: (req) => ({ clientIp: (req as unknown as express.Request).ip }),
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGINS, credentials: true }));
  // API responses hold tenant data: never let a CDN or browser cache them.
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.get("/api/health", (_req, res) => {
    res.status(200).json({ success: true, message: "Fleqo API is running!", service: "fleqo-api" });
  });

  app.get("/api/db-health", async (req, res) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      res.status(200).json({ success: true, database: "connected", service: "fleqo-api" });
    } catch (error) {
      req.log.error({ err: error }, "Database health check failed");
      res.status(503).json({ success: false, database: "unavailable" });
    }
  });

  app.get("/api/ready", async (_req, res) => {
    const [database, redis] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(
        () => true,
        () => false,
      ),
      deps.runQueue.ping(),
    ]);
    res.status(database && redis ? 200 : 503).json({
      success: database && redis,
      database: database ? "connected" : "unavailable",
      redis: redis ? "connected" : "unavailable",
    });
  });

  // Better Auth reads its own request body, and webhooks need the raw bytes for HMAC,
  // so both are mounted before express.json().
  app.all("/api/auth/*splat", toNodeHandler(auth));
  app.use("/api", webhooksRouter(deps.runQueue));

  app.use(express.json({ limit: "256kb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: env.RATE_LIMIT_API_PER_MIN,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: limiterHandler,
    }),
  );
  app.use("/api", requireTrustedOrigin(env.WEB_ORIGINS));

  app.use("/api", publicRouter());
  app.use("/api", organizationsRouter());
  app.use("/api", connectionsRouter());
  app.use("/api", demoRouter({ runQueue: deps.runQueue, fetchJson: deps.fetchJson }));
  app.use("/api", workflowsRouter());
  app.use("/api", executionsRouter(deps.runQueue));
  app.use("/api", dashboardRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
