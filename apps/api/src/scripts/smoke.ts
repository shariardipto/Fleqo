/**
 * End-to-end smoke test against a running Fleqo environment (local or deployed).
 * Creates a throwaway user + organization, so it never touches existing tenants.
 *
 *   npm run smoke -- --base-url http://localhost:3000
 *   npm run smoke -- --base-url https://fleqo.example.com
 *
 * --base-url should be the public web origin (it proxies /api). When pointing at the API
 * directly, pass --origin with an origin listed in the API's WEB_ORIGINS.
 */
import { randomUUID } from "node:crypto";

const args = new Map<string, string>();
process.argv.slice(2).forEach((arg, i, all) => {
  if (arg.startsWith("--")) args.set(arg.slice(2), all[i + 1] ?? "");
});
const baseUrl = (args.get("base-url") ?? process.env.SMOKE_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const origin = args.get("origin") ?? new URL(baseUrl).origin;
const timeoutMs = Number(args.get("timeout") ?? 90_000);

const cookies = new Map<string, string>();

async function call<T = Record<string, unknown>>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Origin: origin,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  for (const header of response.headers.getSetCookie()) {
    const [pair] = header.split(";");
    const index = pair.indexOf("=");
    cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1));
  }
  const text = await response.text();
  return { status: response.status, data: (text ? JSON.parse(text) : {}) as T };
}

let step = 0;
async function check<T>(label: string, fn: () => Promise<T>): Promise<T> {
  step++;
  const started = Date.now();
  try {
    const result = await fn();
    console.log(`✔ ${String(step).padStart(2)} ${label} (${Date.now() - started} ms)`);
    return result;
  } catch (error) {
    console.error(`✘ ${String(step).padStart(2)} ${label}: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

function expectStatus(result: { status: number; data: unknown }, expected: number) {
  if (result.status !== expected) throw new Error(`expected HTTP ${expected}, got ${result.status} ${JSON.stringify(result.data).slice(0, 300)}`);
}

async function main() {
  console.log(`Fleqo smoke test → ${baseUrl} (origin ${origin})`);
  const email = `smoke-${randomUUID().slice(0, 8)}@example.test`;

  await check("API health", async () => expectStatus(await call("GET", "/api/health"), 200));
  await check("API readiness (PostgreSQL + Redis)", async () => expectStatus(await call("GET", "/api/ready"), 200));
  await check("Sign up", async () =>
    expectStatus(await call("POST", "/api/auth/sign-up/email", { email, password: `Smoke-${randomUUID()}`, name: "Smoke Test" }), 200),
  );
  await check("Create organization", async () => expectStatus(await call("POST", "/api/organizations", { name: "Smoke Test Org" }), 201));
  for (const provider of ["mock_store", "mock_crm", "mock_sheet"]) {
    await check(`Connect ${provider}`, async () => expectStatus(await call("POST", "/api/connections", { provider }), 201));
  }
  await check("Create active Order Sync workflow", async () =>
    expectStatus(
      await call("POST", "/api/workflows", {
        name: "Order Sync",
        enabled: true,
        actions: [{ key: "mock_crm.upsert_customer" }, { key: "mock_sheet.append_order" }],
      }),
      201,
    ),
  );
  await check("Import synthetic demo data", async () =>
    expectStatus(await call("POST", "/api/demo/import", { source: "fleqo_synthetic", limit: 10 }), 200),
  );
  const deliveries = await check("Send 2 signed order.created events", async () => {
    const result = await call<{ deliveries: { status: string; eventId: string }[] }>("POST", "/api/demo/simulate-order", { count: 2 });
    expectStatus(result, 202);
    if (result.data.deliveries.some((d) => d.status !== "accepted")) throw new Error("not all events accepted");
    return result.data.deliveries;
  });
  await check("Worker executes both runs (CRM upsert → Sheet append)", async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const result = await call<{ items: { status: string }[] }>("GET", "/api/executions?limit=10");
      const statuses = result.data.items.map((item) => item.status);
      if (statuses.length >= 2 && statuses.every((s) => s === "succeeded")) return;
      if (statuses.includes("failed")) throw new Error(`a run failed: ${statuses.join(",")}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("runs did not finish in time (is the worker running?)");
  });
  await check("Duplicate delivery is acknowledged, not re-executed", async () => {
    const result = await call<{ deliveries: { status: string }[] }>("POST", "/api/demo/simulate-order", { duplicateOfEventId: deliveries[0].eventId });
    if (result.data.deliveries?.[0]?.status !== "duplicate") throw new Error(JSON.stringify(result.data));
    const rows = await call<{ total: number }>("GET", "/api/mock-sheet/rows?limit=1");
    if (rows.data.total !== 2) throw new Error(`expected 2 sheet rows, found ${rows.data.total}`);
  });
  await check("Unsigned webhook is rejected", async () => {
    const response = await fetch(`${baseUrl}/api/webhooks/mock-store`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (response.status !== 401) throw new Error(`expected 401, got ${response.status}`);
  });
  console.log(`All ${step} checks passed. Throwaway tenant: ${email}`);
}

void main();
