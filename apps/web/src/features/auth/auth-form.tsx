"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { ProviderIcon } from "./provider-icons";

export interface AuthProviders {
  emailPassword: boolean;
  providers: { id: "google" | "github" | "apple" | "twitter"; name: string }[];
  passwordReset: boolean;
  emailVerification: "required" | "optional" | "off";
}

export function useAuthProviders() {
  return useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => api<AuthProviders>("/public/auth-providers"),
    staleTime: 5 * 60_000,
  });
}

/** Where the emailed verification link lands; it forwards to `next` once verified. */
export function verifyEmailCallback(next: string | null) {
  return next ? `/verify-email?next=${encodeURIComponent(next)}` : "/verify-email";
}

/** Only same-site relative redirects are honoured after sign-in (no open redirects). */
export function safeNext(value: string | null) {
  return value && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null;
}

// Error codes Better Auth appends to errorCallbackURL after a failed OAuth round trip.
const OAUTH_ERRORS: Record<string, string> = {
  access_denied: "Sign-in was cancelled. Try again or choose another method.",
  "account not linked": "An account with this email already exists. Sign in with your email and password instead.",
  account_not_linked: "An account with this email already exists. Sign in with your email and password instead.",
  email_not_found: "The provider did not share an email address with Fleqo. Use another sign-in method.",
  state_mismatch: "Your sign-in attempt expired. Please try again.",
  state_not_found: "Your sign-in attempt expired. Please try again.",
  please_restart_the_process: "Your sign-in attempt expired. Please try again.",
  invalid_callback_request: "The sign-in response was invalid. Please try again.",
};

function oauthErrorMessage(code: string | null) {
  if (!code) return null;
  return OAUTH_ERRORS[code] ?? "Sign-in could not be completed. Please try again or use another method.";
}

export function PasswordInput({
  id,
  name,
  autoComplete,
  invalid,
  describedBy,
  fieldLabel = "password",
}: {
  id: string;
  name: string;
  autoComplete: string;
  invalid?: boolean;
  describedBy?: string;
  fieldLabel?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        minLength={8}
        maxLength={128}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? `Hide ${fieldLabel}` : `Show ${fieldLabel}`}
        aria-pressed={visible}
        aria-controls={id}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}

export function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-xs text-destructive" role="alert">
      {message}
    </p>
  );
}

type Errors = Partial<Record<"name" | "email" | "password" | "confirm", string>>;

function validateSignUp(form: FormData): Errors {
  const errors: Errors = {};
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");
  if (name.length < 2) errors.name = "Enter your full name (at least 2 characters).";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = "Enter a valid email address.";
  if (password.length < 8) errors.password = "Use at least 8 characters.";
  else if (password.length > 128) errors.password = "Use at most 128 characters.";
  if (confirm !== password) errors.confirm = "Passwords do not match.";
  return errors;
}

export function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const isSignUp = mode === "sign-up";
  const next = safeNext(params.get("next"));
  const nextQuery = next ? `?next=${encodeURIComponent(next)}` : "";

  const [error, setError] = useState<string | null>(() => oauthErrorMessage(params.get("error")));
  const [fieldErrors, setFieldErrors] = useState<Errors>({});
  const [pending, setPending] = useState<"email" | string | null>(null);
  // Set when sign-up succeeded but the account waits for its emailed verification link.
  const [awaitingVerification, setAwaitingVerification] = useState<string | null>(null);
  const notice = !isSignUp && params.get("reset") === "success" ? "Your password was changed. Sign in with the new one." : null;

  const providers = useAuthProviders();
  const socials = providers.data?.providers ?? [];

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (isSignUp) {
      const errors = validateSignUp(form);
      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;
    }
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    setPending("email");
    setError(null);

    const result = isSignUp
      ? await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "").trim(), callbackURL: verifyEmailCallback(next) })
      : // Better Auth redirects here after a successful sign-in, and uses it as the landing page of the
        // verification link it re-sends to unverified accounts; both should end in the app.
        await authClient.signIn.email({ email, password, callbackURL: next ?? "/dashboard" });

    if (result.error) {
      setPending(null);
      setError(
        result.error.code === "EMAIL_NOT_VERIFIED"
          ? `Verify your email to sign in. We sent a new link to ${email}; it expires in 24 hours.`
          : (result.error.message ?? "Authentication failed"),
      );
      return;
    }
    // Required verification: the account exists but has no session until the emailed link is opened.
    if (isSignUp && !result.data?.token) {
      setPending(null);
      setAwaitingVerification(email);
      return;
    }
    await queryClient.invalidateQueries();
    // New accounts go to onboarding unless they came from somewhere specific (e.g. an invite link).
    router.replace(next ?? (isSignUp ? "/onboarding" : "/dashboard"));
  }

  async function continueWith(provider: string) {
    setPending(provider);
    setError(null);
    // The browser is redirected to the provider; Better Auth validates these relative URLs server-side.
    const result = await authClient.signIn.social({
      provider,
      callbackURL: next ?? "/dashboard",
      newUserCallbackURL: next ?? "/onboarding",
      errorCallbackURL: isSignUp ? "/sign-up" : "/sign-in",
    });
    if (result?.error) {
      setPending(null);
      setError(result.error.message ?? "Could not start sign-in with this provider.");
    }
  }

  const busy = pending !== null;

  if (awaitingVerification) {
    return <CheckInbox email={awaitingVerification} callbackURL={verifyEmailCallback(next)} onUseAnother={() => setAwaitingVerification(null)} />;
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{isSignUp ? "Create your Fleqo account" : "Welcome back"}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {isSignUp ? "Automate order sync in minutes. No credit card, no real integrations needed." : "Sign in to monitor and manage your workflows."}
      </p>

      {notice && !error && (
        <Alert className="mt-6" role="status">
          <CheckCircle2 className="text-success" />
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive" className="mt-6" role="alert">
          <AlertCircle />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={onSubmit} noValidate className="mt-6 space-y-4">
        {isSignUp && (
          <div className="space-y-2">
            <Label htmlFor="name">Full name</Label>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              maxLength={80}
              placeholder="Ada Lovelace"
              aria-invalid={Boolean(fieldErrors.name) || undefined}
              aria-describedby={fieldErrors.name ? "name-error" : undefined}
            />
            <FieldError id="name-error" message={fieldErrors.name} />
          </div>
        )}
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="you@company.com"
            aria-invalid={Boolean(fieldErrors.email) || undefined}
            aria-describedby={fieldErrors.email ? "email-error" : undefined}
          />
          <FieldError id="email-error" message={fieldErrors.email} />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="password">Password</Label>
            {!isSignUp && providers.data?.passwordReset && (
              <Link href="/forgot-password" className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Forgot password?
              </Link>
            )}
          </div>
          <PasswordInput
            id="password"
            name="password"
            autoComplete={isSignUp ? "new-password" : "current-password"}
            invalid={Boolean(fieldErrors.password)}
            describedBy={isSignUp ? (fieldErrors.password ? "password-error" : "password-hint") : undefined}
          />
          {isSignUp &&
            (fieldErrors.password ? (
              <FieldError id="password-error" message={fieldErrors.password} />
            ) : (
              <p id="password-hint" className="text-xs text-muted-foreground">
                At least 8 characters.
              </p>
            ))}
        </div>
        {isSignUp && (
          <div className="space-y-2">
            <Label htmlFor="confirm">Confirm password</Label>
            <PasswordInput
              id="confirm"
              name="confirm"
              autoComplete="new-password"
              fieldLabel="password confirmation"
              invalid={Boolean(fieldErrors.confirm)}
              describedBy={fieldErrors.confirm ? "confirm-error" : undefined}
            />
            <FieldError id="confirm-error" message={fieldErrors.confirm} />
          </div>
        )}
        <Button type="submit" className="w-full" size="lg" disabled={busy}>
          {pending === "email" && <Loader2 className="animate-spin" />}
          {isSignUp ? "Create account" : "Sign in"}
        </Button>
      </form>

      {socials.length > 0 && (
        <>
          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground" role="separator" aria-label="Or continue with">
            <span className="h-px flex-1 bg-border" />
            Or continue with
            <span className="h-px flex-1 bg-border" />
          </div>
          <div className={cn("grid gap-2", socials.length > 1 && "sm:grid-cols-2")} data-testid="social-providers">
            {socials.map((provider) => (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                size="lg"
                disabled={busy}
                onClick={() => continueWith(provider.id)}
                data-testid={`social-${provider.id}`}
              >
                {pending === provider.id ? <Loader2 className="animate-spin" /> : <ProviderIcon id={provider.id} />}
                {provider.name}
              </Button>
            ))}
          </div>
        </>
      )}

      <p className="mt-8 text-center text-sm text-muted-foreground">
        {isSignUp ? "Already have an account? " : "New to Fleqo? "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href={`${isSignUp ? "/sign-in" : "/sign-up"}${nextQuery}`}>
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}

/** Shown after sign-up when the address must be verified before the first sign-in. */
function CheckInbox({ email, callbackURL, onUseAnother }: { email: string; callbackURL: string; onUseAnother: () => void }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function resend() {
    setState("sending");
    const { error } = await authClient.sendVerificationEmail({ email, callbackURL });
    setState(error ? "error" : "sent");
  }

  return (
    <div>
      <span className="flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
        <MailCheck className="size-5" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Check your inbox</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        We sent a verification link to <span className="font-medium text-foreground">{email}</span>. Open it to finish creating your
        account. The link expires in 24 hours.
      </p>
      <div role="status" aria-live="polite" className="mt-4 min-h-5 text-sm">
        {state === "sent" && <p className="text-success">A new link is on its way.</p>}
        {state === "error" && <p className="text-destructive">We could not send another email right now. Wait a minute and try again.</p>}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <Button variant="outline" size="lg" onClick={resend} disabled={state === "sending"}>
          {state === "sending" && <Loader2 className="animate-spin" />}
          Resend email
        </Button>
        <Button variant="ghost" size="lg" onClick={onUseAnother}>
          Use a different email
        </Button>
      </div>
      <p className="mt-8 text-center text-sm text-muted-foreground">
        Already verified?{" "}
        <Link className="font-medium text-foreground underline-offset-4 hover:underline" href="/sign-in">
          Sign in
        </Link>
      </p>
    </div>
  );
}
