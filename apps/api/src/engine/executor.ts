import { UnrecoverableError } from "bullmq";
import type { Logger } from "pino";
import { env } from "../config/env.ts";
import type { ActionKey, OrderCreatedEvent } from "../contracts/order-event.ts";
import type { Prisma } from "../generated/prisma/client.ts";
import { PermanentActionError } from "../integrations/errors.ts";
import { appendOrderRow, upsertCustomer, type ActionContext } from "../integrations/mock-providers.ts";
import { prisma, type Tx } from "../lib/prisma.ts";
import { applyMapping, type Mapping } from "./mapping.ts";

export interface JobAttempt {
  /** 1-based delivery number of this BullMQ job. */
  attempt: number;
  maxAttempts: number;
}

export type RunOutcome = "succeeded" | "skipped";

/** Thrown to make BullMQ schedule a retry with exponential backoff. */
export class RetryableRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RetryableRunError";
  }
}

class LostClaimError extends Error {}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 1000);

function log(
  db: Tx | typeof prisma,
  run: { id: string; organizationId: string },
  level: "info" | "warn" | "error",
  message: string,
  extra: { actionRunId?: string; attempt?: number; metadata?: Prisma.InputJsonValue } = {},
) {
  return db.executionLog.create({
    data: {
      organizationId: run.organizationId,
      workflowRunId: run.id,
      level,
      message,
      actionRunId: extra.actionRunId ?? null,
      attempt: extra.attempt ?? null,
      metadata: extra.metadata ?? {},
    },
  });
}

/**
 * Takes the run's lease. Only one worker may execute a run at a time; an expired lease
 * (crashed worker) can be taken over. Finished or failed runs are never re-executed here.
 */
async function claimRun(runId: string) {
  const now = new Date();
  const claimed = await prisma.workflowRun.updateMany({
    where: {
      id: runId,
      OR: [{ status: { in: ["queued", "retrying"] } }, { status: "running", leaseExpiresAt: { lt: now } }],
    },
    data: { status: "running", leaseExpiresAt: new Date(now.getTime() + env.RUN_LEASE_MS), attempts: { increment: 1 } },
  });
  return claimed.count === 1;
}

async function failRun(
  run: { id: string; organizationId: string },
  actionRunId: string,
  reason: "permanent_error" | "retries_exhausted",
  message: string,
  attempts: number,
) {
  await prisma.$transaction(async (tx) => {
    await tx.workflowRun.update({
      where: { id: run.id },
      data: { status: "failed", finishedAt: new Date(), leaseExpiresAt: null, lastError: message },
    });
    await tx.deadLetterEvent.create({
      data: { organizationId: run.organizationId, workflowRunId: run.id, actionRunId, reason, errorMessage: message, attempts },
    });
    await log(tx, run, "error", `Run failed (${reason.replace("_", " ")}); moved to dead-letter queue`, { actionRunId, attempt: attempts });
  });
}

/**
 * Executes one workflow run: actions in position order, skipping any that already succeeded.
 * Each action's destination write and its success-state update commit in ONE transaction,
 * guarded by a conditional update, so retries, duplicate jobs and crashes never duplicate side effects.
 */
export async function executeRun(workflowRunId: string, job: JobAttempt, logger?: Logger): Promise<RunOutcome> {
  if (!(await claimRun(workflowRunId))) {
    logger?.info({ workflowRunId }, "Run not claimable (finished, failed or leased elsewhere); skipping");
    return "skipped";
  }

  const run = await prisma.workflowRun.findUniqueOrThrow({
    where: { id: workflowRunId },
    include: {
      incomingEvent: true,
      actionRuns: {
        orderBy: { position: "asc" },
        include: { workflowAction: { include: { connection: { select: { id: true, status: true } } } } },
      },
    },
  });
  if (!run.startedAt) await prisma.workflowRun.update({ where: { id: run.id }, data: { startedAt: new Date() } });
  await log(prisma, run, "info", `Worker started delivery ${job.attempt}/${job.maxAttempts}`, { attempt: job.attempt });

  const payload = run.incomingEvent.payload as unknown as OrderCreatedEvent;
  const isFinalAttempt = job.attempt >= job.maxAttempts;

  for (const actionRun of run.actionRuns) {
    const action = actionRun.workflowAction;
    const key = `${action.provider}.${action.actionType}` as ActionKey;

    if (actionRun.status === "succeeded") {
      await log(prisma, run, "info", `${key} already succeeded; not repeated`, { actionRunId: actionRun.id });
      continue;
    }

    const started = await prisma.actionRun.update({
      where: { id: actionRun.id },
      data: { status: "running", attempts: { increment: 1 }, startedAt: actionRun.startedAt ?? new Date() },
    });
    const attempt = started.attempts;
    const startedAt = Date.now();

    try {
      const mapped = applyMapping(key, action.mapping as Mapping, payload);
      if (!mapped.success) {
        throw new PermanentActionError(
          `Mapped input is invalid: ${mapped.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
        );
      }
      const input = mapped.data as Record<string, unknown>;

      await prisma.$transaction(async (tx) => {
        const ctx: ActionContext = {
          tx,
          organizationId: run.organizationId,
          connection: action.connection,
          workflowActionId: action.id,
          actionRunId: actionRun.id,
          incomingEventId: run.incomingEventId,
          attempt,
          isSynthetic: run.incomingEvent.isSynthetic,
          config: (action.config ?? {}) as Record<string, unknown>,
          injectedFailure: payload.simulation?.failures?.[key],
        };
        const output =
          key === "mock_crm.upsert_customer"
            ? await upsertCustomer(ctx, input as never, payload.data.order.id)
            : await appendOrderRow(ctx, input as never);

        // Exactly one executor may commit this attempt's success.
        const marked = await tx.actionRun.updateMany({
          where: { id: actionRun.id, status: "running", attempts: attempt },
          data: {
            status: "succeeded",
            input: input as Prisma.InputJsonValue,
            output: output as unknown as Prisma.InputJsonValue,
            finishedAt: new Date(),
            lastError: null,
            errorKind: null,
          },
        });
        if (marked.count !== 1) throw new LostClaimError("Action state changed concurrently");
        await log(tx, run, "info", `${key} succeeded (${output.operation})`, {
          actionRunId: actionRun.id,
          attempt,
          metadata: { durationMs: Date.now() - startedAt, output: output as unknown as Prisma.InputJsonValue },
        });
      });
    } catch (error) {
      if (error instanceof LostClaimError) {
        logger?.warn({ workflowRunId, actionRunId: actionRun.id }, "Lost action claim to another executor; stopping");
        return "skipped";
      }
      const permanent = error instanceof PermanentActionError;
      const message = errorMessage(error);
      const kind = permanent ? "permanent" : "transient";
      const willRetry = !permanent && !isFinalAttempt;

      await prisma.actionRun.update({
        where: { id: actionRun.id },
        data: { status: willRetry ? "retrying" : "failed", lastError: message, errorKind: kind, ...(willRetry ? {} : { finishedAt: new Date() }) },
      });
      await log(prisma, run, permanent || !willRetry ? "error" : "warn", `${key} failed (${kind}): ${message}`, {
        actionRunId: actionRun.id,
        attempt,
        metadata: { durationMs: Date.now() - startedAt, willRetry },
      });

      if (willRetry) {
        await prisma.workflowRun.update({
          where: { id: run.id },
          data: { status: "retrying", leaseExpiresAt: null, lastError: message },
        });
        // Unknown errors (e.g. database hiccups) are treated as transient, like TransientActionError.
        throw new RetryableRunError(message);
      }
      await failRun(run, actionRun.id, permanent ? "permanent_error" : "retries_exhausted", message, attempt);
      throw new UnrecoverableError(message);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.workflowRun.update({
      where: { id: run.id },
      data: { status: "succeeded", finishedAt: new Date(), leaseExpiresAt: null, lastError: null },
    });
    await log(tx, run, "info", "Run succeeded");
  });
  return "succeeded";
}
