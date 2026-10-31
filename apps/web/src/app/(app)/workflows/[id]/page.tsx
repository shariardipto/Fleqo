"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowDown, Loader2, Save, Zap } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MappingEditor } from "@/features/workflows/mapping-editor";
import { useCan } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Catalog, Workflow } from "@/lib/types";

export default function WorkflowDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = useCan();
  const canManage = can("workflow", "manage");

  const workflow = useQuery({ queryKey: ["workflow", id], queryFn: () => api<{ workflow: Workflow }>(`/workflows/${id}`) });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api<Catalog>("/workflows/catalog") });
  const [edits, setEdits] = useState<Record<string, { mapping?: Record<string, string>; sheetName?: string }>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["workflow", id] });
    queryClient.invalidateQueries({ queryKey: ["workflows"] });
  };
  const patch = useMutation({
    mutationFn: (body: object) => api(`/workflows/${id}`, { method: "PATCH", body }),
    onSuccess: () => {
      toast.success("Workflow updated");
      setEdits({});
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const archive = useMutation({
    mutationFn: () => api(`/workflows/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Workflow archived");
      invalidate();
      router.push("/workflows");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (workflow.isPending || catalog.isPending) return <LoadingRows rows={5} />;
  if (workflow.isError) return <ErrorState error={workflow.error} onRetry={() => workflow.refetch()} />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;

  const wf = workflow.data.workflow;
  const archived = wf.status === "archived";
  const editable = canManage && !archived;
  const dirty = Object.keys(edits).length > 0;
  const runs = wf.stats?.runs ?? {};

  return (
    <>
      <PageHeader
        title={wf.name}
        description={wf.description ?? undefined}
        actions={
          <>
            <StatusBadge status={wf.status} />
            {/* Read-only roles rely on the status badge; a greyed-out switch would read as "off". */}
            {editable && (
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  tone="success"
                  checked={wf.status === "active"}
                  disabled={patch.isPending}
                  onCheckedChange={(checked) => patch.mutate({ status: checked ? "active" : "inactive" })}
                  aria-label="Workflow enabled"
                />
                {wf.status === "active" ? "Enabled" : "Disabled"}
              </label>
            )}
            {editable && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Archive /> Archive
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive this workflow?</AlertDialogTitle>
                    <AlertDialogDescription>
                      It stops matching new events. Past runs, logs and destination records are kept.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => archive.mutate()}>Archive</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="size-4" /> Trigger
              </CardTitle>
              <CardDescription>Signed webhook from {wf.trigger?.connection.name}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm">
              <code className="rounded bg-muted px-2 py-1">
                {wf.trigger?.provider}.{wf.trigger?.eventType}
              </code>
            </CardContent>
          </Card>

          {wf.actions.map((action) => {
            const definition = catalog.data.actions.find((a) => a.key === action.key);
            const edit = edits[action.id] ?? {};
            return (
              <div key={action.id} className="space-y-4">
                <ArrowDown className="mx-auto size-4 text-muted-foreground" aria-hidden />
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Step {action.position}: {action.label}
                    </CardTitle>
                    <CardDescription>
                      Connection: {action.connection.name} <StatusBadge status={action.connection.status} className="ml-1" />
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {definition && (
                      <MappingEditor
                        idPrefix={action.id}
                        fields={definition.fields}
                        sources={catalog.data.sources}
                        mapping={edit.mapping ?? action.mapping}
                        disabled={!editable}
                        onChange={(mapping) => setEdits({ ...edits, [action.id]: { ...edit, mapping } })}
                      />
                    )}
                    {action.key === "mock_sheet.append_order" && (
                      <div className="space-y-2">
                        <Label htmlFor={`sheet-${action.id}`}>Sheet name</Label>
                        <Input
                          id={`sheet-${action.id}`}
                          value={edit.sheetName ?? action.config.sheetName ?? "Orders"}
                          disabled={!editable}
                          maxLength={60}
                          onChange={(e) => setEdits({ ...edits, [action.id]: { ...edit, sheetName: e.target.value } })}
                        />
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            );
          })}

          {editable && (
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={!dirty} onClick={() => setEdits({})}>
                Discard
              </Button>
              <Button
                disabled={!dirty || patch.isPending}
                onClick={() =>
                  patch.mutate({
                    actions: Object.entries(edits).map(([actionId, edit]) => ({
                      id: actionId,
                      ...(edit.mapping ? { mapping: edit.mapping } : {}),
                      ...(edit.sheetName !== undefined ? { config: { sheetName: edit.sheetName } } : {}),
                    })),
                  })
                }
              >
                {patch.isPending ? <Loader2 className="animate-spin" /> : <Save />} Save mapping
              </Button>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Runs</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm">
              {(["succeeded", "failed", "retrying", "queued"] as const).map((status) => (
                <div key={status}>
                  <p className="text-xs capitalize text-muted-foreground">{status}</p>
                  <p className="text-lg font-semibold tabular-nums">{runs[status] ?? 0}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Recent runs</CardTitle>
            </CardHeader>
            <CardContent>
              {wf.stats?.recentRuns?.length ? (
                <ul className="space-y-2 text-sm">
                  {wf.stats.recentRuns.map((run) => (
                    <li key={run.id}>
                      <Link href={`/executions/${run.id}`} className="flex items-center gap-2 hover:underline">
                        <StatusBadge status={run.status} />
                        <span className="truncate font-mono text-xs">{run.incomingEvent.externalEventId}</span>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{timeAgo(run.createdAt)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
