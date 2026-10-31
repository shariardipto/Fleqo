"use client";

import { Activity, ArrowLeft, Cable, CheckCircle2, Send, Workflow } from "lucide-react";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

const STEPS = [
  {
    key: "connect",
    title: "Connect your services",
    body: "Enable the Mock Store, Mock CRM and Mock Sheet for your organization. The store gets a signing secret that is shown once and stored encrypted.",
    icon: Cable,
  },
  {
    key: "configure",
    title: "Configure your workflow",
    body: "Pick the order.created trigger and the CRM and Sheet actions, then map event fields to destination fields. Types are checked before you can save.",
    icon: Workflow,
  },
  {
    key: "trigger",
    title: "Trigger an automation",
    body: "Send a signed order.created webhook, or use the built-in simulator. Fleqo verifies the signature and stores the event before replying.",
    icon: Send,
  },
  {
    key: "monitor",
    title: "Monitor the execution",
    body: "Watch each run with per-action status, attempts, inputs, outputs and errors. Failed runs can be retried; completed actions are skipped.",
    icon: Activity,
  },
] as const;

function Illustration({ step }: { step: (typeof STEPS)[number]["key"] }) {
  if (step === "connect") {
    return (
      <div className="grid gap-2 sm:grid-cols-3">
        {["Mock Store", "Mock CRM", "Mock Sheet"].map((name) => (
          <div key={name} className="rounded-lg border bg-background p-3 text-sm">
            <p className="font-medium">{name}</p>
            <p className="mt-2 inline-flex items-center gap-1 rounded-full border border-success/35 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
              <CheckCircle2 className="size-3" aria-hidden /> Active
            </p>
          </div>
        ))}
      </div>
    );
  }
  if (step === "configure") {
    const rows = [
      ["Customer ID", "data.customer.externalId"],
      ["Email", "data.customer.email"],
      ["Total (minor units)", "data.order.totalMinor"],
      ["Currency", "data.order.currency"],
    ];
    return (
      <div className="space-y-2 rounded-lg border bg-background p-3 text-sm">
        {rows.map(([target, source]) => (
          <div key={target} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <span className="font-medium">{target}</span>
            <ArrowLeft className="size-3.5 text-muted-foreground" aria-hidden />
            <code className="truncate rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{source}</code>
          </div>
        ))}
      </div>
    );
  }
  if (step === "trigger") {
    return (
      <pre tabIndex={0} aria-label="Signed webhook request" className="overflow-x-auto rounded-lg border bg-background p-3 font-mono text-xs leading-relaxed">
        <code>{`POST /api/webhooks/mock-store
X-Fleqo-Connection-Id: conn_…
X-Fleqo-Timestamp: 1793462400
X-Fleqo-Signature: hmac_sha256(secret, ts + "." + body)

{ "eventId": "demo_evt_0001", "type": "order.created", … }
→ 202 Accepted (duplicates → 200, bad signature → 401)`}</code>
      </pre>
    );
  }
  return (
    <ul className="space-y-1.5 rounded-lg border bg-background p-3 font-mono text-xs">
      <li className="text-muted-foreground">Worker started delivery 1/4</li>
      <li className="text-warning">mock_crm.upsert_customer failed (transient) · retrying</li>
      <li className="text-success">mock_crm.upsert_customer succeeded (created)</li>
      <li className="text-success">mock_sheet.append_order succeeded (appended)</li>
      <li className="text-success">Run succeeded</li>
    </ul>
  );
}

export function HowItWorks() {
  const [active, setActive] = useState(0);
  const baseId = useId();

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (active + delta + STEPS.length) % STEPS.length;
    setActive(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  const current = STEPS[active];
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
      <div role="tablist" aria-label="How Fleqo works" aria-orientation="vertical" className="space-y-2" onKeyDown={onKeyDown}>
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          const selected = index === active;
          return (
            <button
              key={step.key}
              id={`${baseId}-tab-${index}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${baseId}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(index)}
              className={cn(
                "flex w-full items-start gap-4 rounded-xl border p-4 text-left transition-all duration-200 outline-none focus-visible:ring-3 focus-visible:ring-ring",
                selected ? "border-primary/40 bg-card shadow-sm" : "border-transparent hover:border-border hover:bg-card/60",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg border text-sm font-semibold transition-colors",
                  selected ? "border-primary/40 bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}
              >
                {index + 1}
              </span>
              <span>
                <span className="flex items-center gap-2 font-medium">
                  <Icon className="size-4 text-primary" aria-hidden /> {step.title}
                </span>
                <span className={cn("mt-1 block text-sm text-muted-foreground", !selected && "line-clamp-1")}>{step.body}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div
        id={`${baseId}-panel`}
        role="tabpanel"
        aria-labelledby={`${baseId}-tab-${active}`}
        className="relative overflow-hidden rounded-2xl border bg-surface p-5 sm:p-6"
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_60%_at_100%_0%,color-mix(in_oklch,var(--brand)_12%,transparent),transparent)]" />
        <div key={current.key} className="relative animate-in fade-in-0 slide-in-from-bottom-1 duration-300 motion-reduce:animate-none">
          <p className="text-xs font-medium tracking-wide text-primary uppercase">Step {active + 1}</p>
          <h3 className="mt-1 text-lg font-semibold">{current.title}</h3>
          <div className="mt-4">
            <Illustration step={current.key} />
          </div>
        </div>
      </div>
    </div>
  );
}
