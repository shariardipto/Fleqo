"use client";

import { CheckCircle2, Loader2, ShieldCheck, ShoppingBag, Sheet, Users, Workflow } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type NodeState = "waiting" | "active" | "done";

const NODES = [
  { id: "store", title: "New order", subtitle: "order.created", icon: ShoppingBag },
  { id: "webhook", title: "Webhook verified", subtitle: "HMAC-SHA256", icon: ShieldCheck },
  { id: "engine", title: "Fleqo engine", subtitle: "Order Sync workflow", icon: Workflow },
] as const;
const OUTPUTS = [
  { id: "crm", title: "CRM updated", subtitle: "Customer upserted", icon: Users },
  { id: "sheet", title: "Sheet synced", subtitle: "Order row appended", icon: Sheet },
] as const;

// Animation timeline: one step lights up per tick, outputs complete together, then a pause and replay.
const STEPS = 6;
const stateAt = (step: number, index: number): NodeState => (step > index ? "done" : step === index ? "active" : "waiting");

function StatusPill({ state }: { state: NodeState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors duration-300",
        state === "done" && "border-success/35 bg-success/10 text-success",
        state === "active" && "border-info/35 bg-info/10 text-info",
        state === "waiting" && "border-border text-muted-foreground",
      )}
    >
      {state === "done" ? <CheckCircle2 className="size-3" aria-hidden /> : state === "active" ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
      {state === "done" ? "Done" : state === "active" ? "Running" : "Waiting"}
    </span>
  );
}

function Node({
  title,
  subtitle,
  icon: Icon,
  state,
  highlight,
}: {
  title: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
  state: NodeState;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex min-w-0 items-start gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-[border-color,box-shadow] duration-300",
        state === "active" && "border-primary/50 shadow-md",
        highlight && "border-primary/40 bg-gradient-to-br from-primary/10 to-transparent",
      )}
    >
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-foreground",
          state === "active" && "animate-pulse-ring border-primary/40 text-primary",
          state === "done" && "text-success",
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
        <span className="mt-1.5 block">
          <StatusPill state={state} />
        </span>
      </span>
    </div>
  );
}

function Connector({ active }: { active: boolean }) {
  return (
    <div className="flex h-6 justify-center lg:h-auto lg:w-10 lg:items-center" aria-hidden>
      <svg className="h-full w-2 lg:h-2 lg:w-full" preserveAspectRatio="none">
        <line x1="50%" y1="0" x2="50%" y2="100%" className={cn("stroke-border lg:hidden", active && "animate-flow-dash stroke-primary")} strokeWidth="2" />
        <line x1="0" y1="50%" x2="100%" y2="50%" className={cn("hidden stroke-border lg:inline", active && "animate-flow-dash stroke-primary")} strokeWidth="2" />
      </svg>
    </div>
  );
}

export function HeroVisual() {
  const [step, setStep] = useState(STEPS);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let current = 0;
    const timer = window.setInterval(() => {
      current = current >= STEPS + 2 ? 0 : current + 1;
      setStep(Math.min(current, STEPS));
    }, 1100);
    return () => window.clearInterval(timer);
  }, []);

  const outputsState: NodeState = step >= 4 ? "done" : step === 3 ? "active" : "waiting";

  return (
    <figure className="relative mx-auto w-full max-w-5xl" aria-label="Illustration: how Fleqo processes a new order">
      <div className="pointer-events-none absolute -inset-x-8 -inset-y-10 -z-10 bg-[radial-gradient(50%_60%_at_50%_40%,color-mix(in_oklch,var(--brand)_16%,transparent),transparent)]" />
      <div className="rounded-2xl border bg-card/70 p-3 shadow-xl backdrop-blur-sm sm:p-4">
        <div className="mb-3 flex items-center gap-2 border-b pb-3 text-xs text-muted-foreground">
          <span className="flex gap-1" aria-hidden>
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
            <span className="size-2.5 rounded-full bg-border" />
          </span>
          <span className="truncate font-mono">execution · demo_evt_1042</span>
          <span className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide">Illustration</span>
        </div>
        <div className="flex flex-col lg:flex-row lg:items-center">
          {NODES.map((node, index) => (
            <div key={node.id} className="contents">
              <div className="lg:w-[23%]">
                <Node {...node} state={stateAt(step, index)} highlight={node.id === "engine"} />
              </div>
              <Connector active={step === index + 1} />
            </div>
          ))}
          <div className="grid gap-2 lg:flex-1">
            {OUTPUTS.map((node) => (
              <Node key={node.id} {...node} state={outputsState} />
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 font-mono text-[11px] text-muted-foreground">
          <span>202 accepted · persisted before acknowledging</span>
          <span aria-live="off">{step >= 4 ? "run succeeded · 2/2 actions · 1 attempt each" : "run in progress…"}</span>
        </div>
      </div>
    </figure>
  );
}
