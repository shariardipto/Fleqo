"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/page-header";
import { ErrorState, LoadingRows } from "@/components/states";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { MappingEditor } from "@/features/workflows/mapping-editor";
import { useCan } from "@/hooks/use-me";
import { api, errorMessage } from "@/lib/api";
import type { Catalog, Workflow } from "@/lib/types";

export default function NewWorkflowPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const can = useCan();
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: () => api<Catalog>("/workflows/catalog") });

  const [name, setName] = useState("Order Sync");
  const [description, setDescription] = useState("New store orders → CRM customer → order sheet");
  const [enabled, setEnabled] = useState(true);
  const [selected, setSelected] = useState<Record<string, boolean>>({
    "mock_crm.upsert_customer": true,
    "mock_sheet.append_order": true,
  });
  const [mappings, setMappings] = useState<Record<string, Record<string, string>>>({});
  const [sheetName, setSheetName] = useState("Orders");

  const create = useMutation({
    mutationFn: () =>
      api<{ workflow: Workflow }>("/workflows", {
        method: "POST",
        body: {
          name,
          description: description || undefined,
          enabled,
          actions: catalog
            .data!.actions.filter((action) => selected[action.key])
            .map((action) => ({
              key: action.key,
              mapping: mappings[action.key] ?? action.defaultMapping,
              config: action.key === "mock_sheet.append_order" ? { sheetName } : {},
            })),
        },
      }),
    onSuccess: async (result) => {
      toast.success("Workflow created");
      await queryClient.invalidateQueries({ queryKey: ["workflows"] });
      router.push(`/workflows/${result.workflow.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (catalog.isPending) return <LoadingRows rows={5} />;
  if (catalog.isError) return <ErrorState error={catalog.error} onRetry={() => catalog.refetch()} />;
  if (!can("workflow", "manage")) {
    return <ErrorState error={new Error("Only admins and owners can create workflows.")} />;
  }

  const providers = new Set(catalog.data.connections.map((c) => c.provider));
  const missing = ["mock_store", "mock_crm", "mock_sheet"].filter((p) => !providers.has(p as never));
  const chosen = catalog.data.actions.filter((action) => selected[action.key]);

  return (
    <>
      <PageHeader title="New workflow" description="Guided setup for the MVP's single trigger and two sequential actions." />
      {missing.length > 0 && (
        <Alert variant="destructive" className="mb-6">
          <AlertCircle />
          <AlertTitle>Connections needed</AlertTitle>
          <AlertDescription>
            Connect {missing.join(", ").replaceAll("_", " ")} first.{" "}
            <Link href="/connections" className="underline">
              Open Connections
            </Link>
          </AlertDescription>
        </Alert>
      )}
      <form
        className="space-y-6"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate();
        }}
      >
        <Card>
          <CardHeader>
            <CardTitle>1 · Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="wf-name">Name</Label>
              <Input id="wf-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={80} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="wf-description">Description</Label>
              <Textarea id="wf-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Zap className="size-4" /> 2 · Trigger
            </CardTitle>
            <CardDescription>MVP supports one trigger: a signed <code>order.created</code> webhook from your Mock Store.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">{catalog.data.trigger.label}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>3 · Actions (run in order)</CardTitle>
            <CardDescription>Map event fields to each destination. Required fields are marked *.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {catalog.data.actions.map((action, index) => (
              <div key={action.key} className="rounded-lg border p-4">
                <label className="flex items-start gap-3">
                  <Checkbox
                    checked={selected[action.key]}
                    onCheckedChange={(checked) => setSelected({ ...selected, [action.key]: checked === true })}
                    aria-label={`Include ${action.label}`}
                  />
                  <span>
                    <span className="font-medium">
                      Step {index + 1}: {action.label}
                    </span>
                    <span className="block text-sm text-muted-foreground">{action.description}</span>
                  </span>
                </label>
                {selected[action.key] && (
                  <div className="mt-4 space-y-4">
                    <MappingEditor
                      idPrefix={action.key}
                      fields={action.fields}
                      sources={catalog.data.sources}
                      mapping={mappings[action.key] ?? action.defaultMapping}
                      onChange={(mapping) => setMappings({ ...mappings, [action.key]: mapping })}
                    />
                    {action.key === "mock_sheet.append_order" && (
                      <div className="space-y-2">
                        <Label htmlFor="sheet-name">Sheet name</Label>
                        <Input id="sheet-name" value={sheetName} onChange={(e) => setSheetName(e.target.value)} maxLength={60} required />
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-4">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable workflow" /> Enable immediately
            </label>
            <Button type="submit" disabled={create.isPending || chosen.length === 0 || missing.length > 0}>
              {create.isPending && <Loader2 className="animate-spin" />}
              Create workflow
            </Button>
          </CardContent>
        </Card>
      </form>
    </>
  );
}
