"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ThemeSelector } from "@/components/theme-toggle";
import { ErrorState, LoadingRows } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { meQueryKey, useCan } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

interface OrganizationResponse {
  organization: { id: string; name: string; slug: string; createdAt: string; role: string };
}
interface AuditEntry {
  id: string;
  action: string;
  targetType: string;
  targetId: string | null;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

function AuditLog() {
  const audit = useQuery({ queryKey: ["audit"], queryFn: () => api<{ items: AuditEntry[] }>("/audit-logs?limit=30") });
  if (audit.isPending) return <LoadingRows rows={3} />;
  if (audit.isError) return <ErrorState error={audit.error} onRetry={() => audit.refetch()} />;
  return (
    <div tabIndex={0} role="region" aria-label="Audit log table" className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>When</TableHead>
            <TableHead>Action</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Actor</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {audit.data.items.map((entry) => (
            <TableRow key={entry.id}>
              <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</TableCell>
              <TableCell className="font-mono text-xs">{entry.action}</TableCell>
              <TableCell className="text-xs">{entry.targetType}</TableCell>
              <TableCell className="text-xs">{entry.actor?.email ?? "system"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function SettingsPage() {
  const can = useCan();
  const queryClient = useQueryClient();
  const org = useQuery({ queryKey: ["organization"], queryFn: () => api<OrganizationResponse>("/organization") });
  const [name, setName] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api("/organization", { method: "PATCH", body: { name } }),
    onSuccess: () => {
      toast.success("Organization updated");
      setName(null);
      queryClient.invalidateQueries({ queryKey: ["organization"] });
      queryClient.invalidateQueries({ queryKey: meQueryKey });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (org.isPending) return <LoadingRows />;
  if (org.isError) return <ErrorState error={org.error} onRetry={() => org.refetch()} />;
  const organization = org.data.organization;

  return (
    <>
      <PageHeader title="Settings" description="Appearance, organization details and audit trail." />
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Appearance</CardTitle>
          <CardDescription>Saved in this browser and applied to the website, sign-in and the app.</CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeSelector />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Organization</CardTitle>
          <CardDescription>
            Slug <code className="font-mono">{organization.slug}</code> · created {formatDateTime(organization.createdAt)} · your role{" "}
            <span className="capitalize">{organization.role}</span>
          </CardDescription>
        </CardHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <CardContent className="space-y-2">
            <Label htmlFor="org-name">Name</Label>
            <Input
              id="org-name"
              value={name ?? organization.name}
              onChange={(e) => setName(e.target.value)}
              disabled={!can("organization", "update")}
              minLength={2}
              maxLength={80}
            />
          </CardContent>
          <CardFooter className="mt-6">
            <Button type="submit" disabled={!can("organization", "update") || name === null || save.isPending}>
              {save.isPending && <Loader2 className="animate-spin" />} Save
            </Button>
          </CardFooter>
        </form>
      </Card>

      {can("audit", "read") && (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Most recent configuration and membership changes.</CardDescription>
          </CardHeader>
          <CardContent>
            <AuditLog />
          </CardContent>
        </Card>
      )}
    </>
  );
}
