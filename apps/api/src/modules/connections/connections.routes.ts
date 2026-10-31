import { Router } from "express";
import { z } from "zod";
import type { ConnectionProvider, IntegrationConnection } from "../../generated/prisma/client.ts";
import { encryptSecret, generatePublicId, generateSigningSecret } from "../../lib/crypto.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { idParam } from "../../lib/http.ts";
import { prisma } from "../../lib/prisma.ts";
import { orgOf, requireOrg } from "../../middleware/auth.ts";
import { recordAudit } from "../audit/audit.service.ts";

const PROVIDERS = {
  mock_store: { label: "Mock Store", description: "Signs order.created webhooks for the demo store." },
  mock_crm: { label: "Mock CRM", description: "Customer records stored in Fleqo's PostgreSQL database." },
  mock_sheet: { label: "Mock Sheet", description: "Order rows stored in Fleqo's PostgreSQL database." },
} as const satisfies Record<ConnectionProvider, { label: string; description: string }>;

const createSchema = z.object({
  provider: z.enum(["mock_store", "mock_crm", "mock_sheet"]),
  name: z.string().trim().min(2).max(80).optional(),
});
const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    status: z.enum(["active", "disabled"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide name or status");

/** Public view of a connection. The signing secret is never returned after creation/rotation. */
function present(connection: IntegrationConnection, stats?: { events: number; customers: number; rows: number; lastEventAt: Date | null }) {
  return {
    id: connection.id,
    provider: connection.provider,
    providerLabel: PROVIDERS[connection.provider].label,
    name: connection.name,
    status: connection.status,
    publicId: connection.publicId,
    hasSigningSecret: Boolean(connection.secretCiphertext),
    secretLast4: connection.secretLast4,
    secretRotatedAt: connection.secretRotatedAt,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
    ...(stats ? { stats } : {}),
  };
}

export async function createConnection(
  organizationId: string,
  actorUserId: string | null,
  provider: ConnectionProvider,
  name?: string,
) {
  const existing = await prisma.integrationConnection.findUnique({
    where: { organizationId_provider: { organizationId, provider } },
  });
  if (existing) throw new AppError("conflict", `${PROVIDERS[provider].label} is already connected`);

  const signingSecret = provider === "mock_store" ? generateSigningSecret() : null;
  const connection = await prisma.$transaction(async (tx) => {
    const created = await tx.integrationConnection.create({
      data: {
        organizationId,
        provider,
        name: name ?? PROVIDERS[provider].label,
        publicId: generatePublicId("conn"),
        secretCiphertext: signingSecret ? encryptSecret(signingSecret) : null,
        secretLast4: signingSecret ? signingSecret.slice(-4) : null,
        secretRotatedAt: signingSecret ? new Date() : null,
        createdById: actorUserId,
      },
    });
    await recordAudit(tx, {
      organizationId,
      actorUserId,
      action: "connection.created",
      targetType: "connection",
      targetId: created.id,
      metadata: { provider },
    });
    return created;
  });
  return { connection, signingSecret };
}

export function connectionsRouter() {
  const router = Router();

  router.get("/connections/providers", requireOrg({ connection: ["read"] }), (_req, res) => {
    res.json({ providers: Object.entries(PROVIDERS).map(([provider, info]) => ({ provider, ...info })) });
  });

  router.get("/connections", requireOrg({ connection: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const connections = await prisma.integrationConnection.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
    const [eventCounts, lastEvents, customers, rows] = await Promise.all([
      prisma.incomingEvent.groupBy({ by: ["connectionId"], where: { organizationId }, _count: { _all: true } }),
      prisma.incomingEvent.groupBy({ by: ["connectionId"], where: { organizationId }, _max: { receivedAt: true } }),
      prisma.mockCustomer.groupBy({ by: ["connectionId"], where: { organizationId }, _count: { _all: true } }),
      prisma.mockSheetRow.groupBy({ by: ["connectionId"], where: { organizationId }, _count: { _all: true } }),
    ]);
    const countFor = (list: { connectionId: string; _count: { _all: number } }[], id: string) =>
      list.find((item) => item.connectionId === id)?._count._all ?? 0;

    res.json({
      connections: connections.map((connection) =>
        present(connection, {
          events: countFor(eventCounts, connection.id),
          customers: countFor(customers, connection.id),
          rows: countFor(rows, connection.id),
          lastEventAt: lastEvents.find((item) => item.connectionId === connection.id)?._max.receivedAt ?? null,
        }),
      ),
      webhook: {
        path: "/api/webhooks/mock-store",
        headers: ["X-Fleqo-Connection-Id", "X-Fleqo-Timestamp", "X-Fleqo-Signature"],
        signature: "hex(HMAC-SHA256(secret, `${timestamp}.${rawBody}`))",
      },
    });
  });

  router.post("/connections", requireOrg({ connection: ["manage"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = createSchema.parse(req.body);
    const { connection, signingSecret } = await createConnection(ctx.organizationId, ctx.userId, input.provider, input.name);
    // The signing secret is shown exactly once.
    res.status(201).json({ connection: present(connection), signingSecret });
  });

  router.patch("/connections/:id", requireOrg({ connection: ["manage"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = updateSchema.parse(req.body);
    const existing = await prisma.integrationConnection.findFirst({
      where: { id: idParam(req), organizationId: ctx.organizationId },
    });
    if (!existing) throw notFound("Connection");

    const connection = await prisma.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.update({ where: { id: existing.id }, data: input });
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "connection.updated",
        targetType: "connection",
        targetId: existing.id,
        metadata: input,
      });
      return updated;
    });
    res.json({ connection: present(connection) });
  });

  router.post("/connections/:id/rotate-secret", requireOrg({ connection: ["manage"] }), async (req, res) => {
    const ctx = orgOf(req);
    const existing = await prisma.integrationConnection.findFirst({
      where: { id: idParam(req), organizationId: ctx.organizationId },
    });
    if (!existing) throw notFound("Connection");
    if (existing.provider !== "mock_store") throw new AppError("bad_request", "Only Mock Store connections sign webhooks");

    const signingSecret = generateSigningSecret();
    const connection = await prisma.$transaction(async (tx) => {
      const updated = await tx.integrationConnection.update({
        where: { id: existing.id },
        data: {
          secretCiphertext: encryptSecret(signingSecret),
          secretLast4: signingSecret.slice(-4),
          secretRotatedAt: new Date(),
        },
      });
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "connection.secret_rotated",
        targetType: "connection",
        targetId: existing.id,
      });
      return updated;
    });
    res.json({ connection: present(connection), signingSecret });
  });

  // ── Mock destination records (real persisted effects of workflow actions) ──
  const pageSchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().max(64).optional(),
    search: z.string().trim().max(100).optional(),
  });

  router.get("/mock-crm/customers", requireOrg({ connection: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const { limit, cursor, search } = pageSchema.parse(req.query);
    const items = await prisma.mockCustomer.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { email: { contains: search, mode: "insensitive" } },
                { name: { contains: search, mode: "insensitive" } },
                { customerExternalId: { contains: search } },
              ],
            }
          : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const total = await prisma.mockCustomer.count({ where: { organizationId } });
    res.json({
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? items[limit - 1].id : null,
      total,
    });
  });

  router.get("/mock-sheet/rows", requireOrg({ connection: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const { limit, cursor, search } = pageSchema.parse(req.query);
    const items = await prisma.mockSheetRow.findMany({
      where: {
        organizationId,
        ...(search
          ? {
              OR: [
                { orderExternalId: { contains: search } },
                { customerEmail: { contains: search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const total = await prisma.mockSheetRow.count({ where: { organizationId } });
    res.json({
      items: items.slice(0, limit),
      nextCursor: items.length > limit ? items[limit - 1].id : null,
      total,
    });
  });

  return router;
}
