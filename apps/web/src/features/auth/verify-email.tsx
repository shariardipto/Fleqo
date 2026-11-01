"use client";

import { CheckCircle2, MailWarning } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { safeNext } from "./auth-form";

/** Landing page of the emailed verification link (Better Auth appends `?error=` when it fails). */
export function VerifyEmailResult() {
  const params = useSearchParams();
  const failed = Boolean(params.get("error"));
  const next = safeNext(params.get("next"));
  const session = authClient.useSession();
  const signedIn = Boolean(session.data);

  if (failed) {
    return (
      <div>
        <span className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <MailWarning className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">This link has expired</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Verification links expire after 24 hours and stop working once a newer one is sent. Sign in with your email and password and
          we will email you a fresh link.
        </p>
        <Button asChild className="mt-6 w-full" size="lg">
          <Link href="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <div>
      <span className="flex size-11 items-center justify-center rounded-full bg-success/10 text-success">
        <CheckCircle2 className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Email verified</h1>
      <p className="mt-1.5 text-sm text-muted-foreground" role="status">
        {signedIn ? "Your email address is confirmed and you are signed in." : "Your email address is confirmed. Sign in to continue."}
      </p>
      <Button asChild className="mt-6 w-full" size="lg">
        <Link href={signedIn ? (next ?? "/dashboard") : `/sign-in${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
          {signedIn ? "Continue" : "Sign in"}
        </Link>
      </Button>
    </div>
  );
}
