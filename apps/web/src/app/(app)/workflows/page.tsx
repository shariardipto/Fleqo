"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Plus, Workflow as WorkflowIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useCan } from "@/hooks/use-me";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { Workflow } from "@/lib/types";

export default function WorkflowsPage() {
  const can = useCan();
  const [showArchived, setShowArchived] = useState(false);
  const workflows = useQuery({
    queryKey: ["workflows", showArchived],
    queryFn: () => api<{ workflows: Workflow[] }>(`/workflows?includeArchived=${showArchived}`),
  });

  return (
    <>
      <PageHeader
        title="Workflows"
        description="Order Sync: Mock Store order.created → CRM upsert → Sheet append."
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <Switch checked={showArchived} onCheckedChange={setShowArchived} aria-label="Show archived" /> Show archived
            </label>
            {can("workflow", "manage") && (
              <Button asChild>
                <Link href="/workflows/new">
                  <Plus /> New workflow
                </Link>
              </Button>
            )}
          </>
        }
      />
      {workflows.isPending ? (
        <LoadingRows />
      ) : workflows.isError ? (
        <ErrorState error={workflows.error} onRetry={() => workflows.refetch()} />
      ) : workflows.data.workflows.length === 0 ? (
        <EmptyState
          icon={WorkflowIcon}
          title="No workflows yet"
          description="Create the Order Sync workflow to start moving new orders into the mock CRM and Sheet."
          action={
            can("workflow", "manage") && (
              <Button asChild>
                <Link href="/workflows/new">Create workflow</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {workflows.data.workflows.map((workflow) => (
            <Card key={workflow.id}>
              <CardContent>
                <Link href={`/workflows/${workflow.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{workflow.name}</span>
                      <StatusBadge status={workflow.status} />
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <span>Mock Store · order.created</span>
                      {workflow.actions.map((action) => (
                        <span key={action.id} className="flex items-center gap-1">
                          <ArrowRight className="size-3" /> {action.label}
                        </span>
                      ))}
                    </p>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <p>
                      {workflow.stats?.runs.succeeded ?? 0} succeeded · {workflow.stats?.runs.failed ?? 0} failed
                    </p>
                    <p>Last run {timeAgo(workflow.stats?.lastRunAt)}</p>
                  </div>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
