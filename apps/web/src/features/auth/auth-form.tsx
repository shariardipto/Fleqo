"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending(true);
    setError(null);

    const result =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "").trim() || email.split("@")[0] });

    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication failed");
      return;
    }
    await queryClient.invalidateQueries();
    // New accounts go to onboarding unless they came from somewhere specific (e.g. an invite link).
    const next = params.get("next");
    router.replace(mode === "sign-up" && !next ? "/onboarding" : safeNext(next));
  }

  const isSignUp = mode === "sign-up";
  const nextQuery = params.get("next") ? `?next=${encodeURIComponent(safeNext(params.get("next")))}` : "";
  return (
    <Card>
      <CardHeader>
        <CardTitle>{isSignUp ? "Create your account" : "Sign in to Fleqo"}</CardTitle>
        <CardDescription>
          {isSignUp ? "Start automating order sync in a few minutes." : "Welcome back. Use your email and password."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate={false}>
        <CardContent className="space-y-4">
          {error && (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {isSignUp && (
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" autoComplete="name" maxLength={80} placeholder="Ada Lovelace" />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              required
              minLength={8}
              maxLength={128}
            />
            {isSignUp && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
          </div>
        </CardContent>
        <CardFooter className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
          <p className="text-sm text-muted-foreground">
            {isSignUp ? "Already have an account? " : "New to Fleqo? "}
            <Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`${isSignUp ? "/sign-in" : "/sign-up"}${nextQuery}`}>
              {isSignUp ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}
