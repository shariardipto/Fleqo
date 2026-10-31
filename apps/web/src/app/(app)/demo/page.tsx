"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CopyCheck, Download, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { formatMoney } from "@/lib/format";

interface ImportResult {
  source: string;
  label: string;
  license: string;
  isSynthetic: boolean;
  fetched: number;
  created: number;
  updated: number;
  byKind: Record<string, number>;
}
interface ImportedRecord {
  id: string;
  source: string;
  sourceRecordId: string;
  kind: "customer" | "product" | "cart";
  data: Record<string, unknown>;
  isSynthetic: boolean;
  license: string | null;
}
interface Delivery {
  status: "accepted" | "duplicate";
  eventId: string;
  orderId: string | null;
  matchedWorkflows: number;
  runIds: string[];
}

const FAILURE_OPTIONS = [
  { value: "0", label: "No failure" },
  { value: "1", label: "Fail 1st attempt (transient)" },
  { value: "2", label: "Fail 2 attempts (transient)" },
  { value: "5", label: "Fail 5 attempts (exhausts retries)" },
  { value: "permanent", label: "Permanent error" },
];

function RecordSummary({ record }: { record: ImportedRecord }) {
  const d = record.data as Record<string, string & number & { quantity: number }[]>;
  if (record.kind === "customer") return <>{`${d.name} · ${d.email}`}</>;
  if (record.kind === "product") return <>{`${d.name} · ${formatMoney(Number(d.unitPriceMinor), "USD")}`}</>;
  return <>{`${(d.items as unknown as unknown[]).length} items for ${d.customerExternalId}`}</>;
}

export default function DemoPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const [source, setSource] = useState("fleqo_synthetic");
  const [limit, setLimit] = useState(30);
  const [kind, setKind] = useState<"customer" | "product" | "cart">("customer");
  const [lastImport, setLastImport] = useState<ImportResult | null>(null);
  const [count, setCount] = useState(1);
  const [crmFailure, setCrmFailure] = useState("0");
  const [sheetFailure, setSheetFailure] = useState("0");
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const firstEventId = deliveries[0]?.eventId;

  const records = useQuery({
    queryKey: ["demo-records", kind],
    queryFn: () =>
      api<{ items: ImportedRecord[]; counts: { source: string; kind: string; count: number }[] }>(`/demo/records?kind=${kind}&limit=50`),
  });
  const totalImported = records.data?.counts.reduce((sum, c) => sum + c.count, 0) ?? 0;

  const runImport = useMutation({
    mutationFn: () => api<{ import: ImportResult }>("/demo/import", { method: "POST", body: { source, limit } }),
    onSuccess: (result) => {
      setLastImport(result.import);
      toast.success(`Imported ${result.import.fetched} records (${result.import.created} new)`);
      queryClient.invalidateQueries({ queryKey: ["demo-records"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toFailure = (value: string) => (value === "0" ? undefined : value === "permanent" ? "permanent" : Number(value));
  const simulate = useMutation({
    mutationFn: (body: object) => api<{ deliveries: Delivery[] }>("/demo/simulate-order", { method: "POST", body }),
    onSuccess: (result) => {
      setDeliveries(result.deliveries);
      const accepted = result.deliveries.filter((d) => d.status === "accepted").length;
      toast.success(`${accepted} accepted, ${result.deliveries.length - accepted} duplicate`);
      queryClient.invalidateQueries({ queryKey: ["executions"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title="Demo data & simulator"
        description="Import public or synthetic sample data, then send signed synthetic order.created events through the real webhook pipeline."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="size-4" /> Import sample data
            </CardTitle>
            <CardDescription>Re-importing updates existing records instead of duplicating them.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
              <div className="space-y-2">
                <Label htmlFor="import-source">Source</Label>
                <Select value={source} onValueChange={setSource}>
                  <SelectTrigger id="import-source" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fleqo_synthetic">Fleqo synthetic (offline)</SelectItem>
                    <SelectItem value="dummyjson">DummyJSON public demo API</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="import-limit">Records</Label>
                <Input id="import-limit" type="number" min={1} max={100} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
              </div>
            </div>
            {lastImport && (
              <div className="rounded-lg border bg-muted/40 p-3 text-xs" role="status">
                <p className="font-medium">
                  {lastImport.label}: {lastImport.created} created, {lastImport.updated} updated (
                  {Object.entries(lastImport.byKind)
                    .map(([k, n]) => `${n} ${k}s`)
                    .join(", ")}
                  )
                </p>
                <p className="mt-1 text-muted-foreground">{lastImport.license}</p>
              </div>
            )}
          </CardContent>
          <CardFooter>
            <Button onClick={() => runImport.mutate()} disabled={!can("demo", "import") || runImport.isPending}>
              {runImport.isPending && <Loader2 className="animate-spin" />} Import
            </Button>
            {!can("demo", "import") && <p className="ml-3 text-xs text-muted-foreground">Admins and owners can import.</p>}
          </CardFooter>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="size-4" /> Order event simulator
            </CardTitle>
            <CardDescription>
              Builds synthetic orders from imported customers/products, signs them with your Mock Store secret and delivers them to the webhook
              receiver.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sim-count">Number of orders (1–100)</Label>
              <Input id="sim-count" type="number" min={1} max={100} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sim-crm">CRM fault injection</Label>
                <Select value={crmFailure} onValueChange={setCrmFailure}>
                  <SelectTrigger id="sim-crm" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FAILURE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sim-sheet">Sheet fault injection</Label>
                <Select value={sheetFailure} onValueChange={setSheetFailure}>
                  <SelectTrigger id="sim-sheet" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FAILURE_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {totalImported === 0 && records.isSuccess && (
              <p className="text-xs text-muted-foreground">Import sample data first — the simulator uses imported customers and products.</p>
            )}
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            <Button
              onClick={() =>
                simulate.mutate({
                  count: Math.min(100, Math.max(1, count)),
                  failures: { crm: toFailure(crmFailure), sheet: toFailure(sheetFailure) },
                })
              }
              disabled={!can("demo", "simulate") || simulate.isPending}
            >
              {simulate.isPending && <Loader2 className="animate-spin" />} Send signed events
            </Button>
            <Button
              variant="outline"
              disabled={!firstEventId || simulate.isPending}
              onClick={() => firstEventId && simulate.mutate({ duplicateOfEventId: firstEventId })}
            >
              <CopyCheck /> Re-send first event (duplicate test)
            </Button>
          </CardFooter>
        </Card>
      </div>

      {deliveries.length > 0 && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Last deliveries</CardTitle>
            <CardDescription>Responses from the webhook receiver. Duplicates are acknowledged without new runs.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Result</TableHead>
                  <TableHead>Event</TableHead>
                  <TableHead>Order</TableHead>
                  <TableHead>Runs</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {deliveries.map((d) => (
                  <TableRow key={`${d.eventId}-${d.status}`} data-testid="delivery-row">
                    <TableCell>
                      <Badge variant={d.status === "accepted" ? "default" : "secondary"}>{d.status}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{d.eventId}</TableCell>
                    <TableCell className="font-mono text-xs">{d.orderId ?? "—"}</TableCell>
                    <TableCell>
                      {d.runIds.length === 0 ? (
                        <span className="text-xs text-muted-foreground">No active workflow matched</span>
                      ) : (
                        d.runIds.map((runId) => (
                          <Link key={runId} href={`/executions/${runId}`} className="mr-2 text-xs underline">
                            View run
                          </Link>
                        ))
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Imported records</CardTitle>
          <CardDescription>
            {records.data?.counts.map((c) => `${c.count} ${c.kind}s from ${c.source}`).join(" · ") || "Nothing imported yet."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={kind} onValueChange={(v) => setKind(v as typeof kind)} className="mb-4">
            <TabsList>
              <TabsTrigger value="customer">Customers</TabsTrigger>
              <TabsTrigger value="product">Products</TabsTrigger>
              <TabsTrigger value="cart">Carts</TabsTrigger>
            </TabsList>
          </Tabs>
          {records.isPending ? (
            <LoadingRows rows={3} />
          ) : records.isError ? (
            <ErrorState error={records.error} onRetry={() => records.refetch()} />
          ) : records.data.items.length === 0 ? (
            <EmptyState title={`No ${kind}s imported`} description="Run an import above. Carts are only available from DummyJSON." />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source record</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead>Provenance</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {records.data.items.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-mono text-xs">{record.sourceRecordId}</TableCell>
                      <TableCell className="text-sm">
                        <RecordSummary record={record} />
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" title={record.license ?? undefined}>
                          {record.source}
                        </Badge>
                        {record.isSynthetic && (
                          <Badge variant="secondary" className="ml-1">
                            synthetic
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
