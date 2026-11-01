/**
 * Single-service entry point for low-cost demos (one free web service, e.g. Render Free): applies
 * migrations, then runs the unchanged API (server.js) and worker (worker.js) as two supervised child
 * processes in one container. Production keeps them as separate services; see docs/deployment-demo.md.
 *
 * - Migrations: before anything starts, `_prisma_migrations` is compared with the image's migration
 *   folders (about 1.5 s on 0.1 vCPU). Only when something is pending, or the check is inconclusive, does
 *   `prisma migrate deploy` run with the bundled CLI (about 20 s on 0.1 vCPU even when there is nothing to
 *   do). Both are retried while the database wakes up (Neon scales to zero). Prisma's advisory lock makes
 *   an overlapping old/new instance safe; a migration that keeps failing stops the service before it takes
 *   traffic.
 * - Start order: the API first, the worker once the API answers. The worker runs at a lower CPU priority
 *   so visitors' requests win when both compete for a fraction of a CPU.
 * - Restarts: a crashed child is restarted with exponential backoff. After too many crashes in a short
 *   window everything stops with exit code 1, so the platform restarts the whole service.
 * - Shutdown: SIGTERM/SIGINT go to both children, which get SHUTDOWN_GRACE_MS before SIGKILL.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = fileURLToPath(import.meta.url);
const ext = path.extname(here); // .js when compiled, .ts under tsx
const apiDir = path.resolve(path.dirname(here), ".."); // apps/api: prisma.config.ts lives here

const MIGRATE_ON_START = process.env.DEMO_MIGRATE_ON_START !== "false";
const MIGRATE_ATTEMPTS = 5;
const API_START_TIMEOUT_MS = 180_000;
const SHUTDOWN_GRACE_MS = 25_000; // Render sends SIGKILL 30 s after SIGTERM
const CRASH_WINDOW_MS = 5 * 60_000;
const MAX_CRASHES_IN_WINDOW = 5;

interface Service {
  name: "api" | "worker";
  script: string;
  env: NodeJS.ProcessEnv;
  /** Unix niceness; higher yields the CPU to the other process. */
  niceness: number;
  child?: ChildProcess;
  crashes: number[];
}

const services: Record<Service["name"], Service> = {
  api: { name: "api", script: path.join(path.dirname(here), `server${ext}`), env: { FLEQO_SERVICE: "fleqo-api" }, niceness: 0, crashes: [] },
  // The worker's optional health server stays off: only the API port is exposed.
  worker: {
    name: "worker",
    script: path.join(path.dirname(here), `worker${ext}`),
    env: { FLEQO_SERVICE: "fleqo-worker", WORKER_HEALTH_PORT: "" },
    niceness: 10,
    crashes: [],
  },
};

let stopping = false;
let migration: ChildProcess | undefined;

/** Same JSON line shape as the services' pino logs. */
function log(level: 30 | 40 | 50, msg: string, extra: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ level, time: Date.now(), service: "fleqo-single", ...extra, msg })}\n`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const exited = (child: ChildProcess) =>
  child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise<void>((resolve) => child.once("exit", () => resolve()));

/**
 * Migration folders in the image that the database has not finished applying (all of them on a new
 * database). Throws when the database cannot be reached.
 */
async function pendingMigrations(): Promise<string[]> {
  const local = readdirSync(path.join(apiDir, "prisma", "migrations"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 20_000 });
  client.on("error", () => {});
  await client.connect();
  try {
    const table = await client.query<{ name: string | null }>("select to_regclass('_prisma_migrations')::text as name");
    if (!table.rows[0]?.name) return local;
    const { rows } = await client.query<{ migration_name: string }>(
      "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null",
    );
    const applied = new Set(rows.map((row) => row.migration_name));
    return local.filter((name) => !applied.has(name));
  } finally {
    await client.end().catch(() => {});
  }
}

function runPrismaMigrate(): Promise<number | null> {
  const prismaCli = createRequire(import.meta.url).resolve("prisma/build/index.js");
  migration = spawn(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: apiDir, stdio: "inherit" });
  return new Promise((resolve) =>
    migration!.once("exit", (exitCode) => {
      migration = undefined;
      resolve(exitCode);
    }),
  );
}

async function migrate() {
  for (let attempt = 1; attempt <= MIGRATE_ATTEMPTS && !stopping; attempt++) {
    const startedAt = Date.now();
    let problem: Record<string, unknown>;
    try {
      const pending = await pendingMigrations();
      if (pending.length === 0) {
        log(30, "Database schema is up to date", { durationMs: Date.now() - startedAt });
        return;
      }
      log(30, "Applying migrations", { pending });
      const code = await runPrismaMigrate();
      if (code === 0) {
        log(30, "Migrations applied", { durationMs: Date.now() - startedAt });
        return;
      }
      problem = { exitCode: code };
    } catch (error) {
      problem = { err: error instanceof Error ? error.message : String(error) };
    }
    if (stopping) return;
    if (attempt < MIGRATE_ATTEMPTS) {
      const delayMs = 3000 * attempt;
      log(40, "Migration step failed; retrying (the database may still be waking up)", { attempt, delayMs, ...problem });
      await sleep(delayMs);
    }
  }
  if (!stopping) throw new Error(`Migrations failed after ${MIGRATE_ATTEMPTS} attempts`);
}

function start(service: Service) {
  const child = spawn(process.execPath, [...process.execArgv, service.script], {
    cwd: apiDir,
    stdio: "inherit",
    env: { ...process.env, ...service.env },
  });
  service.child = child;
  if (service.niceness && child.pid) {
    try {
      os.setPriority(child.pid, service.niceness);
    } catch {
      // Not permitted on this platform; the process simply runs at normal priority.
    }
  }
  log(30, `Started ${service.name}`, { pid: child.pid, niceness: service.niceness });

  child.once("exit", (code, signal) => {
    service.child = undefined;
    if (stopping) return;
    const now = Date.now();
    service.crashes = [...service.crashes.filter((at) => now - at < CRASH_WINDOW_MS), now];
    if (service.crashes.length > MAX_CRASHES_IN_WINDOW) {
      log(50, `The ${service.name} keeps crashing; stopping so the platform restarts the service`, { code, signal });
      void shutdown(1, `${service.name} crash loop`);
      return;
    }
    const delayMs = Math.min(30_000, 1000 * 2 ** (service.crashes.length - 1));
    log(50, `The ${service.name} exited unexpectedly; restarting`, { code, signal, delayMs, crashesInWindow: service.crashes.length });
    setTimeout(() => {
      if (!stopping) start(service);
    }, delayMs);
  });
}

/** Resolves once the API answers on PORT (or after a timeout, so the worker still starts). */
async function waitForApi() {
  const url = `http://127.0.0.1:${process.env.PORT ?? 4000}/api/health`;
  const deadline = Date.now() + API_START_TIMEOUT_MS;
  while (!stopping && Date.now() < deadline) {
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(2000) })).ok) return;
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  if (!stopping) log(40, "The API did not answer in time; starting the worker anyway");
}

async function shutdown(exitCode: number, reason: string) {
  if (stopping) return;
  stopping = true;
  log(30, "Shutting down", { reason });
  const running = [migration, services.api.child, services.worker.child].filter((child): child is ChildProcess => Boolean(child));
  for (const child of running) child.kill("SIGTERM");
  const killTimer = setTimeout(() => {
    for (const child of running) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }, SHUTDOWN_GRACE_MS);
  await Promise.all(running.map(exited));
  clearTimeout(killTimer);
  log(30, "Stopped", { exitCode });
  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown(0, "SIGTERM"));
process.on("SIGINT", () => void shutdown(0, "SIGINT"));

async function main() {
  const startedAt = Date.now();
  if (MIGRATE_ON_START) await migrate();
  else log(30, "Skipping migrations (DEMO_MIGRATE_ON_START=false)");
  if (stopping) return;
  start(services.api);
  await waitForApi();
  if (stopping) return;
  start(services.worker);
  log(30, "API and worker running", { startupMs: Date.now() - startedAt });
}

main().catch((error: unknown) => {
  log(50, "Startup failed", { err: error instanceof Error ? error.message : String(error) });
  void shutdown(1, "startup failed");
});
