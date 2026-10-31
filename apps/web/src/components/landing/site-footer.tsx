import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { BrandMark } from "@/components/brand";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#how-it-works", label: "How It Works" },
      { href: "/#integrations", label: "Integrations" },
      { href: "/#demo", label: "Interactive demo" },
    ],
  },
  {
    title: "Resources",
    links: [
      { href: "/docs", label: "Documentation" },
      { href: "/docs#webhook-api", label: "Webhook API" },
      { href: "/#security", label: "Security & reliability" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/sign-in", label: "Sign in" },
      { href: "/sign-up", label: "Create an account" },
      { href: "/dashboard", label: "Dashboard" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 font-semibold tracking-tight" aria-label="Fleqo home">
            <BrandMark /> Fleqo
          </Link>
          <p className="mt-3 max-w-xs text-sm text-muted-foreground">
            Integration and workflow automation with signed webhooks, safe retries and a full execution log.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-sm font-semibold">{column.title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-muted-foreground transition-colors hover:text-foreground">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} Fleqo. All rights reserved.</p>
          <p>
            Powered by{" "}
            <a
              href="https://www.thecodeworkstudio.com"
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-0.5 font-semibold text-foreground decoration-primary/40 underline-offset-4 transition-colors duration-300 hover:text-primary hover:underline"
            >
              The Code Work Studio
              <ArrowUpRight
                className="size-3 transition-transform duration-300 group-hover:-translate-y-px group-hover:translate-x-px motion-reduce:transition-none"
                aria-hidden
              />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
