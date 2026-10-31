import { Router } from "express";
import { z } from "zod";
import { ACTION_KEYS, type ActionKey } from "../../contracts/order-event.ts";
import { ACTIONS, actionCatalog, defaultMapping, validateMapping, type Mapping } from "../../engine/mapping.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { idParam } from "../../lib/http.ts";
import { prisma } from "../../lib/prisma.ts";
import { orgOf, requireOrg } from "../../middleware/auth.ts";
import { recordAudit } from "../audit/audit.service.ts";

const mappingSchema = z.record(z.string().max(64), z.string().max(128));
const actionConfigSchema = z.object({ sheetName: z.string().trim().min(1).max(60).optional() }).strict();

const actionInputSchema = z.object({
  key: z.enum(ACTION_KEYS),
  mapping: mappingSchema.optional(),
  config: actionConfigSchema.default({}),
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).optional(),
  enabled: z.boolean().default(false),
  trigger: z
    .object({ provider: z.literal("mock_store"), eventType: z.literal("order.created") })
    .default({ provider: "mock_store", eventType: "order.created" }),
  actions: z
    .array(actionInputSchema)
    .min(1)
    .max(ACTION_KEYS.length)
    .refine((actions) => new Set(actions.map((a) => a.key)).size === actions.length, "Each action type may appear once"),
});

const updateSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    status: z.enum(["active", "inactive"]).optional(),
    actions: z
      .array(z.object({ id: z.string().max(64), mapping: mappingSchema.optional(), config: actionConfigSchema.optional() }))
      .max(ACTION_KEYS.length)
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Nothing to update");

const listSchema = z.object({ includeArchived: z.enum(["true", "false"]).default("false") });

const workflowInclude = {
  trigger: { include: { connection: { select: { id: true, name: true, status: true, publicId: true } } } },
  actions: {
    orderBy: { position: "asc" },
    include: { connection: { select: { id: true, name: true, status: true, provider: true } } },
  },
} satisfies Prisma.WorkflowInclude;

type WorkflowWithRelations = Prisma.WorkflowGetPayload<{ include: typeof workflowInclude }>;

function present(workflow: WorkflowWithRelations, stats?: Record<string, unknown>) {
  return {
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    status: workflow.status,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
    archivedAt: workflow.archivedAt,
    trigger: workflow.trigger && {
      provider: workflow.trigger.provider,
      eventType: workflow.trigger.eventType,
      connection: workflow.trigger.connection,
    },
    actions: workflow.actions.map((action) => ({
      id: action.id,
      key: `${action.provider}.${action.actionType}` as ActionKey,
      label: ACTIONS[`${action.provider}.${action.actionType}` as ActionKey]?.label ?? action.actionType,
      position: action.position,
      provider: action.provider,
      actionType: action.actionType,
      mapping: action.mapping as Mapping,
      config: action.config,
      connection: action.connection,
    })),
    ...(stats ? { stats } : {}),
  };
}

function assertValidMapping(key: ActionKey, mapping: Mapping) {
  const issues = validateMapping(key, mapping);
  if (issues.length > 0) {
    throw new AppError(
      "validation_failed",
      `Invalid mapping for ${ACTIONS[key].label}`,
      issues.map((issue) => ({ path: `${key}.${issue.field}`, message: issue.message })),
    );
  }
}

/** A workflow can only be active if every connection it uses exists and is enabled. */
function assertRunnable(workflow: WorkflowWithRelations) {
  const connections = [workflow.trigger?.connection, ...workflow.actions.map((a) => a.connection)];
  if (connections.some((connection) => !connection || connection.status !== "active")) {
    throw new AppError("conflict", "Enable all connections used by this workflow before activating it");
  }
}

async function loadWorkflow(organizationId: string, id: string) {
  const workflow = await prisma.workflow.findFirst({ where: { id, organizationId }, include: workflowInclude });
  if (!workflow) throw notFound("Workflow");
  return workflow;
}

export function workflowsRouter() {
  const router = Router();

  router.get("/workflows/catalog", requireOrg({ workflow: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const connections = await prisma.integrationConnection.findMany({
      where: { organizationId },
      select: { id: true, provider: true, name: true, status: true },
    });
    const catalog = actionCatalog();
    res.json({
      ...catalog,
      actions: catalog.actions.map((action) => ({
        ...action,
        defaultMapping: defaultMapping(action.key),
      })),
      connections,
    });
  });

  router.get("/workflows", requireOrg({ workflow: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const { includeArchived } = listSchema.parse(req.query);
    const workflows = await prisma.workflow.findMany({
      where: { organizationId, ...(includeArchived === "true" ? {} : { status: { not: "archived" } }) },
      include: workflowInclude,
      orderBy: { createdAt: "desc" },
    });
    const ids = workflows.map((workflow) => workflow.id);
    const [runCounts, lastRuns] = await Promise.all([
      prisma.workflowRun.groupBy({ by: ["workflowId", "status"], where: { organizationId, workflowId: { in: ids } }, _count: { _all: true } }),
      prisma.workflowRun.groupBy({ by: ["workflowId"], where: { organizationId, workflowId: { in: ids } }, _max: { createdAt: true } }),
    ]);
    res.json({
      workflows: workflows.map((workflow) => {
        const counts = Object.fromEntries(
          runCounts.filter((row) => row.workflowId === workflow.id).map((row) => [row.status, row._count._all]),
        );
        return present(workflow, {
          runs: counts,
          lastRunAt: lastRuns.find((row) => row.workflowId === workflow.id)?._max.createdAt ?? null,
        });
      }),
    });
  });

  router.post("/workflows", requireOrg({ workflow: ["manage"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = createSchema.parse(req.body);

    const connections = await prisma.integrationConnection.findMany({ where: { organizationId: ctx.organizationId } });
    const connectionFor = (provider: string) => {
      const connection = connections.find((c) => c.provider === provider);
      if (!connection) throw new AppError("conflict", `Connect ${provider.replace("_", " ")} before creating this workflow`);
      return connection;
    };
    const storeConnection = connectionFor(input.trigger.provider);
    const actions = input.actions.map((action, index) => {
      const definition = ACTIONS[action.key];
      const mapping = action.mapping ?? defaultMapping(action.key);
      assertValidMapping(action.key, mapping);
      return {
        position: index + 1,
        provider: definition.provider,
        actionType: definition.actionType,
        connectionId: connectionFor(definition.provider).id,
        mapping,
        config: action.config,
      };
    });

    const workflow = await prisma.$transaction(async (tx) => {
      const created = await tx.workflow.create({
        data: {
          organizationId: ctx.organizationId,
          name: input.name,
          description: input.description ?? null,
          status: "inactive",
          createdById: ctx.userId,
          trigger: {
            create: {
              organizationId: ctx.organizationId,
              provider: input.trigger.provider,
              eventType: input.trigger.eventType,
              connectionId: storeConnection.id,
            },
          },
          actions: { create: actions.map((action) => ({ ...action, organizationId: ctx.organizationId })) },
        },
        include: workflowInclude,
      });
      if (input.enabled) {
        assertRunnable(created);
        await tx.workflow.update({ where: { id: created.id }, data: { status: "active" } });
        created.status = "active";
      }
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "workflow.created",
        targetType: "workflow",
        targetId: created.id,
        metadata: { name: created.name, status: created.status, actions: input.actions.map((a) => a.key) },
      });
      return created;
    });
    res.status(201).json({ workflow: present(workflow) });
  });

  router.get("/workflows/:id", requireOrg({ workflow: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const workflow = await loadWorkflow(organizationId, idParam(req));
    const [runCounts, recentRuns] = await Promise.all([
      prisma.workflowRun.groupBy({ by: ["status"], where: { organizationId, workflowId: workflow.id }, _count: { _all: true } }),
      prisma.workflowRun.findMany({
        where: { organizationId, workflowId: workflow.id },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, status: true, createdAt: true, finishedAt: true, incomingEvent: { select: { externalEventId: true } } },
      }),
    ]);
    res.json({
      workflow: present(workflow, {
        runs: Object.fromEntries(runCounts.map((row) => [row.status, row._count._all])),
        recentRuns,
      }),
    });
  });

  router.patch("/workflows/:id", requireOrg({ workflow: ["manage"] }), async (req, res) => {
    const ctx = orgOf(req);
    const input = updateSchema.parse(req.body);
    const existing = await loadWorkflow(ctx.organizationId, idParam(req));
    if (existing.status === "archived") throw new AppError("conflict", "Archived workflows cannot be changed");

    const workflow = await prisma.$transaction(async (tx) => {
      for (const change of input.actions ?? []) {
        const action = existing.actions.find((a) => a.id === change.id);
        if (!action) throw new AppError("validation_failed", "Unknown action for this workflow", [{ path: "actions", message: change.id }]);
        const key = `${action.provider}.${action.actionType}` as ActionKey;
        if (change.mapping) assertValidMapping(key, change.mapping);
        await tx.workflowAction.update({
          where: { id: action.id },
          data: {
            ...(change.mapping ? { mapping: change.mapping } : {}),
            ...(change.config ? { config: change.config } : {}),
          },
        });
      }
      const updated = await tx.workflow.update({
        where: { id: existing.id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        include: workflowInclude,
      });
      if (input.status === "active") assertRunnable(updated);
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: input.status && input.status !== existing.status ? `workflow.${input.status === "active" ? "enabled" : "disabled"}` : "workflow.updated",
        targetType: "workflow",
        targetId: existing.id,
        metadata: { fields: Object.keys(input) },
      });
      return updated;
    });
    res.json({ workflow: present(workflow) });
  });

  // Archive instead of delete: runs, logs and destination records keep their history.
  router.delete("/workflows/:id", requireOrg({ workflow: ["manage"] }), async (req, res) => {
    const ctx = orgOf(req);
    const existing = await loadWorkflow(ctx.organizationId, idParam(req));
    await prisma.$transaction(async (tx) => {
      await tx.workflow.update({ where: { id: existing.id }, data: { status: "archived", archivedAt: new Date() } });
      await recordAudit(tx, {
        organizationId: ctx.organizationId,
        actorUserId: ctx.userId,
        action: "workflow.archived",
        targetType: "workflow",
        targetId: existing.id,
      });
    });
    res.status(204).end();
  });

  return router;
}
