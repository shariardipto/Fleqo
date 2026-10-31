"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { useSignedIn } from "./session";

export const SITE_NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#integrations", label: "Integrations" },
  { href: "/#demo", label: "Demo" },
  { href: "/docs", label: "Docs" },
];

function AuthButtons({ stacked = false, onNavigate }: { stacked?: boolean; onNavigate?: () => void }) {
  const { signedIn } = useSignedIn();
  if (signedIn) {
    return (
      <Button asChild size={stacked ? "lg" : "default"} className={cn(stacked && "w-full")}>
        <Link href="/dashboard" onClick={onNavigate} data-testid="nav-dashboard">
          Go to Dashboard
        </Link>
      </Button>
    );
  }
  return (
    <div className={cn("flex items-center gap-2", stacked && "flex-col items-stretch")}>
      <Button asChild variant="ghost" size={stacked ? "lg" : "default"}>
        <Link href="/sign-in" onClick={onNavigate} data-testid="nav-sign-in">
          Sign in
        </Link>
      </Button>
      <Button asChild size={stacked ? "lg" : "default"}>
        <Link href="/sign-up" onClick={onNavigate} data-testid="nav-get-started">
          Get started
        </Link>
      </Button>
    </div>
  );
}

export function SiteHeader() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 w-full border-b transition-[background-color,border-color,box-shadow] duration-300",
        scrolled ? "border-border bg-background/80 shadow-sm backdrop-blur-lg" : "border-transparent bg-transparent",
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Brand href="/" className="text-base" />
        <nav aria-label="Primary" className="hidden flex-1 items-center gap-1 md:flex">
          {SITE_NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-1 md:flex">
          <ThemeToggle />
          <AuthButtons />
        </div>
        <div className="ml-auto flex items-center gap-1 md:hidden">
          <ThemeToggle />
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open menu">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 p-6">
              <SheetTitle className="text-left">Menu</SheetTitle>
              <SheetDescription className="sr-only">Site navigation</SheetDescription>
              <nav aria-label="Mobile" className="mt-4 flex flex-col">
                {SITE_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="rounded-md px-2 py-3 text-base text-foreground/90 hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-6">
                <AuthButtons stacked onNavigate={() => setOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
