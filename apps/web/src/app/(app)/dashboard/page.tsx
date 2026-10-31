"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, ArrowRight, CheckCircle2, Circle, Copy, Sheet, Users, Workflow } from "lucide-react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { RunStatus } from "@/lib/types";

interface Summary {
  workflows: Partial<Record<"active" | "inactive" | "archived", number>>;
  runs: { all: Partial<Record<RunStatus, number>>; last24h: Partial<Record<RunStatus, number>> };
  events: { total: number; duplicatesIgnored: number };
  deadLettersOpen: number;
  destinations: { customers: number; sheetRows: number };
  connections: { provider: string; status: string }[];
  recentRuns: { id: string; status: RunStatus; createdAt: string; workflow: { name: string }; incomingEvent: { externalEventId: string } }[];
}

function Kpi({ label, value, hint, icon: Icon }: { label: string; value: number | string; hint?: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <Icon className="size-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const summary = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => api<Summary>("/dashboard/summary"),
    refetchInterval: 5000,
  });

  if (summary.isPending) return <LoadingRows rows={6} />;
  if (summary.isError) return <ErrorState error={summary.error} onRetry={() => summary.refetch()} />;
  const data = summary.data;
  const all = data.runs.all;
  const day = data.runs.last24h;
  const total = Object.values(all).reduce((sum, n) => sum + (n ?? 0), 0);

  const steps = [
    { done: data.connections.length >= 3, label: "Connect Mock Store, CRM and Sheet", href: "/connections" },
    { done: (data.workflows.active ?? 0) > 0, label: "Create and enable the Order Sync workflow", href: "/workflows/new" },
    { done: data.events.total > 0, label: "Import demo data and simulate an order", href: "/demo" },
    { done: total > 0, label: "Review the execution and its action logs", href: "/executions" },
  ];
  const setupComplete = steps.every((step) => step.done);

  return (
    <>
      <PageHeader title="Dashboard" description="Live status of your order-sync automations. Figures are counts of persisted records." />

      {!setupComplete && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Complete the demo loop: event → workflow → CRM + Sheet → execution log.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {steps.map((step) => (
              <Link key={step.label} href={step.href} className="flex items-center gap-3 rounded-lg border p-3 text-sm hover:bg-muted/50">
                {step.done ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
                <span className={step.done ? "text-muted-foreground line-through" : ""}>{step.label}</span>
                <ArrowRight className="ml-auto size-4 text-muted-foreground" />
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Active workflows" value={data.workflows.active ?? 0} hint={`${data.workflows.inactive ?? 0} inactive`} icon={Workflow} />
        <Kpi
          label="Runs (24h)"
          value={Object.values(day).reduce((s, n) => s + (n ?? 0), 0)}
          hint={`${day.succeeded ?? 0} succeeded · ${day.failed ?? 0} failed`}
          icon={Activity}
        />
        <Kpi label="Events received" value={data.events.total} hint={`${data.events.duplicatesIgnored} duplicate deliveries ignored`} icon={Copy} />
        <Kpi label="Open dead letters" value={data.deadLettersOpen} hint="Failed runs awaiting retry" icon={AlertTriangle} />
        <Kpi label="CRM customers" value={data.destinations.customers} icon={Users} />
        <Kpi label="Sheet rows" value={data.destinations.sheetRows} icon={Sheet} />
        <Kpi label="Runs succeeded (all time)" value={all.succeeded ?? 0} icon={CheckCircle2} />
        <Kpi
          label="In progress"
          value={(all.queued ?? 0) + (all.running ?? 0) + (all.retrying ?? 0)}
          hint={`${all.retrying ?? 0} retrying`}
          icon={Activity}
        />
      </div>

      <Card className="mt-6">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Recent runs</CardTitle>
            <CardDescription>Latest workflow executions across all workflows.</CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/executions">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {data.recentRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No runs yet. Simulate an order from the Demo data page.</p>
          ) : (
            <ul className="divide-y">
              {data.recentRuns.map((run) => (
                <li key={run.id}>
                  <Link href={`/executions/${run.id}`} className="flex flex-wrap items-center gap-3 py-3 text-sm hover:bg-muted/40">
                    <StatusBadge status={run.status} />
                    <span className="font-medium">{run.workflow.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{run.incomingEvent.externalEventId}</span>
                    <span className="ml-auto text-xs text-muted-foreground">{timeAgo(run.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}
