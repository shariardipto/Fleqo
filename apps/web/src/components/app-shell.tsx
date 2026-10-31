"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Building2,
  Cable,
  Check,
  ChevronsUpDown,
  Database,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Settings,
  Users,
  Workflow,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Brand } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/theme-toggle";
import { useMe } from "@/hooks/use-me";
import { api, ApiError, errorMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import type { Me } from "@/lib/types";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/connections", label: "Connections", icon: Cable },
  { href: "/workflows", label: "Workflows", icon: Workflow },
  { href: "/executions", label: "Executions", icon: Activity },
  { href: "/demo", label: "Demo data", icon: Database },
  { href: "/team", label: "Team", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground" : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function OrgSwitcher({ me }: { me: Me }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const switchOrg = useMutation({
    mutationFn: (organizationId: string) => api("/organizations/active", { method: "POST", body: { organizationId } }),
    onSuccess: async () => {
      queryClient.clear();
      router.push("/dashboard");
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const active = me.activeOrganization!;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-auto w-full justify-between px-3 py-2" data-testid="org-switcher">
          {/* Accessible name = this prefix + the visible text, so voice-control users can say what they see. */}
          <span className="sr-only">Switch organization: </span>
          <span className="flex min-w-0 items-center gap-2">
            <Building2 className="size-4 shrink-0" aria-hidden />
            <span className="min-w-0 text-left">
              <span className="block truncate text-sm font-medium">{active.name}</span>
              <span className="block text-xs capitalize text-muted-foreground">{active.role}</span>
            </span>
          </span>
          <ChevronsUpDown className="size-4 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60" align="start">
        <DropdownMenuLabel>Organizations</DropdownMenuLabel>
        {me.organizations.map((org) => (
          <DropdownMenuItem key={org.id} onSelect={() => org.id !== active.id && switchOrg.mutate(org.id)}>
            <span className="flex-1 truncate">{org.name}</span>
            {org.id === active.id && <Check className="size-4" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding">
            <Plus className="size-4" /> New organization
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ me }: { me: Me }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  async function signOut() {
    await authClient.signOut();
    queryClient.clear();
    router.replace("/sign-in");
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-auto w-full justify-start gap-2 px-3 py-2">
          <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">
            {me.user.name.slice(0, 2)}
          </span>
          <span className="min-w-0 text-left">
            <span className="block truncate text-sm">{me.user.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{me.user.email}</span>
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="start">
        <DropdownMenuItem onSelect={signOut}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarContent({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <Brand />
      <OrgSwitcher me={me} />
      <NavLinks onNavigate={onNavigate} />
      <div className="mt-auto space-y-2">
        <Badge variant="outline" className="w-full justify-center text-[11px] font-normal text-muted-foreground">
          Mock integrations · synthetic data
        </Badge>
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <UserMenu me={me} />
          </div>
          <ThemeToggle />
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const me = useMe();
  const [mobileOpen, setMobileOpen] = useState(false);

  const needsOrg = me.data && !me.data.activeOrganization;
  useEffect(() => {
    if (me.error instanceof ApiError && me.error.status === 401) {
      router.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
    } else if (needsOrg) {
      const first = me.data!.organizations[0];
      if (!first) {
        router.replace("/onboarding");
      } else {
        // Session lost its active org (e.g. after a refused switch): fall back to the first membership.
        api("/organizations/active", { method: "POST", body: { organizationId: first.id } }).then(() =>
          queryClient.invalidateQueries(),
        );
      }
    }
  }, [me.error, me.data, needsOrg, pathname, router, queryClient]);

  if (!me.data?.activeOrganization) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6" role="status" aria-label="Loading workspace">
        {me.error && !(me.error instanceof ApiError && me.error.status === 401) ? (
          <p className="text-sm text-destructive">{errorMessage(me.error)}</p>
        ) : (
          <div className="w-full max-w-md space-y-3">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r bg-sidebar text-sidebar-foreground lg:block">
        <SidebarContent me={me.data} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Open navigation">
                <Menu />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0">
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <SidebarContent me={me.data} onNavigate={() => setMobileOpen(false)} />
            </SheetContent>
          </Sheet>
          <Brand />
          <ThemeToggle className="ml-auto" />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
