import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

// Configure Google + GitHub for this file only (modules are isolated per test file).
// These are fake test values; no real OAuth application is involved.
process.env.GOOGLE_CLIENT_ID = "test-google-client-id";
process.env.GOOGLE_CLIENT_SECRET = "test-google-client-secret";
process.env.GITHUB_CLIENT_ID = "test-github-client-id";
process.env.GITHUB_CLIENT_SECRET = "test-github-client-secret";

const { prisma } = await import("../src/lib/prisma.ts");
const { buildApp, client, signUp } = await import("./helpers/app.ts");
const { resetDatabase } = await import("./helpers/db.ts");

const app = buildApp();
const realFetch = globalThis.fetch;

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** Stands in for Google's token endpoint so the full callback can run offline. */
function stubGoogleToken(claims: { sub: string; email: string; email_verified: boolean; name?: string }) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      const now = Math.floor(Date.now() / 1000);
      const idToken = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
        iss: "https://accounts.google.com",
        aud: "test-google-client-id",
        iat: now,
        exp: now + 3600,
        name: claims.name ?? "Google User",
        ...claims,
      })}.signature`;
      return new Response(JSON.stringify({ access_token: "ya29.test", id_token: idToken, expires_in: 3600, token_type: "Bearer" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

async function startGoogleSignIn(agent: ReturnType<typeof client>, callbackURL = "/dashboard") {
  const res = await agent.post("/api/auth/sign-in/social", {
    provider: "google",
    callbackURL,
    newUserCallbackURL: "/onboarding",
    errorCallbackURL: "/sign-in",
  });
  return res;
}

async function completeGoogleCallback(agent: ReturnType<typeof client>) {
  const start = await startGoogleSignIn(agent);
  expect(start.status).toBe(200);
  const state = new URL(start.body.url).searchParams.get("state")!;
  return agent.get(`/api/auth/callback/google?code=test-authorization-code&state=${encodeURIComponent(state)}`);
}

describe("social sign-in (Better Auth OAuth)", () => {
  beforeEach(resetDatabase);
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  afterAll(() => prisma.$disconnect());

  it("lists only providers with complete server-side credentials and never exposes secrets", async () => {
    const res = await client(app).get("/api/public/auth-providers");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      emailPassword: true,
      providers: [
        { id: "google", name: "Google" },
        { id: "github", name: "GitHub" },
      ],
      passwordReset: false,
      emailVerification: "off",
    });
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("starts the Google authorization-code flow with PKCE and state on the proxied callback URL", async () => {
    const res = await startGoogleSignIn(client(app));
    expect(res.status).toBe(200);
    const url = new URL(res.body.url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("test-google-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/google");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")?.length).toBeGreaterThanOrEqual(16);
    expect(url.searchParams.get("scope")).toContain("email");
  });

  it("rejects open redirects and unconfigured providers", async () => {
    const evil = await client(app).post("/api/auth/sign-in/social", { provider: "google", callbackURL: "https://evil.example/steal" });
    expect(evil.status).toBe(403);
    const evilError = await client(app).post("/api/auth/sign-in/social", {
      provider: "google",
      callbackURL: "/dashboard",
      errorCallbackURL: "//evil.example/x",
    });
    expect(evilError.status).toBe(403);
    const apple = await client(app).post("/api/auth/sign-in/social", { provider: "apple", callbackURL: "/dashboard" });
    expect(apple.status).toBeGreaterThanOrEqual(400);
  });

  it("creates a new user with a verified email and sends them to onboarding", async () => {
    stubGoogleToken({ sub: "google-uid-new", email: "new.google.user@example.test", email_verified: true, name: "New Google" });
    const agent = client(app);
    const callback = await completeGoogleCallback(agent);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(/\/onboarding$/);

    const me = await agent.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe("new.google.user@example.test");
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "new.google.user@example.test" }, include: { accounts: true } });
    expect(user.emailVerified).toBe(true);
    expect(user.accounts.map((a) => a.providerId)).toEqual(["google"]);
  });

  it("does NOT link a Google identity into an existing unverified email/password account (pre-hijacking)", async () => {
    // Someone registered the address first with a password; the email was never verified.
    const squatter = await signUp(app, "victim@example.test");
    stubGoogleToken({ sub: "google-uid-victim", email: "victim@example.test", email_verified: true });

    const victimBrowser = client(app);
    const callback = await completeGoogleCallback(victimBrowser);
    expect(callback.status).toBe(302);
    expect(callback.headers.location).toMatch(/\/sign-in\?error=/);
    expect((await victimBrowser.get("/api/me")).status).toBe(401);

    const accounts = await prisma.account.findMany({ where: { userId: squatter.userId } });
    expect(accounts.map((a) => a.providerId)).toEqual(["credential"]);
  });

  it("signs a returning Google user back in without creating a duplicate user", async () => {
    stubGoogleToken({ sub: "google-uid-returning", email: "returning@example.test", email_verified: true });
    await completeGoogleCallback(client(app));
    const second = await completeGoogleCallback(client(app));
    expect(second.status).toBe(302);
    expect(second.headers.location).toMatch(/\/dashboard$/);
    expect(await prisma.user.count({ where: { email: "returning@example.test" } })).toBe(1);
  });

  it("returns cancelled or tampered callbacks to the sign-in page without a session", async () => {
    const agent = client(app);
    const start = await startGoogleSignIn(agent);
    const state = new URL(start.body.url).searchParams.get("state")!;
    const cancelled = await agent.get(`/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state)}`);
    expect(cancelled.status).toBe(302);
    expect(cancelled.headers.location).toMatch(/\/sign-in\?error=access_denied/);
    expect((await agent.get("/api/me")).status).toBe(401);

    const tampered = await client(app).get("/api/auth/callback/google?code=x&state=forged-state-value");
    expect(tampered.status).toBe(302);
    expect(tampered.headers.location).toMatch(/error=/);
    const setCookies = ([] as string[]).concat(tampered.headers["set-cookie"] ?? []);
    expect(setCookies.some((c) => c.includes("session_token=") && !c.includes("Max-Age=0"))).toBe(false);
  });
});
