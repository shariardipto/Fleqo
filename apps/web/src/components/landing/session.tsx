"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

/**
 * Session state for public pages. Uses Better Auth's get-session endpoint, which answers 200 with
 * `null` for visitors, so the public site never triggers 401 errors in the console.
 */
export function useSignedIn() {
  const { data, isPending } = authClient.useSession();
  return { signedIn: Boolean(data?.user), isPending };
}

/** Primary call to action: sign-up for visitors, the dashboard for signed-in users. */
export function PrimaryCta({ label = "Get Started Free", size = "lg" }: { label?: string; size?: "default" | "lg" }) {
  const { signedIn } = useSignedIn();
  return (
    <Button asChild size={size} className="group">
      <Link href={signedIn ? "/dashboard" : "/sign-up"} data-testid="primary-cta">
        {signedIn ? "Go to Dashboard" : label}
        <ArrowRight className="transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </Button>
  );
}
