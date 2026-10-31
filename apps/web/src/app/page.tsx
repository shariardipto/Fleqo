import {
  Activity,
  ArrowRight,
  Building2,
  CopyCheck,
  Database,
  FileSearch,
  Fingerprint,
  KeyRound,
  Layers,
  Lock,
  RefreshCcw,
  RotateCw,
  ShieldCheck,
  ShoppingBag,
  Sheet,
  Users,
  Webhook,
  Workflow,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HeroVisual } from "@/components/landing/hero-visual";
import { HowItWorks } from "@/components/landing/how-it-works";
import { InteractiveDemo } from "@/components/landing/interactive-demo";
import { ProductPreview } from "@/components/landing/product-preview";
import { Reveal } from "@/components/landing/reveal";
import { PrimaryCta } from "@/components/landing/session";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "Fleqo — Integration & Workflow Automation" },
  description:
    "Connect your tools and automate repetitive business processes. Fleqo verifies signed webhooks, syncs customers and orders, retries safely and logs every execution.",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    title: "Fleqo — Connect your workflows. Automate your business.",
    description: "Signed webhooks, safe retries and execution monitoring for order-sync automation.",
  },
};

const FEATURES = [
  { icon: Workflow, title: "Workflow automation", body: "A guided builder for the order.created → CRM upsert → Sheet append workflow, with enable, disable and archive." },
  { icon: Webhook, title: "API & webhook integrations", body: "A documented, signed webhook endpoint for order events, plus a JSON API behind the app." },
  { icon: ShieldCheck, title: "Secure event processing", body: "HMAC-SHA256 over the raw body, a 5-minute replay window and schema validation before anything is stored." },
  { icon: RotateCw, title: "Automated retries", body: "Temporary failures retry with exponential backoff; exhausted runs land in a dead-letter queue for manual retry." },
  { icon: Activity, title: "Execution monitoring", body: "Every run with per-action status, attempts, inputs, outputs, errors and a timestamped log." },
  { icon: Users, title: "Organization & team management", body: "Organizations with Owner, Admin and Member roles, invite links and an audit log of changes." },
  { icon: RefreshCcw, title: "Data synchronization", body: "Customers are upserted into the mock CRM and orders appended to the mock Sheet, with type-checked field mapping." },
  { icon: CopyCheck, title: "Duplicate event prevention", body: "Re-sent events are acknowledged without a new run, and destination writes are unique per order." },
];

const INTEGRATIONS = [
  { icon: ShoppingBag, name: "Mock Store", body: "Sends signed order.created webhooks. Use the built-in simulator or sign requests yourself." },
  { icon: Users, name: "Mock CRM", body: "Customer records stored in Fleqo's PostgreSQL database, upserted by customer ID." },
  { icon: Sheet, name: "Mock Sheet", body: "Order rows stored in PostgreSQL; one row per order, never appended twice." },
  { icon: Database, name: "Public demo data", body: "Import sample customers, products and carts from DummyJSON, or generate synthetic data offline." },
];

const ROADMAP = ["Shopify", "WooCommerce", "Google Sheets", "HubSpot"];

const SECURITY = [
  { icon: Fingerprint, title: "Signed webhooks", body: "Each delivery is verified with a constant-time HMAC check and a timestamp window before it is accepted." },
  { icon: KeyRound, title: "Authentication & permissions", body: "Sessions are stored server-side, and Owner, Admin and Member permissions are enforced by the API on every request." },
  { icon: Lock, title: "Data isolation", body: "Every record belongs to an organization and is only ever queried within that organization." },
  { icon: Layers, title: "Idempotent processing", body: "Database constraints on events, runs, actions and destination records make retries and duplicates harmless." },
  { icon: RefreshCcw, title: "Retry & recovery", body: "A transactional outbox keeps accepted events safe through queue outages; stalled runs are re-dispatched." },
  { icon: FileSearch, title: "Execution auditing", body: "Execution logs per attempt plus an audit trail of configuration and membership changes." },
];

function SectionHeading({ eyebrow, title, body, id }: { eyebrow: string; title: string; body?: string; id: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-sm font-medium text-primary">{eyebrow}</p>
      <h2 id={id} className="mt-2 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
        {title}
      </h2>
      {body && <p className="mt-4 text-muted-foreground text-pretty">{body}</p>}
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <a href="#main" className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3">
        Skip to content
      </a>
      <SiteHeader />

      <main id="main" className="flex-1 overflow-x-clip">
        {/* Hero */}
        <section aria-labelledby="hero-title" className="relative">
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[radial-gradient(70%_60%_at_50%_0%,color-mix(in_oklch,var(--brand)_14%,transparent),transparent)]" />
          <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(60%_50%_at_50%_0%,black,transparent)] bg-[size:48px_48px] opacity-40" />
          <div className="mx-auto max-w-6xl px-4 pt-16 pb-16 text-center sm:px-6 sm:pt-24">
            <Badge variant="outline" className="mx-auto gap-1.5 rounded-full px-3 py-1 text-xs font-normal">
              <span className="size-1.5 rounded-full bg-success-solid" aria-hidden /> Order sync with signed webhooks, safe retries and full logs
            </Badge>
            <h1 id="hero-title" className="mx-auto mt-6 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl">
              Connect Your Workflows.{" "}
              <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">Automate Your Business.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground text-pretty">
              Automate repetitive business processes, connect your tools, and monitor every workflow from one powerful platform.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <PrimaryCta />
              <Button asChild size="lg" variant="outline">
                <Link href="#demo" data-testid="explore-demo">
                  Explore Demo
                </Link>
              </Button>
            </div>
            <div className="mt-14 sm:mt-16">
              <HeroVisual />
            </div>
          </div>
        </section>

        {/* Interactive demo */}
        <section id="demo" aria-labelledby="demo-title" className="scroll-mt-20 border-t bg-surface py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading
                id="demo-title"
                eyebrow="Interactive demo"
                title="See what happens when an order arrives"
                body="Send a sample order through Fleqo's pipeline. This product demonstration runs entirely in your browser with sample data: no account, no server, no real records."
              />
            </Reveal>
            <Reveal className="mt-10">
              <InteractiveDemo />
            </Reveal>
          </div>
        </section>

        {/* Features */}
        <section id="features" aria-labelledby="features-title" className="scroll-mt-20 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading id="features-title" eyebrow="Features" title="Everything an order needs to reach your tools, exactly once" />
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {FEATURES.map((feature) => (
                <Reveal key={feature.title}>
                  <article className="group h-full rounded-2xl border bg-card p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 motion-reduce:transform-none">
                    <span className="flex size-10 items-center justify-center rounded-xl border bg-primary/10 text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      <feature.icon className="size-5" aria-hidden />
                    </span>
                    <h3 className="mt-4 font-semibold">{feature.title}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{feature.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" aria-labelledby="how-title" className="scroll-mt-20 border-t bg-surface py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading id="how-title" eyebrow="How Fleqo works" title="From connection to monitored run in four steps" />
            </Reveal>
            <Reveal className="mt-12">
              <HowItWorks />
            </Reveal>
          </div>
        </section>

        {/* Integrations */}
        <section id="integrations" aria-labelledby="integrations-title" className="scroll-mt-20 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading
                id="integrations-title"
                eyebrow="Integrations"
                title="Start with safe mock integrations"
                body="The current version ships PostgreSQL-backed mock destinations and public or synthetic demo data, so you can run the whole pipeline without touching a real store, CRM or spreadsheet."
              />
            </Reveal>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {INTEGRATIONS.map((integration) => (
                <Reveal key={integration.name}>
                  <article className="h-full rounded-2xl border bg-card p-5">
                    <div className="flex items-center justify-between">
                      <span className="flex size-10 items-center justify-center rounded-xl border bg-muted">
                        <integration.icon className="size-5" aria-hidden />
                      </span>
                      <Badge variant="outline" className="border-success/35 bg-success/10 text-success">
                        Available
                      </Badge>
                    </div>
                    <h3 className="mt-4 font-semibold">{integration.name}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">{integration.body}</p>
                  </article>
                </Reveal>
              ))}
            </div>
            <Reveal className="mt-6">
              <div className="flex flex-col gap-3 rounded-2xl border border-dashed p-5 sm:flex-row sm:items-center">
                <div className="sm:w-56">
                  <p className="font-medium">On the roadmap</p>
                  <p className="text-xs text-muted-foreground">Planned, not available yet.</p>
                </div>
                <ul className="flex flex-wrap gap-2" aria-label="Planned integrations (not available yet)">
                  {ROADMAP.map((name) => (
                    <li key={name} className="rounded-full border bg-muted/50 px-3 py-1 text-sm text-muted-foreground">
                      {name}
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Product preview */}
        <section id="product" aria-labelledby="product-title" className="scroll-mt-20 border-t bg-surface py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading id="product-title" eyebrow="Product" title="Built for operators who need to know what happened" />
            </Reveal>
            <Reveal className="mt-10">
              <ProductPreview />
            </Reveal>
          </div>
        </section>

        {/* Security & reliability */}
        <section id="security" aria-labelledby="security-title" className="scroll-mt-20 py-20 sm:py-24">
          <div className="mx-auto max-w-6xl px-4 sm:px-6">
            <Reveal>
              <SectionHeading
                id="security-title"
                eyebrow="Security & reliability"
                title="Designed so events are never lost and never applied twice"
                body="These are implemented and covered by automated tests. Fleqo does not claim any external certification."
              />
            </Reveal>
            <div className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {SECURITY.map((item) => (
                <Reveal key={item.title}>
                  <div className="flex gap-4">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-card text-primary">
                      <item.icon className="size-5" aria-hidden />
                    </span>
                    <div>
                      <h3 className="font-semibold">{item.title}</h3>
                      <p className="mt-1.5 text-sm text-muted-foreground">{item.body}</p>
                    </div>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section aria-labelledby="cta-title" className="px-4 pb-20 sm:px-6 sm:pb-24">
          <Reveal>
            <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border bg-card px-6 py-16 text-center sm:px-12">
              <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_0%,color-mix(in_oklch,var(--brand)_18%,transparent),transparent),radial-gradient(40%_60%_at_100%_100%,color-mix(in_oklch,var(--brand-2)_14%,transparent),transparent)]" />
              <div className="relative">
                <Building2 className="mx-auto size-8 text-primary" aria-hidden />
                <h2 id="cta-title" className="mt-4 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                  Ready to simplify your workflows?
                </h2>
                <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                  Create a free account, connect the mock services and watch your first order sync in a few minutes.
                </p>
                <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                  <PrimaryCta label="Create an Account" />
                  <Button asChild size="lg" variant="outline">
                    <Link href="#features">
                      Explore Fleqo <ArrowRight aria-hidden />
                    </Link>
                  </Button>
                </div>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
