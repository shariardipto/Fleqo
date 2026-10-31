"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Loader2, RotateCw } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCan } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { actionLabel, durationMs, formatDateTime } from "@/lib/format";
import type { ExecutionDetail } from "@/lib/types";
import { cn } from "@/lib/utils";

function Json({ value }: { value: unknown }) {
  return <pre className="max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>;
}

const levelStyle = { info: "text-muted-foreground", warn: "text-amber-700 dark:text-amber-300", error: "text-red-700 dark:text-red-300" };

export default function ExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const can = useCan();
  const execution = useQuery({
    queryKey: ["execution", id],
    queryFn: () => api<{ execution: ExecutionDetail }>(`/executions/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.execution.status;
      return status && ["queued", "running", "retrying"].includes(status) ? 1500 : false;
    },
  });
  const retry = useMutation({
    mutationFn: () => api(`/executions/${id}/retry`, { method: "POST" }),
    onSuccess: () => {
      toast.success("Retry queued — completed actions will be skipped");
      queryClient.invalidateQueries({ queryKey: ["execution", id] });
      queryClient.invalidateQueries({ queryKey: ["executions"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (execution.isPending) return <LoadingRows rows={6} />;
  if (execution.isError) return <ErrorState error={execution.error} onRetry={() => execution.refetch()} />;
  const run = execution.data.execution;
  const openDeadLetter = run.deadLetters.find((d) => !d.resolvedAt);
  const actionName = (actionRunId: string | null) => {
    const action = run.actionRuns.find((a) => a.id === actionRunId);
    return action ? actionLabel(action.provider, action.actionType) : "Run";
  };

  return (
    <>
      <PageHeader
        title={`Execution · ${run.incomingEvent.externalEventId}`}
        description={
          <>
            Workflow{" "}
            <Link href={`/workflows/${run.workflow.id}`} className="underline underline-offset-4">
              {run.workflow.name}
            </Link>{" "}
            · created {formatDateTime(run.createdAt)} · {run.attempts} worker deliver{run.attempts === 1 ? "y" : "ies"}
          </>
        }
        actions={
          <>
            <StatusBadge status={run.status} className="text-sm" />
            {run.status === "failed" && can("execution", "retry") && (
              <Button onClick={() => retry.mutate()} disabled={retry.isPending}>
                {retry.isPending ? <Loader2 className="animate-spin" /> : <RotateCw />} Retry failed actions
              </Button>
            )}
          </>
        }
      />

      {openDeadLetter && (
        <Alert variant="destructive" className="mb-6">
          <AlertTriangle />
          <AlertTitle>In dead-letter queue ({openDeadLetter.reason.replace("_", " ")})</AlertTitle>
          <AlertDescription>
            {openDeadLetter.errorMessage} — after {openDeadLetter.attempts} attempt(s).{" "}
            {can("execution", "retry") ? "Retrying re-runs only incomplete actions." : "An admin or owner can retry it."}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {run.actionRuns.map((action) => (
            <Card key={action.id} data-testid="action-run">
              <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle>
                    {action.position}. {actionLabel(action.provider, action.actionType)}
                  </CardTitle>
                  <CardDescription>
                    {action.attempts} attempt{action.attempts === 1 ? "" : "s"}
                    {action.startedAt && ` · ${durationMs(action.startedAt, action.finishedAt) ?? "in progress"}`}
                    {action.errorKind && ` · ${action.errorKind} error`}
                  </CardDescription>
                </div>
                <StatusBadge status={action.status} />
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {action.lastError && <p className="rounded-md bg-red-50 p-2 text-red-800 dark:bg-red-950 dark:text-red-200">{action.lastError}</p>}
                {action.status === "queued" && action.attempts === 0 && run.status === "failed" && (
                  <p className="text-muted-foreground">Not executed because an earlier action failed.</p>
                )}
                {action.input && (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">Mapped input</summary>
                    <Json value={action.input} />
                  </details>
                )}
                {action.output && (
                  <details open>
                    <summary className="cursor-pointer text-xs font-medium">Result</summary>
                    <Json value={action.output} />
                  </details>
                )}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Execution log</CardTitle>
              <CardDescription>Persisted, timestamped log lines for each attempt.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Attempt</TableHead>
                    <TableHead>Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {run.logs.map((log) => (
                    <TableRow key={log.id} data-level={log.level}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(log.createdAt)}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">{actionName(log.actionRunId)}</TableCell>
                      <TableCell className="text-xs">{log.attempt ?? "—"}</TableCell>
                      <TableCell className={cn("text-xs", levelStyle[log.level])}>{log.message}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Event</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-1">
                <Badge variant="outline">{run.incomingEvent.eventType}</Badge>
                <Badge variant="outline">via {run.incomingEvent.source}</Badge>
                {run.incomingEvent.isSynthetic && <Badge variant="secondary">synthetic</Badge>}
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted-foreground">Received</dt>
                <dd>{formatDateTime(run.incomingEvent.receivedAt)}</dd>
                <dt className="text-muted-foreground">Signed at</dt>
                <dd>{formatDateTime(run.incomingEvent.signedAt)}</dd>
                <dt className="text-muted-foreground">Duplicates</dt>
                <dd>
                  {run.incomingEvent.duplicateCount} ignored
                  {run.incomingEvent.lastDuplicateAt && ` (last ${formatDateTime(run.incomingEvent.lastDuplicateAt)})`}
                </dd>
                {run.dispatch && (
                  <>
                    <dt className="text-muted-foreground">Dispatch</dt>
                    <dd>
                      {run.dispatch.status} · generation {run.dispatch.generation}
                    </dd>
                  </>
                )}
              </dl>
              <details>
                <summary className="cursor-pointer text-xs font-medium">Raw payload</summary>
                <Json value={run.incomingEvent.payload} />
              </details>
            </CardContent>
          </Card>
          {run.deadLetters.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Dead-letter history</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                {run.deadLetters.map((d) => (
                  <div key={d.id} className="rounded-md border p-2">
                    <p className="font-medium">{d.reason.replace("_", " ")}</p>
                    <p className="text-muted-foreground">{d.errorMessage}</p>
                    <p className="text-muted-foreground">
                      {formatDateTime(d.createdAt)} · {d.resolvedAt ? `resolved ${formatDateTime(d.resolvedAt)}` : "open"}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
