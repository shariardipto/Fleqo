"use client";

import Image from "next/image";
import { useId, useState } from "react";
import { cn } from "@/lib/utils";

const SCREENS = [
  { key: "dashboard", label: "Dashboard", path: "/dashboard", alt: "Fleqo dashboard with workflow, run and destination counts and recent runs" },
  { key: "connections", label: "Connections", path: "/connections", alt: "Fleqo connections page with the Mock Store, CRM and Sheet enabled and destination records" },
  { key: "workflows", label: "Workflows", path: "/workflows/new", alt: "Fleqo guided workflow builder with trigger, actions and field mapping" },
  { key: "executions", label: "Execution logs", path: "/executions/…", alt: "Fleqo execution detail with per-action status, attempts and the execution log" },
] as const;

/** Real screenshots of the Fleqo app (synthetic demo data), in both themes. */
export function ProductPreview() {
  const [active, setActive] = useState(0);
  const baseId = useId();
  const screen = SCREENS[active];

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (active + delta + SCREENS.length) % SCREENS.length;
    setActive(next);
    document.getElementById(`${baseId}-tab-${next}`)?.focus();
  }

  return (
    <div>
      <div role="tablist" aria-label="Product screens" className="mx-auto flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border bg-card p-1" onKeyDown={onKeyDown}>
        {SCREENS.map((item, index) => (
          <button
            key={item.key}
            id={`${baseId}-tab-${index}`}
            role="tab"
            type="button"
            aria-selected={index === active}
            aria-controls={`${baseId}-panel`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className={cn(
              "shrink-0 rounded-lg px-3 py-1.5 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring",
              index === active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${active}`} className="mt-6">
        <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/5">
          <div className="flex items-center gap-2 border-b bg-muted/50 px-4 py-2.5">
            <span className="flex gap-1.5" aria-hidden>
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
              <span className="size-2.5 rounded-full bg-border" />
            </span>
            <span className="mx-auto truncate rounded-md border bg-background px-3 py-0.5 font-mono text-[11px] text-muted-foreground">fleqo · {screen.path}</span>
          </div>
          <div className="relative aspect-[16/10] bg-muted">
            <Image
              key={`${screen.key}-light`}
              src={`/screens/${screen.key}-light.png`}
              alt={screen.alt}
              fill
              sizes="(min-width: 1152px) 1100px, 100vw"
              className="object-cover object-top dark:hidden"
            />
            <Image
              key={`${screen.key}-dark`}
              src={`/screens/${screen.key}-dark.png`}
              alt={screen.alt}
              fill
              sizes="(min-width: 1152px) 1100px, 100vw"
              className="hidden object-cover object-top dark:block"
            />
          </div>
        </div>
        <p className="mt-3 text-center text-xs text-muted-foreground">Real screens from the Fleqo app running with synthetic demo data.</p>
      </div>
    </div>
  );
}
