import { randomUUID } from "node:crypto";
import type { Express } from "express";
import request from "supertest";
import { createApp } from "../../src/app.ts";
import { jobIdFor, type JobState, type RunJobData, type RunQueue } from "../../src/engine/queue.ts";

export const ORIGIN = "http://localhost:3000";
export const PASSWORD = "correct-horse-battery";

/** In-memory queue double. Set `failing` to simulate a Redis outage. */
export interface FakeQueue extends RunQueue {
  jobs: RunJobData[];
  failing: boolean;
  /** Overrides the reported state of a job ID (default: "waiting" when enqueued, else "unknown"). */
  states: Map<string, JobState>;
}

export function fakeQueue(): FakeQueue {
  const queue: FakeQueue = {
    jobs: [],
    failing: false,
    states: new Map(),
    async enqueue(job) {
      if (queue.failing) throw new Error("Simulated Redis outage");
      if (!queue.jobs.some((existing) => jobIdFor(existing) === jobIdFor(job))) queue.jobs.push(job);
    },
    async jobState(job) {
      const id = jobIdFor(job);
      return queue.states.get(id) ?? (queue.jobs.some((existing) => jobIdFor(existing) === id) ? "waiting" : "unknown");
    },
    async ping() {
      return !queue.failing;
    },
    async close() {},
  };
  return queue;
}

export function buildApp(queue: RunQueue = fakeQueue()) {
  return createApp({ runQueue: queue });
}

/** Cookie-persisting client that sends a trusted Origin (Better Auth CSRF protection requires one). */
export function client(app: Express) {
  const agent = request.agent(app);
  return {
    get: (url: string) => agent.get(url).set("Origin", ORIGIN),
    post: (url: string, body?: object) => agent.post(url).set("Origin", ORIGIN).send(body ?? {}),
    patch: (url: string, body?: object) => agent.patch(url).set("Origin", ORIGIN).send(body ?? {}),
    put: (url: string, body?: object) => agent.put(url).set("Origin", ORIGIN).send(body ?? {}),
    delete: (url: string) => agent.delete(url).set("Origin", ORIGIN),
  };
}

export type TestClient = ReturnType<typeof client>;

export async function signUp(app: Express, email = `user-${randomUUID().slice(0, 8)}@example.test`) {
  const c = client(app);
  const res = await c.post("/api/auth/sign-up/email", { email, password: PASSWORD, name: email.split("@")[0] });
  if (res.status !== 200) throw new Error(`sign-up failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { client: c, email, userId: res.body.user.id as string };
}

/** Creates the three mock connections and returns the store's one-time signing secret. */
export async function connectAll(c: TestClient) {
  const store = await c.post("/api/connections", { provider: "mock_store" });
  await c.post("/api/connections", { provider: "mock_crm" });
  await c.post("/api/connections", { provider: "mock_sheet" });
  return { signingSecret: store.body.signingSecret as string, publicId: store.body.connection.publicId as string };
}

export const orderSync = {
  name: "Order Sync",
  enabled: true,
  actions: [{ key: "mock_crm.upsert_customer" }, { key: "mock_sheet.append_order", config: { sheetName: "Orders" } }],
};

/**
 * Invites `email` with `role`, signs that user up and accepts through the invitation ID
 * (the invite-link flow; invitations are never discoverable by email).
 */
export async function joinAsMember(app: Express, inviter: TestClient, email: string, role: "member" | "admin" = "member") {
  const invited = await inviter.post("/api/team/invitations", { email, role });
  if (invited.status !== 201) throw new Error(`invite failed: ${invited.status} ${JSON.stringify(invited.body)}`);
  const member = await signUp(app, email);
  const accepted = await member.client.post(`/api/invitations/${invited.body.invitation.id}/accept`);
  if (accepted.status !== 200) throw new Error(`accept failed: ${accepted.status} ${JSON.stringify(accepted.body)}`);
  return { ...member, invitationId: invited.body.invitation.id as string };
}

/** Signs up a user and creates an organization they own (made active on their session). */
export async function signUpWithOrg(app: Express, orgName = "Acme Store") {
  const user = await signUp(app);
  const res = await user.client.post("/api/organizations", { name: orgName });
  if (res.status !== 201) throw new Error(`org create failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { ...user, organizationId: res.body.organization.id as string };
}
