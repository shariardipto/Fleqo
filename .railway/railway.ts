import { type BuildConfig, defineRailway, github, postgres, preserve, project, redis, service } from "railway/iac";

/**
 * Fleqo on Railway: PostgreSQL, Redis, the API and the BullMQ worker (the web app runs on Vercel).
 * Railway does not read this file during deploys. Apply it with the Railway CLI (>= 5.42.1) from a
 * linked checkout: `railway config plan`, then `railway config apply`. See docs/deployment.md.
 *
 * No secret or deployment-specific URL is stored here:
 * - Shared variables (Project Settings -> Shared Variables): BETTER_AUTH_SECRET, ENCRYPTION_KEY,
 *   BETTER_AUTH_URL, WEB_ORIGINS. Both services read them, so they can never drift apart.
 * - preserve(): optional API-only settings (OAuth, email) keep whatever is set on the service.
 */
const REPO = "shariardipto/Fleqo";

export default defineRailway((ctx) => {
  const db = postgres("Postgres");
  const cache = redis("Redis");

  // One image (apps/api/Dockerfile, built from the repository root) serves both services.
  const build: BuildConfig = {
    builder: "DOCKERFILE",
    dockerfilePath: "apps/api/Dockerfile",
    watchPatterns: ["apps/api/**", "package.json", "package-lock.json"],
  };

  const common = {
    NODE_ENV: "production",
    LOG_LEVEL: "info",
    DATABASE_URL: db.env.DATABASE_URL,
    REDIS_URL: cache.env.REDIS_URL,
    QUEUE_PREFIX: "fleqo",
    BETTER_AUTH_URL: ctx.shared.BETTER_AUTH_URL,
    WEB_ORIGINS: ctx.shared.WEB_ORIGINS,
    BETTER_AUTH_SECRET: ctx.shared.BETTER_AUTH_SECRET,
    ENCRYPTION_KEY: ctx.shared.ENCRYPTION_KEY,
    WORKFLOW_MAX_ATTEMPTS: "4",
    WORKFLOW_BACKOFF_MS: "2000",
  };

  const api = service("fleqo-api", {
    source: github(REPO, { branch: "main" }),
    build,
    deploy: {
      startCommand: "node dist/server.js",
      // Applies committed migrations only; a failure stops the deploy before traffic moves.
      preDeployCommand: ["npx prisma migrate deploy"],
      healthcheckPath: "/api/ready",
      healthcheckTimeout: 60,
      restartPolicyType: "ON_FAILURE",
      restartPolicyMaxRetries: 5,
      drainingSeconds: 15,
    },
    env: {
      ...common,
      FLEQO_SERVICE: "fleqo-api",
      // Vercel's proxy and Railway's edge sit in front of Express (verify after deploying: deployment.md §8).
      TRUST_PROXY: "2",
      RATE_LIMIT_API_PER_MIN: "600",
      RATE_LIMIT_WEBHOOK_PER_MIN: "1200",
      WEBHOOK_TOLERANCE_SECONDS: "300",
      // Social sign-in: a provider is offered only when both values are set (docs/social-auth.md).
      GOOGLE_CLIENT_ID: preserve(),
      GOOGLE_CLIENT_SECRET: preserve(),
      GITHUB_CLIENT_ID: preserve(),
      GITHUB_CLIENT_SECRET: preserve(),
      // Email verification and password reset (docs/email.md).
      EMAIL_PROVIDER: preserve(),
      EMAIL_FROM: preserve(),
      RESEND_API_KEY: preserve(),
      REQUIRE_EMAIL_VERIFICATION: preserve(),
    },
  });

  const worker = service("fleqo-worker", {
    source: github(REPO, { branch: "main" }),
    build,
    deploy: {
      startCommand: "node dist/worker.js",
      restartPolicyType: "ALWAYS",
      // In-flight jobs get time to finish on redeploys.
      drainingSeconds: 30,
    },
    env: {
      ...common,
      FLEQO_SERVICE: "fleqo-worker",
      WORKER_CONCURRENCY: "5",
      DISPATCH_POLL_MS: "2000",
      RUN_LEASE_MS: "60000",
    },
  });

  return project("fleqo", { resources: [db, cache, api, worker] });
});
