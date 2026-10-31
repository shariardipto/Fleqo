import { Router } from "express";
import { z } from "zod";
import { dispatchPending } from "../../engine/dispatcher.ts";
import type { RunQueue } from "../../engine/queue.ts";
import type { Prisma } from "../../generated/prisma/client.ts";
import { AppError, notFound } from "../../lib/errors.ts";
import { idParam } from "../../lib/http.ts";
import { prisma } from "../../lib/prisma.ts";
import { orgOf, requireOrg } from "../../middleware/auth.ts";
import { recordAudit } from "../audit/audit.service.ts";

const listSchema = z.object({
  status: z.enum(["queued", "running", "retrying", "succeeded", "failed"]).optional(),
  workflowId: z.string().max(64).optional(),
  search: z.string().trim().max(128).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(64).optional(),
});

/**
 * Manual retry: only failed runs, only by Admin/Owner. Succeeded actions keep their state and are
 * skipped; failed ones are re-queued. The outbox row gets a new generation so a fresh job is enqueued.
 */
export async function retryRun(organizationId: string, runId: string, actorUserId: string, queue: RunQueue) {
  const dispatchId = await prisma.$transaction(async (tx) => {
    const reset = await tx.workflowRun.updateMany({
      where: { id: runId, organizationId, status: "failed" },
      data: { status: "queued", finishedAt: null, lastError: null, leaseExpiresAt: null },
    });
    if (reset.count !== 1) {
      const exists = await tx.workflowRun.findFirst({ where: { id: runId, organizationId }, select: { status: true } });
      if (!exists) throw notFound("Execution");
      throw new AppError("conflict", `Only failed runs can be retried (this run is ${exists.status})`);
    }
    const requeued = await tx.actionRun.updateMany({
      where: { workflowRunId: runId, status: { not: "succeeded" } },
      data: { status: "queued", finishedAt: null },
    });
    await tx.deadLetterEvent.updateMany({
      where: { workflowRunId: runId, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedByUserId: actorUserId },
    });
    const dispatch = await tx.eventDispatch.update({
      where: { workflowRunId: runId },
      data: { status: "pending", generation: { increment: 1 }, nextAttemptAt: new Date(), lastError: null },
    });
    await tx.executionLog.create({
      data: {
        organizationId,
        workflowRunId: runId,
        level: "info",
        message: `Manual retry requested; ${requeued.count} incomplete action(s) re-queued, completed actions will be skipped`,
      },
    });
    await recordAudit(tx, {
      organizationId,
      actorUserId,
      action: "execution.retried",
      targetType: "workflow_run",
      targetId: runId,
      metadata: { generation: dispatch.generation },
    });
    return dispatch.id;
  });
  await dispatchPending(queue, { ids: [dispatchId] }).catch(() => undefined);
}

const runListSelect = {
  id: true,
  status: true,
  attempts: true,
  lastError: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  workflow: { select: { id: true, name: true } },
  incomingEvent: { select: { id: true, externalEventId: true, isSynthetic: true, source: true, payload: true } },
  actionRuns: {
    orderBy: { position: "asc" },
    select: { id: true, position: true, provider: true, actionType: true, status: true, attempts: true },
  },
} satisfies Prisma.WorkflowRunSelect;

type RunListItem = Prisma.WorkflowRunGetPayload<{ select: typeof runListSelect }>;

function presentListItem(run: RunListItem) {
  const payload = run.incomingEvent.payload as { data?: { order?: { id?: string; totalMinor?: number; currency?: string } } };
  const { payload: _payload, ...event } = run.incomingEvent;
  return {
    ...run,
    incomingEvent: event,
    order: payload.data?.order ? { id: payload.data.order.id, totalMinor: payload.data.order.totalMinor, currency: payload.data.order.currency } : null,
  };
}

export function executionsRouter(queue: RunQueue) {
  const router = Router();

  router.get("/executions", requireOrg({ execution: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const query = listSchema.parse(req.query);
    const where: Prisma.WorkflowRunWhereInput = {
      organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.workflowId ? { workflowId: query.workflowId } : {}),
      ...(query.search
        ? {
            incomingEvent: {
              OR: [
                { externalEventId: { contains: query.search } },
                { payload: { path: ["data", "order", "id"], string_contains: query.search } },
                { payload: { path: ["data", "customer", "email"], string_contains: query.search } },
              ],
            },
          }
        : {}),
    };
    const [runs, total] = await Promise.all([
      prisma.workflowRun.findMany({
        where,
        select: runListSelect,
        orderBy: { id: "desc" },
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      prisma.workflowRun.count({ where }),
    ]);
    res.json({
      items: runs.slice(0, query.limit).map(presentListItem),
      nextCursor: runs.length > query.limit ? runs[query.limit - 1].id : null,
      total,
    });
  });

  router.get("/executions/:id", requireOrg({ execution: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const run = await prisma.workflowRun.findFirst({
      where: { id: idParam(req), organizationId },
      include: {
        workflow: { select: { id: true, name: true, status: true } },
        incomingEvent: {
          select: {
            id: true,
            externalEventId: true,
            eventType: true,
            payload: true,
            isSynthetic: true,
            source: true,
            receivedAt: true,
            signedAt: true,
            duplicateCount: true,
            lastDuplicateAt: true,
          },
        },
        actionRuns: { orderBy: { position: "asc" } },
        logs: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        deadLetters: { orderBy: { createdAt: "desc" } },
        dispatch: { select: { status: true, generation: true, attempts: true, lastError: true, dispatchedAt: true } },
      },
    });
    if (!run) throw notFound("Execution");
    res.json({ execution: run });
  });

  router.post("/executions/:id/retry", requireOrg({ execution: ["retry"] }), async (req, res) => {
    const ctx = orgOf(req);
    const runId = idParam(req);
    await retryRun(ctx.organizationId, runId, ctx.userId, queue);
    res.status(202).json({ status: "queued", executionId: runId });
  });

  router.get("/events", requireOrg({ execution: ["read"] }), async (req, res) => {
    const { organizationId } = orgOf(req);
    const { limit, cursor } = listSchema.pick({ limit: true, cursor: true }).parse(req.query);
    const events = await prisma.incomingEvent.findMany({
      where: { organizationId },
      orderBy: { id: "desc" },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        externalEventId: true,
        eventType: true,
        isSynthetic: true,
        source: true,
        matchedWorkflowCount: true,
        duplicateCount: true,
        receivedAt: true,
        runs: { select: { id: true, status: true } },
      },
    });
    res.json({ items: events.slice(0, limit), nextCursor: events.length > limit ? events[limit - 1].id : null });
  });

  return router;
}
