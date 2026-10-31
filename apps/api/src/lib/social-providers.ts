import type { BetterAuthOptions } from "better-auth";
import { env } from "../config/env.ts";

export type SocialProviderId = "google" | "github" | "apple" | "twitter";

export interface EnabledProvider {
  id: SocialProviderId;
  name: string;
}

/**
 * Builds Better Auth's `socialProviders` from the environment. A provider is only enabled
 * when both its client ID and secret are present, so the UI never offers a dead button.
 * Secrets stay on the server; the browser only learns provider IDs and display names.
 */
export function socialProvidersFromEnv() {
  const providers: NonNullable<BetterAuthOptions["socialProviders"]> = {};
  const enabled: EnabledProvider[] = [];

  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    providers.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      prompt: "select_account",
    };
    enabled.push({ id: "google", name: "Google" });
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    // Default scopes include user:email; the profile's email is used only if GitHub marks it verified.
    providers.github = { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET };
    enabled.push({ id: "github", name: "GitHub" });
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    providers.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
      ...(env.APPLE_APP_BUNDLE_IDENTIFIER ? { appBundleIdentifier: env.APPLE_APP_BUNDLE_IDENTIFIER } : {}),
    };
    enabled.push({ id: "apple", name: "Apple" });
  }
  if (env.TWITTER_CLIENT_ID && env.TWITTER_CLIENT_SECRET) {
    // X only shares a confirmed email when the app has the email permission; otherwise Better Auth
    // stores an unverified placeholder address, which can never be linked to another account.
    providers.twitter = { clientId: env.TWITTER_CLIENT_ID, clientSecret: env.TWITTER_CLIENT_SECRET };
    enabled.push({ id: "twitter", name: "X" });
  }

  return { providers, enabled };
}

export const socialProviders = socialProvidersFromEnv();
