import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

loadDotenv({ quiet: true });

function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("Set DATABASE_URL or TEST_DATABASE_URL to run tests");
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, "") || "fleqo"}_test`;
  return url.toString();
}

const databaseUrl = testDatabaseUrl();
process.env.TEST_DATABASE_URL = databaseUrl;

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globalSetup: ["./test/global-setup.ts"],
    // Test files share one database and Redis prefix, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: databaseUrl,
      QUEUE_PREFIX: "fleqo-test",
      BETTER_AUTH_URL: "http://localhost:3000",
      WEB_ORIGINS: "http://localhost:3000",
      WORKFLOW_MAX_ATTEMPTS: "4",
      WORKFLOW_BACKOFF_MS: "50",
      DISPATCH_POLL_MS: "200",
      RUN_LEASE_MS: "5000",
      RATE_LIMIT_API_PER_MIN: "100000",
      RATE_LIMIT_WEBHOOK_PER_MIN: "100000",
    },
  },
});
