import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { decryptSecret } from "../src/lib/crypto.ts";
import { prisma } from "../src/lib/prisma.ts";
import { buildApp, fakeQueue, joinAsMember, signUpWithOrg } from "./helpers/app.ts";
import { createApp } from "../src/app.ts";
import { resetDatabase } from "./helpers/db.ts";

// Offline stand-in for DummyJSON with the response shapes observed from the live API.
const fakeDummyJson = async (url: string) => {
  if (url.includes("/users")) {
    return { users: [{ id: 1, firstName: "Emily", lastName: "Johnson", email: "Emily.Johnson@x.dummyjson.com" }] };
  }
  if (url.includes("/products")) {
    return { products: [{ id: 7, title: "Mascara", price: 9.99, category: "beauty", sku: "BEA-1" }] };
  }
  return { carts: [{ id: 3, userId: 1, products: [{ id: 7, title: "Mascara", price: 9.99, quantity: 2 }] }] };
};

const app = buildApp();
const appWithFakeFetch = createApp({ runQueue: fakeQueue(), fetchJson: fakeDummyJson });

describe("connections and public data import (M3)", () => {
  beforeEach(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it("creates a mock store connection, shows its secret once and stores it encrypted", async () => {
    const owner = await signUpWithOrg(app);
    const res = await owner.client.post("/api/connections", { provider: "mock_store" });
    expect(res.status).toBe(201);
    expect(res.body.signingSecret).toMatch(/^whsec_/);
    expect(res.body.connection.publicId).toMatch(/^conn_/);

    const stored = await prisma.integrationConnection.findUniqueOrThrow({ where: { id: res.body.connection.id } });
    expect(stored.secretCiphertext).not.toContain(res.body.signingSecret);
    expect(decryptSecret(stored.secretCiphertext!)).toBe(res.body.signingSecret);

    const list = await owner.client.get("/api/connections");
    expect(JSON.stringify(list.body)).not.toContain(res.body.signingSecret);
    expect(list.body.connections[0]).toMatchObject({ provider: "mock_store", hasSigningSecret: true });

    expect((await owner.client.post("/api/connections", { provider: "mock_store" })).status).toBe(409);

    const rotated = await owner.client.post(`/api/connections/${res.body.connection.id}/rotate-secret`);
    expect(rotated.body.signingSecret).not.toBe(res.body.signingSecret);
  });

  it("lets members read but not manage connections, and hides other tenants' connections", async () => {
    const owner = await signUpWithOrg(app);
    const created = await owner.client.post("/api/connections", { provider: "mock_crm" });

    const member = await joinAsMember(app, owner.client, "viewer@example.test");

    expect((await member.client.get("/api/connections")).body.connections).toHaveLength(1);
    expect((await member.client.post("/api/connections", { provider: "mock_sheet" })).status).toBe(403);
    expect((await member.client.patch(`/api/connections/${created.body.connection.id}`, { status: "disabled" })).status).toBe(403);

    const outsider = await signUpWithOrg(app, "Outsider");
    expect((await outsider.client.get("/api/connections")).body.connections).toHaveLength(0);
    expect((await outsider.client.patch(`/api/connections/${created.body.connection.id}`, { name: "Mine" })).status).toBe(404);
  });

  it("imports offline synthetic data repeatably and labels it synthetic", async () => {
    const owner = await signUpWithOrg(app);
    const first = await owner.client.post("/api/demo/import", { source: "fleqo_synthetic", limit: 10 });
    expect(first.status).toBe(200);
    expect(first.body.import).toMatchObject({ isSynthetic: true, created: 20, updated: 0 });
    expect(first.body.import.byKind).toEqual({ customer: 10, product: 10 });

    const second = await owner.client.post("/api/demo/import", { source: "fleqo_synthetic", limit: 10 });
    expect(second.body.import).toMatchObject({ created: 0, updated: 20 });
    expect(await prisma.importedRecord.count()).toBe(20);

    const customers = await owner.client.get("/api/demo/records?kind=customer&limit=5");
    expect(customers.body.items).toHaveLength(5);
    expect(customers.body.items[0]).toMatchObject({ isSynthetic: true, source: "fleqo_synthetic" });
    expect(customers.body.items[0].data.email).toMatch(/@example\.test$/);
  });

  it("normalizes DummyJSON users, products and carts with provenance", async () => {
    const owner = await signUpWithOrg(appWithFakeFetch);
    const res = await owner.client.post("/api/demo/import", { source: "dummyjson", limit: 5 });
    expect(res.status).toBe(200);
    expect(res.body.import.byKind).toEqual({ customer: 1, product: 1, cart: 1 });

    const records = await prisma.importedRecord.findMany({ orderBy: { sourceRecordId: "asc" } });
    const product = records.find((record) => record.kind === "product")!;
    expect(product.data).toMatchObject({ sku: "dj_product_7", unitPriceMinor: 999, currency: "USD" });
    const customer = records.find((record) => record.kind === "customer")!;
    expect(customer.data).toMatchObject({ externalId: "dj_user_1", email: "emily.johnson@x.dummyjson.com" });
    expect(customer.sourceUrl).toBe("https://dummyjson.com");
    expect(customer.license).toContain("DummyJSON");
    expect(customer.isSynthetic).toBe(false);
  });

  it("only admins and owners can import", async () => {
    const owner = await signUpWithOrg(app);
    const member = await joinAsMember(app, owner.client, "m2@example.test");
    expect((await member.client.post("/api/demo/import", { source: "fleqo_synthetic" })).status).toBe(403);
  });
});
