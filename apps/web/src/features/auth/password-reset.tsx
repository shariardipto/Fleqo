"use client";

import { AlertCircle, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { FieldError, PasswordInput, useAuthProviders } from "./auth-form";

const linkClass = "font-medium text-foreground underline-offset-4 hover:underline";

/** Step 1: ask for the address. The answer is the same whether or not an account exists. */
export function ForgotPasswordForm() {
  const providers = useAuthProviders();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setEmailError("Enter a valid email address.");
      return;
    }
    setEmailError(undefined);
    setError(null);
    setPending(true);
    const result = await authClient.requestPasswordReset({ email, redirectTo: "/reset-password" });
    setPending(false);
    if (result.error) {
      setError(result.error.status === 429 ? "Too many requests. Wait a minute and try again." : "We could not send the email. Please try again.");
      return;
    }
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <div>
        <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MailCheck className="size-5" aria-hidden />
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="mt-1.5 text-sm text-muted-foreground" role="status">
          If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, we sent a link to choose a new
          password. It expires in 1 hour and works once.
        </p>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Remembered it?{" "}
          <Link className={linkClass} href="/sign-in">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  const unavailable = providers.data && !providers.data.passwordReset;

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Forgot your password?</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">Enter your account email and we will send you a link to choose a new one.</p>

      {(error || unavailable) && (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertCircle />
          <AlertDescription>
            {error ?? "Password reset is not available on this Fleqo installation yet. Ask your administrator to reset your account."}
          </AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            aria-invalid={Boolean(emailError) || undefined}
            aria-describedby={emailError ? "email-error" : undefined}
          />
          <FieldError id="email-error" message={emailError} />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={pending || Boolean(unavailable)}>
          {pending && <Loader2 className="animate-spin" />}
          Send reset link
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        Remembered it?{" "}
        <Link className={linkClass} href="/sign-in">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}

/** Step 2: the emailed link lands here with `?token=…` (or `?error=INVALID_TOKEN` when it has expired). */
export function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [expired, setExpired] = useState(!token || params.get("error") === "INVALID_TOKEN");

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const confirm = String(form.get("confirm") ?? "");
    const next: typeof errors = {};
    if (password.length < 8) next.password = "Use at least 8 characters.";
    else if (password.length > 128) next.password = "Use at most 128 characters.";
    if (confirm !== password) next.confirm = "Passwords do not match.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !token) return;

    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword: password, token });
    if (result.error) {
      setPending(false);
      if (result.error.code === "INVALID_TOKEN") setExpired(true);
      else setError(result.error.message ?? "Your password could not be changed. Please try again.");
      return;
    }
    router.replace("/sign-in?reset=success");
  }

  if (expired) {
    return (
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">This link has expired</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Password reset links work once and expire after 1 hour. Request a new one to continue.
        </p>
        <Button asChild className="mt-6 w-full" size="lg">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          <Link className={linkClass} href="/sign-in">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">You will be signed out on your other devices.</p>

      {error && (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <PasswordInput
            id="password"
            name="password"
            autoComplete="new-password"
            fieldLabel="new password"
            invalid={Boolean(errors.password)}
            describedBy={errors.password ? "password-error" : "password-hint"}
          />
          {errors.password ? (
            <FieldError id="password-error" message={errors.password} />
          ) : (
            <p id="password-hint" className="text-xs text-muted-foreground">
              At least 8 characters.
            </p>
          )}
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm new password</Label>
          <PasswordInput
            id="confirm"
            name="confirm"
            autoComplete="new-password"
            fieldLabel="new password confirmation"
            invalid={Boolean(errors.confirm)}
            describedBy={errors.confirm ? "confirm-error" : undefined}
          />
          <FieldError id="confirm-error" message={errors.confirm} />
        </div>
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Change password
        </Button>
      </form>
    </div>
  );
}
