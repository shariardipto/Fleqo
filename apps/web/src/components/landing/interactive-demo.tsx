"use client";

import { CheckCircle2, Circle, CopyCheck, Loader2, MinusCircle, Play, RotateCw, ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/*
 * A browser-only demonstration of Fleqo's real pipeline. Nothing here talks to a server, uses an
 * account or touches real data: sample orders are generated locally and the signature is computed
 * with WebCrypto using a public demo secret.
 */

const DEMO_SECRET = "whsec_public_demo_secret_not_used_by_any_account";
const CUSTOMERS = [
  { id: "syn_customer_007", name: "Ava Rahman", email: "ava.rahman@example.test" },
  { id: "syn_customer_012", name: "Noah Okafor", email: "noah.okafor@example.test" },
  { id: "syn_customer_021", name: "Mia Silva", email: "mia.silva@example.test" },
];
const TOTALS = [4250, 2799, 12999, 1899, 6350];

type StepKey = "received" | "verified" | "queued" | "crm" | "sheet" | "done";
type StepState = "idle" | "active" | "done" | "retry" | "skipped";
const STEPS: { key: StepKey; label: string; detail: string }[] = [
  { key: "received", label: "Order event received", detail: "POST /api/webhooks/mock-store" },
  { key: "verified", label: "Webhook verified", detail: "HMAC-SHA256 over timestamp.body" },
  { key: "queued", label: "Workflow run queued", detail: "Event + run persisted, then 202" },
  { key: "crm", label: "Customer synced to Mock CRM", detail: "Upsert by customer ID" },
  { key: "sheet", label: "Order appended to Mock Sheet", detail: "One row per order" },
  { key: "done", label: "Execution logged", detail: "Run and every attempt recorded" },
];

interface DemoEvent {
  eventId: string;
  orderId: string;
  customer: (typeof CUSTOMERS)[number];
  totalMinor: number;
  signature: string;
}
interface LogLine {
  id: number;
  time: string;
  level: "info" | "warn" | "success";
  text: string;
}

const money = (minor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(minor / 100);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function hmacHex(secret: string, message: string) {
  if (!globalThis.crypto?.subtle) return null;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

function StepIcon({ state }: { state: StepState }) {
  if (state === "done") return <CheckCircle2 className="size-4 text-success" aria-hidden />;
  if (state === "active") return <Loader2 className="size-4 animate-spin text-info motion-reduce:animate-none" aria-hidden />;
  if (state === "retry") return <RotateCw className="size-4 text-warning" aria-hidden />;
  if (state === "skipped") return <MinusCircle className="size-4 text-muted-foreground" aria-hidden />;
  return <Circle className="size-4 text-muted-foreground/50" aria-hidden />;
}

export function InteractiveDemo() {
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(() => Object.fromEntries(STEPS.map((s) => [s.key, "idle"])) as Record<StepKey, StepState>);
  const [busy, setBusy] = useState(false);
  const [outage, setOutage] = useState(false);
  const [last, setLast] = useState<DemoEvent | null>(null);
  const [crm, setCrm] = useState<Record<string, { name: string; email: string; lastOrder: string; orders: number }>>({});
  const [rows, setRows] = useState<{ orderId: string; email: string; total: number }[]>([]);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const seen = useRef(new Set<string>());
  const counter = useRef(0);
  const logId = useRef(0);

  const log = (level: LogLine["level"], text: string) =>
    setLogs((current) => [
      { id: ++logId.current, time: new Date().toLocaleTimeString("en-US", { hour12: false }), level, text },
      ...current,
    ].slice(0, 30));
  const mark = (key: StepKey, state: StepState) => setSteps((current) => ({ ...current, [key]: state }));
  const resetSteps = () => setSteps(Object.fromEntries(STEPS.map((s) => [s.key, "idle"])) as Record<StepKey, StepState>);

  async function run(resend: boolean) {
    if (busy) return;
    setBusy(true);
    resetSteps();
    try {
      let event = last;
      if (!resend || !event) {
        counter.current += 1;
        const n = String(1040 + counter.current).padStart(4, "0");
        const customer = CUSTOMERS[counter.current % CUSTOMERS.length];
        const totalMinor = TOTALS[counter.current % TOTALS.length];
        const timestamp = Math.floor(Date.now() / 1000);
        const body = JSON.stringify({ eventId: `demo_evt_${n}`, type: "order.created", data: { order: { id: `demo_order_${n}`, totalMinor, currency: "USD" }, customer } });
        const signature = (await hmacHex(DEMO_SECRET, `${timestamp}.${body}`)) ?? "unavailable-in-this-browser";
        event = { eventId: `demo_evt_${n}`, orderId: `demo_order_${n}`, customer, totalMinor, signature };
        setLast(event);
      }

      mark("received", "active");
      log("info", `POST /api/webhooks/mock-store ← order.created ${event.eventId}${resend ? " (re-sent)" : ""}`);
      await sleep(550);
      mark("received", "done");

      mark("verified", "active");
      await sleep(550);
      mark("verified", "done");
      log("success", `Signature verified · X-Fleqo-Signature ${event.signature.slice(0, 12)}…`);

      if (seen.current.has(event.eventId)) {
        for (const key of ["queued", "crm", "sheet", "done"] as const) mark(key, "skipped");
        log("info", `Duplicate ${event.eventId} acknowledged (200) · no new run, no new records`);
        return;
      }
      seen.current.add(event.eventId);

      mark("queued", "active");
      await sleep(500);
      mark("queued", "done");
      log("info", `202 Accepted · event, run and outbox row committed`);

      mark("crm", "active");
      await sleep(650);
      if (outage) {
        mark("crm", "retry");
        log("warn", `Mock CRM upsert failed (simulated temporary outage) · retrying with backoff`);
        await sleep(1100);
        mark("crm", "active");
        await sleep(450);
      }
      const existing = crm[event.customer.id];
      setCrm((current) => ({
        ...current,
        [event.customer.id]: {
          name: event.customer.name,
          email: event.customer.email,
          lastOrder: event.orderId,
          orders: (current[event.customer.id]?.orders ?? 0) + 1,
        },
      }));
      mark("crm", "done");
      log("success", `Mock CRM: customer ${existing ? "updated" : "created"} (${event.customer.email})${outage ? " on attempt 2" : ""}`);

      mark("sheet", "active");
      await sleep(600);
      setRows((current) => [{ orderId: event.orderId, email: event.customer.email, total: event.totalMinor }, ...current].slice(0, 5));
      mark("sheet", "done");
      log("success", `Mock Sheet: row appended for ${event.orderId}${outage ? " · completed CRM action not repeated" : ""}`);

      mark("done", "done");
      log("success", `Run succeeded · 2/2 actions`);
    } finally {
      setBusy(false);
    }
  }

  const customers = Object.values(crm);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1fr)_minmax(0,1.1fr)]" data-testid="interactive-demo">
      {/* Controls + event */}
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm">
        <div>
          <h3 className="font-semibold">Sample order event</h3>
          <p className="mt-1 text-sm text-muted-foreground">Signed in your browser with a public demo secret.</p>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg border bg-muted/40 p-3 font-mono text-xs">
          <dt className="text-muted-foreground">eventId</dt>
          <dd className="truncate">{last?.eventId ?? "—"}</dd>
          <dt className="text-muted-foreground">customer</dt>
          <dd className="truncate">{last?.customer.email ?? "—"}</dd>
          <dt className="text-muted-foreground">total</dt>
          <dd>{last ? money(last.totalMinor) : "—"}</dd>
          <dt className="text-muted-foreground">signature</dt>
          <dd className="truncate" title={last?.signature}>
            {last ? `${last.signature.slice(0, 20)}…` : "—"}
          </dd>
        </dl>
        <div className="flex flex-col gap-2">
          <Button onClick={() => run(false)} disabled={busy} data-testid="demo-send">
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Send sample order
          </Button>
          <Button variant="outline" onClick={() => run(true)} disabled={busy || !last} data-testid="demo-resend">
            <CopyCheck /> Re-send the same event
          </Button>
        </div>
        <label className="flex items-start gap-3 rounded-lg border p-3 text-sm">
          <Switch checked={outage} onCheckedChange={setOutage} disabled={busy} aria-label="Simulate a temporary CRM outage" data-testid="demo-outage" />
          <span>
            <span className="block font-medium">Simulate a temporary CRM outage</span>
            <span className="block text-xs text-muted-foreground">The first CRM attempt fails; Fleqo retries with backoff.</span>
          </span>
        </label>
      </div>

      {/* Pipeline */}
      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" aria-hidden /> Pipeline
        </h3>
        <ol className="mt-4 space-y-1" aria-label="Pipeline steps">
          {STEPS.map((step) => (
            <li
              key={step.key}
              data-step={step.key}
              data-state={steps[step.key]}
              className={cn(
                "flex items-start gap-3 rounded-lg px-2 py-2 transition-colors duration-300",
                steps[step.key] === "active" && "bg-info/10",
                steps[step.key] === "retry" && "bg-warning/10",
              )}
            >
              <span className="mt-0.5">
                <StepIcon state={steps[step.key]} />
              </span>
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", steps[step.key] === "skipped" && "text-muted-foreground line-through")}>{step.label}</span>
                <span className="block text-xs text-muted-foreground">{step.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>

      {/* Destinations + log */}
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Mock CRM</h3>
              <Badge variant="secondary" data-testid="demo-crm-count">
                {customers.length} customer{customers.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <ul className="mt-3 space-y-2 text-xs">
              {customers.length === 0 && <li className="text-muted-foreground">No customers yet.</li>}
              {customers.slice(0, 3).map((c) => (
                <li key={c.email} className="rounded-md border bg-muted/40 px-2 py-1.5">
                  <span className="block font-medium">{c.name}</span>
                  <span className="block truncate text-muted-foreground">
                    {c.orders} order{c.orders === 1 ? "" : "s"} · last {c.lastOrder}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Mock Sheet</h3>
              <Badge variant="secondary" data-testid="demo-sheet-count">
                {rows.length} row{rows.length === 1 ? "" : "s"}
              </Badge>
            </div>
            <ul className="mt-3 space-y-1 font-mono text-[11px]">
              {rows.length === 0 && <li className="font-sans text-xs text-muted-foreground">No rows yet.</li>}
              {rows.map((row) => (
                <li key={row.orderId} className="flex justify-between gap-2 rounded border bg-muted/40 px-2 py-1">
                  <span className="truncate">{row.orderId}</span>
                  <span>{money(row.total)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="flex min-h-48 flex-1 flex-col rounded-2xl border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold">Execution log</h3>
          <ol tabIndex={0} aria-label="Demo execution log" className="mt-2 max-h-56 flex-1 space-y-1 overflow-y-auto font-mono text-[11px]" aria-live="polite" data-testid="demo-log">
            {logs.length === 0 && <li className="font-sans text-xs text-muted-foreground">Send a sample order to see the log.</li>}
            {logs.map((line) => (
              <li key={line.id} className="flex gap-2">
                <span className="shrink-0 text-muted-foreground">{line.time}</span>
                <span className={cn(line.level === "warn" && "text-warning", line.level === "success" && "text-success")}>{line.text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
