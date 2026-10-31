"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
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

interface AuthProviders {
  emailPassword: boolean;
  providers: { id: "google" | "github" | "apple" | "twitter"; name: string }[];
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

function PasswordInput({
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

function FieldError({ id, message }: { id: string; message?: string }) {
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

  const providers = useQuery({
    queryKey: ["auth-providers"],
    queryFn: () => api<AuthProviders>("/public/auth-providers"),
    staleTime: 5 * 60_000,
  });
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
      ? await authClient.signUp.email({ email, password, name: String(form.get("name") ?? "").trim() })
      : await authClient.signIn.email({ email, password });

    if (result.error) {
      setPending(null);
      setError(result.error.message ?? "Authentication failed");
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

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{isSignUp ? "Create your Fleqo account" : "Welcome back"}</h1>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {isSignUp ? "Automate order sync in minutes. No credit card, no real integrations needed." : "Sign in to monitor and manage your workflows."}
      </p>

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
          <Label htmlFor="password">Password</Label>
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
