import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.resolve(__dirname, "../..");
const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * E2E runs the real stack: Express API, BullMQ worker and the production Next.js build.
 * Each run signs up a brand-new user and organization, so existing data is never modified.
 * Set E2E_BASE_URL to test an already running (e.g. deployed) environment instead.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, testIgnore: /mobile/ },
    { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "npm run dev:api",
          cwd: repoRoot,
          url: "http://localhost:4000/api/ready",
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "npm run dev:worker",
          cwd: repoRoot,
          url: "http://localhost:4100/health",
          env: { ...(process.env as Record<string, string>), WORKER_HEALTH_PORT: "4100", WORKFLOW_BACKOFF_MS: "300" },
          reuseExistingServer: true,
          timeout: 120_000,
        },
        {
          command: "npm run start",
          url: `${baseURL}/sign-in`,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      ],
});
