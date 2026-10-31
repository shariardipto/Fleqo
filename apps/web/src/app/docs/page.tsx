import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Get started with Fleqo: connect mock services, configure the Order Sync workflow, send signed order webhooks and monitor executions.",
  alternates: { canonical: "/docs" },
};

const TOC = [
  { id: "quick-start", label: "Quick start" },
  { id: "concepts", label: "Concepts" },
  { id: "webhook-api", label: "Webhook API" },
  { id: "roles", label: "Roles & permissions" },
  { id: "limits", label: "Current limits" },
];

function Code({ children }: { children: string }) {
  return (
    <pre tabIndex={0} aria-label="Code example" className="overflow-x-auto rounded-xl border bg-surface p-4 font-mono text-xs leading-relaxed">
      <code>{children}</code>
    </pre>
  );
}

export default function DocsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-6xl flex-1 gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ul className="sticky top-24 space-y-2 text-sm">
            {TOC.map((item) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="text-muted-foreground hover:text-foreground">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main id="main" className="max-w-3xl min-w-0 space-y-14 [&_h2]:scroll-mt-24 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight [&_p]:text-muted-foreground">
          <header>
            <p className="text-sm font-medium text-primary">Documentation</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">Getting started with Fleqo</h1>
            <p className="mt-4 text-lg">
              Fleqo turns a new-order event into a CRM customer and a spreadsheet row, with signed webhooks, safe retries and a full execution log.
              The current version uses PostgreSQL-backed mock services and sample data.
            </p>
          </header>

          <section className="space-y-4" aria-labelledby="quick-start">
            <h2 id="quick-start">Quick start</h2>
            <ol className="list-decimal space-y-2 pl-5 text-sm">
              <li>
                <Link href="/sign-up" className="font-medium text-primary underline-offset-4 hover:underline">
                  Create an account
                </Link>{" "}
                and an organization. You become its owner.
              </li>
              <li>
                In <strong>Connections</strong>, connect the Mock Store, Mock CRM and Mock Sheet. Copy the store&apos;s signing secret when it is shown;
                it is displayed once.
              </li>
              <li>
                In <strong>Workflows → New workflow</strong>, keep the default field mapping and create the <em>Order Sync</em> workflow.
              </li>
              <li>
                In <strong>Demo data</strong>, import sample customers and products, then <strong>Send signed events</strong>.
              </li>
              <li>
                Open <strong>Executions</strong> to see each run, its actions, attempts and logs.
              </li>
            </ol>
          </section>

          <section className="space-y-4" aria-labelledby="concepts">
            <h2 id="concepts">Concepts</h2>
            <dl className="space-y-4 text-sm">
              <div>
                <dt className="font-medium">Connection</dt>
                <dd className="text-muted-foreground">A configured mock service for your organization. The Mock Store signs webhooks; the CRM and Sheet store records.</dd>
              </div>
              <div>
                <dt className="font-medium">Workflow</dt>
                <dd className="text-muted-foreground">One trigger (<code>mock_store.order.created</code>) and ordered actions (<code>mock_crm.upsert_customer</code>, <code>mock_sheet.append_order</code>) with a field mapping.</dd>
              </div>
              <div>
                <dt className="font-medium">Event, run and action run</dt>
                <dd className="text-muted-foreground">
                  Each verified event is stored once per organization. Every active matching workflow gets one run; each action in the run has its own status and attempt count.
                </dd>
              </div>
              <div>
                <dt className="font-medium">Retries and dead letters</dt>
                <dd className="text-muted-foreground">
                  Temporary failures retry with exponential backoff. When attempts run out the run fails into the dead-letter queue, where an admin or owner can retry it.
                  Actions that already succeeded are never run again.
                </dd>
              </div>
            </dl>
          </section>

          <section className="space-y-4" aria-labelledby="webhook-api">
            <h2 id="webhook-api">Webhook API</h2>
            <p className="text-sm">
              Send <code>order.created</code> events to <code>POST /api/webhooks/mock-store</code> on your Fleqo API. Sign the exact raw body.
            </p>
            <div tabIndex={0} role="region" aria-label="Webhook headers" className="overflow-x-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <thead className="bg-muted/50 text-xs">
                  <tr>
                    <th className="px-4 py-2 font-medium">Header</th>
                    <th className="px-4 py-2 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs">X-Fleqo-Connection-Id</td>
                    <td className="px-4 py-2 text-muted-foreground">The Mock Store connection ID from the Connections page</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs">X-Fleqo-Timestamp</td>
                    <td className="px-4 py-2 text-muted-foreground">Unix time in seconds; must be within 5 minutes</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-2 font-mono text-xs">X-Fleqo-Signature</td>
                    <td className="px-4 py-2 text-muted-foreground">hex(HMAC-SHA256(secret, timestamp + &quot;.&quot; + rawBody))</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Code>{`import crypto from "node:crypto";

const body = JSON.stringify({
  eventId: "demo_evt_0001",
  type: "order.created",
  occurredAt: new Date().toISOString(),
  data: {
    order: { id: "demo_order_0001", totalMinor: 12999, currency: "USD" },
    customer: { externalId: "demo_customer_001", email: "customer@example.test", name: "Demo Customer" },
  },
});
const ts = Math.floor(Date.now() / 1000);
const signature = crypto.createHmac("sha256", process.env.FLEQO_SIGNING_SECRET).update(\`\${ts}.\${body}\`).digest("hex");

await fetch(\`\${process.env.FLEQO_API_URL}/api/webhooks/mock-store\`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-Fleqo-Connection-Id": process.env.FLEQO_CONNECTION_ID,
    "X-Fleqo-Timestamp": String(ts),
    "X-Fleqo-Signature": signature,
  },
  body,
});`}</Code>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                <code>202</code> accepted and stored; <code>200</code> duplicate event ID (no new run); <code>409</code> same event ID with a different payload.
              </li>
              <li>
                <code>401</code> unknown connection, stale timestamp or invalid signature; <code>400</code>/<code>422</code> invalid JSON or schema; <code>413</code> body over 64 KB.
              </li>
              <li>Amounts are integer minor units with an ISO 4217 currency code.</li>
            </ul>
          </section>

          <section className="space-y-4" aria-labelledby="roles">
            <h2 id="roles">Roles & permissions</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Owner</strong>: everything, including members and organization settings.
              </li>
              <li>
                <strong className="text-foreground">Admin</strong>: connections, workflows, imports, retries and invitations.
              </li>
              <li>
                <strong className="text-foreground">Member</strong>: view workflows and executions, and run the simulator.
              </li>
            </ul>
            <p className="text-sm">Teammates join through an invite link shared by an owner or admin. Permissions are enforced by the API on every request.</p>
          </section>

          <section className="space-y-4" aria-labelledby="limits">
            <h2 id="limits">Current limits</h2>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Integrations are mocks stored in Fleqo&apos;s database; real Shopify, CRM or Google Sheets connections are not available yet.</li>
              <li>One connection per mock service per organization; one trigger and two action types.</li>
              <li>Invitations are not emailed; share the invite link yourself.</li>
            </ul>
          </section>
        </main>
      </div>
      <SiteFooter />
    </div>
  );
}
