import { ArrowLeft, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const POINTS = [
  "Signed webhooks verified before anything is stored",
  "Retries that never repeat a completed action",
  "Every run, attempt and error in one execution log",
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-background lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <div className="flex min-h-screen flex-col px-4 py-6 sm:px-8">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            <ArrowLeft className="size-4" aria-hidden /> Back to home
          </Link>
          <ThemeToggle />
        </div>
        <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <Brand href="/" className="mb-8 text-lg" />
          {children}
        </main>
        <p className="mx-auto max-w-sm text-center text-xs text-muted-foreground">
          MVP: integrations are PostgreSQL-backed mocks and generated orders are labelled synthetic.
        </p>
      </div>

      <aside className="relative hidden overflow-hidden border-l bg-surface lg:flex lg:flex-col lg:justify-center lg:px-12" aria-hidden>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_20%,color-mix(in_oklch,var(--brand)_18%,transparent),transparent),radial-gradient(50%_40%_at_20%_90%,color-mix(in_oklch,var(--brand-2)_16%,transparent),transparent)]" />
        <div className="relative max-w-md">
          <p className="text-sm font-medium text-primary">Integration & workflow automation</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance">New orders in. Customers and rows out. Nothing lost, nothing twice.</h2>
          <div className="mt-8 rounded-2xl border bg-card/80 p-5 shadow-sm backdrop-blur">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 rounded-full bg-success-solid" /> order.created · demo_evt_0042 · signature verified
            </div>
            <div className="mt-4 grid grid-cols-3 items-center gap-2 text-center text-xs font-medium">
              <span className="rounded-lg border bg-background px-2 py-3">Mock Store</span>
              <span className="rounded-lg border border-primary/40 bg-primary/10 px-2 py-3 text-primary">Fleqo</span>
              <span className="space-y-1">
                <span className="block rounded-lg border bg-background px-2 py-1.5">CRM</span>
                <span className="block rounded-lg border bg-background px-2 py-1.5">Sheet</span>
              </span>
            </div>
          </div>
          <ul className="mt-8 space-y-3 text-sm">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> {point}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
