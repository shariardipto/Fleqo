"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { Activity, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { actionLabel, formatMoney, timeAgo } from "@/lib/format";
import type { ExecutionListItem, Paged } from "@/lib/types";

const STATUSES = ["all", "queued", "running", "retrying", "succeeded", "failed"] as const;

export default function ExecutionsPage() {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const executions = useInfiniteQuery({
    queryKey: ["executions", status, search],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "25" });
      if (status !== "all") params.set("status", status);
      if (search) params.set("search", search);
      if (pageParam) params.set("cursor", pageParam);
      return api<Paged<ExecutionListItem>>(`/executions?${params}`);
    },
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    // Live view while anything is still in flight.
    refetchInterval: (query) =>
      query.state.data?.pages.some((page) => page.items.some((run) => ["queued", "running", "retrying"].includes(run.status)))
        ? 2000
        : 10_000,
  });
  const items = executions.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <>
      <PageHeader title="Executions" description="Every workflow run with action-level status, attempts and retry state." />
      <Card className="mb-4">
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              className="pl-8"
              placeholder="Search event ID, order ID or customer email"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label="Search executions"
            />
          </div>
          <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
            <SelectTrigger className="w-full sm:w-44" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s} className="capitalize">
                  {s === "all" ? "All statuses" : s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {executions.isPending ? (
        <LoadingRows rows={6} />
      ) : executions.isError ? (
        <ErrorState error={executions.error} onRetry={() => executions.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={search || status !== "all" ? "No matching executions" : "No executions yet"}
          description="Runs appear here when a signed order.created event matches an active workflow."
          action={
            <Button variant="outline" asChild>
              <Link href="/demo">Simulate an order</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent>
            <p className="mb-2 text-xs text-muted-foreground">{executions.data.pages[0].total} total</p>
            <div tabIndex={0} role="region" aria-label="Executions table" className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Event</TableHead>
                    <TableHead className="text-right">Order total</TableHead>
                    <TableHead>Actions</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((run) => (
                    <TableRow key={run.id} className="cursor-pointer" data-testid="execution-row">
                      <TableCell>
                        <Link href={`/executions/${run.id}`} aria-label={`Open execution ${run.incomingEvent.externalEventId}`}>
                          <StatusBadge status={run.status} />
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/executions/${run.id}`} className="font-medium hover:underline">
                          {run.workflow.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{run.incomingEvent.externalEventId}</span>
                        {run.incomingEvent.isSynthetic && (
                          <Badge variant="secondary" className="ml-2 text-[10px]">
                            synthetic
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {run.order ? formatMoney(run.order.totalMinor, run.order.currency) : "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {run.actionRuns.map((action) => (
                            <span key={action.id} className="text-xs text-muted-foreground" title={actionLabel(action.provider, action.actionType)}>
                              {action.provider === "mock_crm" ? "CRM" : "Sheet"}: {action.status}
                              {action.attempts > 1 ? ` (×${action.attempts})` : ""}
                            </span>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{timeAgo(run.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {executions.hasNextPage && (
              <Button variant="outline" size="sm" className="mt-3" onClick={() => executions.fetchNextPage()} disabled={executions.isFetchingNextPage}>
                Load more
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </>
  );
}
