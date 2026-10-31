"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, Lock, Plug, ShieldAlert, ShoppingBag, Sheet as SheetIcon, Users } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ErrorState, LoadingRows } from "@/components/states";
import { StatusBadge } from "@/components/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime, formatMoney, timeAgo } from "@/lib/format";
import type { Connection, Paged, Provider } from "@/lib/types";

const PROVIDERS: { provider: Provider; label: string; description: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { provider: "mock_store", label: "Mock Store", description: "Signs order.created webhooks (HMAC-SHA256).", icon: ShoppingBag },
  { provider: "mock_crm", label: "Mock CRM", description: "Customer records persisted in PostgreSQL.", icon: Users },
  { provider: "mock_sheet", label: "Mock Sheet", description: "Order rows persisted in PostgreSQL.", icon: SheetIcon },
];

interface ConnectionsResponse {
  connections: Connection[];
  webhook: { path: string; headers: string[]; signature: string };
}

function ViewOnly() {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="connection-view-only">
      <Lock className="size-3.5" aria-hidden /> View only · admins and owners can change this
    </p>
  );
}

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(secret)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Signing secret</DialogTitle>
          <DialogDescription>
            Copy it now — Fleqo stores it encrypted and will not show it again. Rotate it to get a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={secret ?? ""} className="font-mono text-xs" aria-label="Signing secret" />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy secret"
            onClick={() => navigator.clipboard.writeText(secret ?? "").then(() => toast.success("Copied"))}
          >
            <Copy />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I have stored it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordsTables() {
  const customers = useInfiniteQuery({
    queryKey: ["mock-crm"],
    queryFn: ({ pageParam }) => api<Paged<{ id: string; customerExternalId: string; email: string; name: string | null; lastOrderExternalId: string | null; updatedAt: string; isSynthetic: boolean }>>(`/mock-crm/customers?limit=20${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 5000,
  });
  const rows = useInfiniteQuery({
    queryKey: ["mock-sheet"],
    queryFn: ({ pageParam }) => api<Paged<{ id: string; sheetName: string; orderExternalId: string; customerEmail: string; totalMinor: number; currency: string; createdAt: string }>>(`/mock-sheet/rows?limit=20${pageParam ? `&cursor=${pageParam}` : ""}`),
    initialPageParam: "",
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    refetchInterval: 5000,
  });

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle>Destination records</CardTitle>
        <CardDescription>Real rows written by workflow actions (PostgreSQL-backed mock CRM and Sheet).</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="crm">
          <TabsList>
            <TabsTrigger value="crm">CRM customers ({customers.data?.pages[0]?.total ?? 0})</TabsTrigger>
            <TabsTrigger value="sheet">Sheet rows ({rows.data?.pages[0]?.total ?? 0})</TabsTrigger>
          </TabsList>
          <TabsContent value="crm" className="mt-4">
            {customers.isPending ? (
              <LoadingRows rows={3} />
            ) : customers.isError ? (
              <ErrorState error={customers.error} onRetry={() => customers.refetch()} />
            ) : customers.data.pages[0].items.length === 0 ? (
              <EmptyState title="No customers yet" description="The CRM upsert action creates customers here." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Customer ID</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Last order</TableHead>
                      <TableHead>Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.data.pages.flatMap((page) => page.items).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-mono text-xs">{c.customerExternalId}</TableCell>
                        <TableCell>{c.name ?? "—"}</TableCell>
                        <TableCell>{c.email}</TableCell>
                        <TableCell className="font-mono text-xs">{c.lastOrderExternalId ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{timeAgo(c.updatedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {customers.hasNextPage && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => customers.fetchNextPage()}>
                    Load more
                  </Button>
                )}
              </div>
            )}
          </TabsContent>
          <TabsContent value="sheet" className="mt-4">
            {rows.isPending ? (
              <LoadingRows rows={3} />
            ) : rows.isError ? (
              <ErrorState error={rows.error} onRetry={() => rows.refetch()} />
            ) : rows.data.pages[0].items.length === 0 ? (
              <EmptyState title="No rows yet" description="The Sheet append action adds one row per order." />
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sheet</TableHead>
                      <TableHead>Order</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Appended</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.data.pages.flatMap((page) => page.items).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell>{r.sheetName}</TableCell>
                        <TableCell className="font-mono text-xs">{r.orderExternalId}</TableCell>
                        <TableCell>{r.customerEmail}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMoney(r.totalMinor, r.currency)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDateTime(r.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {rows.hasNextPage && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => rows.fetchNextPage()}>
                    Load more
                  </Button>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

export default function ConnectionsPage() {
  const can = useCan();
  const canManage = can("connection", "manage");
  const queryClient = useQueryClient();
  const [secret, setSecret] = useState<string | null>(null);
  const connections = useQuery({ queryKey: ["connections"], queryFn: () => api<ConnectionsResponse>("/connections") });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["connections"] });

  const create = useMutation({
    mutationFn: (provider: Provider) =>
      api<{ connection: Connection; signingSecret: string | null }>("/connections", { method: "POST", body: { provider } }),
    onSuccess: (result) => {
      toast.success(`${result.connection.providerLabel} connected`);
      if (result.signingSecret) setSecret(result.signingSecret);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "disabled" }) =>
      api(`/connections/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });
  const rotate = useMutation({
    mutationFn: (id: string) => api<{ signingSecret: string }>(`/connections/${id}/rotate-secret`, { method: "POST" }),
    onSuccess: (result) => {
      setSecret(result.signingSecret);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title="Connections"
        description="Organization-scoped mock services. They are not real Shopify, CRM or Google Sheets integrations."
      />
      {connections.isPending ? (
        <LoadingRows rows={3} />
      ) : connections.isError ? (
        <ErrorState error={connections.error} onRetry={() => connections.refetch()} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            {PROVIDERS.map(({ provider, label, description, icon: Icon }) => {
              const connection = connections.data.connections.find((c) => c.provider === provider);
              return (
                <Card key={provider} data-testid={`connection-${provider}`}>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Icon className="size-4" /> {label}
                    </CardTitle>
                    <CardDescription>{description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {connection ? (
                      <>
                        <StatusBadge status={connection.status} />
                        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                          <dt className="text-muted-foreground">Connection ID</dt>
                          <dd className="truncate font-mono" title={connection.publicId}>{connection.publicId}</dd>
                          {connection.hasSigningSecret && (
                            <>
                              <dt className="text-muted-foreground">Secret</dt>
                              <dd className="font-mono">••••{connection.secretLast4}</dd>
                            </>
                          )}
                          {provider === "mock_store" && (
                            <>
                              <dt className="text-muted-foreground">Events</dt>
                              <dd>{connection.stats?.events ?? 0} · last {timeAgo(connection.stats?.lastEventAt)}</dd>
                            </>
                          )}
                          {provider === "mock_crm" && (
                            <>
                              <dt className="text-muted-foreground">Customers</dt>
                              <dd>{connection.stats?.customers ?? 0}</dd>
                            </>
                          )}
                          {provider === "mock_sheet" && (
                            <>
                              <dt className="text-muted-foreground">Rows</dt>
                              <dd>{connection.stats?.rows ?? 0}</dd>
                            </>
                          )}
                        </dl>
                      </>
                    ) : (
                      <p className="text-muted-foreground">Not connected.</p>
                    )}
                  </CardContent>
                  <CardFooter className="flex flex-wrap items-center gap-3">
                    {!connection ? (
                      canManage ? (
                        <Button onClick={() => create.mutate(provider)} disabled={create.isPending}>
                          <Plug /> Connect
                        </Button>
                      ) : (
                        <ViewOnly />
                      )
                    ) : canManage ? (
                      <>
                        <label className="flex items-center gap-2 text-sm">
                          <Switch
                            tone="success"
                            checked={connection.status === "active"}
                            // Only the connection being saved is locked; the others stay usable.
                            disabled={update.isPending && update.variables?.id === connection.id}
                            onCheckedChange={(checked) => update.mutate({ id: connection.id, status: checked ? "active" : "disabled" })}
                            aria-label={`${label} enabled`}
                          />
                          <span data-testid="connection-toggle-label">{connection.status === "active" ? "Enabled" : "Disabled"}</span>
                        </label>
                        {provider === "mock_store" && (
                          <Button variant="outline" size="sm" disabled={rotate.isPending} onClick={() => rotate.mutate(connection.id)}>
                            <KeyRound /> Rotate secret
                          </Button>
                        )}
                      </>
                    ) : (
                      // Read-only roles see the status badge; a greyed-out switch would read as "off".
                      <ViewOnly />
                    )}
                  </CardFooter>
                </Card>
              );
            })}
          </div>

          <Alert className="mt-6">
            <ShieldAlert />
            <AlertTitle>Webhook contract</AlertTitle>
            <AlertDescription>
              <p>
                <code className="font-mono">POST {connections.data.webhook.path}</code> with headers{" "}
                {connections.data.webhook.headers.map((h) => (
                  <code key={h} className="mr-1 font-mono">{h}</code>
                ))}
              </p>
              <p className="mt-1">
                Signature: <code className="font-mono">{connections.data.webhook.signature}</code>. Timestamps older than 5 minutes are rejected; the event
                ID is deduplicated per organization.
              </p>
              <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs">{`const ts = Math.floor(Date.now() / 1000);
const body = JSON.stringify(event);
const sig = crypto.createHmac("sha256", SECRET).update(\`\${ts}.\${body}\`).digest("hex");
await fetch(API_URL + "/api/webhooks/mock-store", { method: "POST", body,
  headers: { "Content-Type": "application/json", "X-Fleqo-Connection-Id": CONNECTION_ID,
             "X-Fleqo-Timestamp": String(ts), "X-Fleqo-Signature": sig } });`}</pre>
            </AlertDescription>
          </Alert>

          <RecordsTables />
        </>
      )}
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
    </>
  );
}
