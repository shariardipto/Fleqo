import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

// Required verification with the file transport, for this file only (modules are isolated per file).
const mailDir = mkdtempSync(path.join(os.tmpdir(), "fleqo-mail-"));
process.env.EMAIL_PROVIDER = "file";
process.env.EMAIL_FROM = "Fleqo <no-reply@example.test>";
process.env.EMAIL_FILE_DIR = mailDir;
process.env.REQUIRE_EMAIL_VERIFICATION = "true";

const { prisma } = await import("../src/lib/prisma.ts");
const { emailConfigProblems } = await import("../src/config/env.ts");
const { buildApp, client, PASSWORD } = await import("./helpers/app.ts");
const { resetDatabase } = await import("./helpers/db.ts");

const app = buildApp();

interface SentEmail {
  to: string;
  subject: string;
  text: string;
}

function sentEmails(to: string): SentEmail[] {
  return readdirSync(mailDir)
    .sort()
    .map((file) => JSON.parse(readFileSync(path.join(mailDir, file), "utf8")) as SentEmail)
    .filter((email) => email.to === to);
}

/** Emails are sent after the response (no timing side channel), so wait for the file. */
async function waitForEmail(to: string, subject: RegExp, count = 1): Promise<{ email: SentEmail; link: string }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const matching = sentEmails(to).filter((email) => subject.test(email.subject));
    if (matching.length >= count) {
      const email = matching[count - 1];
      return { email, link: email.text.match(/https?:\/\/\S+/)![0] };
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email "${subject}" to ${to}`);
}

/** The emailed link points at the web origin; the API serves the same path behind the proxy. */
const pathOf = (link: string) => {
  const url = new URL(link);
  return url.pathname + url.search;
};

async function signUp(email: string, c = client(app)) {
  const res = await c.post("/api/auth/sign-up/email", { email, password: PASSWORD, name: "Ada Lovelace", callbackURL: "/verify-email" });
  return { c, res };
}

async function verifiedUser(email: string) {
  await signUp(email);
  await prisma.user.update({ where: { email }, data: { emailVerified: true } });
}

describe("email verification and password reset", () => {
  beforeEach(async () => {
    await resetDatabase();
    for (const file of readdirSync(mailDir)) rmSync(path.join(mailDir, file));
  });
  afterAll(async () => {
    rmSync(mailDir, { recursive: true, force: true });
    await prisma.$disconnect();
  });

  it("tells the web app that reset is available and verification is required", async () => {
    const res = await client(app).get("/api/public/auth-providers");
    expect(res.body).toMatchObject({ emailPassword: true, passwordReset: true, emailVerification: "required" });
  });

  it("creates no session until the emailed link is opened, then verifies and signs the user in", async () => {
    const email = "ada@example.test";
    const { c, res } = await signUp(email);
    expect(res.status).toBe(200);
    expect(res.body.token).toBeNull();
    expect((await c.get("/api/me")).status).toBe(401);

    const { email: message, link } = await waitForEmail(email, /Verify your email/);
    expect(message.text).toContain("Hi Ada Lovelace");
    expect(link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/verify-email\?token=[^&]+&callbackURL=%2Fverify-email$/);

    // Signing in before verifying is refused, and a fresh link is sent.
    const early = await client(app).post("/api/auth/sign-in/email", { email, password: PASSWORD });
    expect(early.status).toBe(403);
    expect(early.body.code).toBe("EMAIL_NOT_VERIFIED");
    await waitForEmail(email, /Verify your email/, 2);

    const browser = client(app);
    const verified = await browser.get(pathOf(link));
    expect(verified.status).toBe(302);
    expect(verified.headers.location).toBe("/verify-email");
    const me = await browser.get("/api/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).emailVerified).toBe(true);
  });

  it("rejects a tampered verification link without creating a session", async () => {
    const browser = client(app);
    const res = await browser.get("/api/auth/verify-email?token=not-a-real-token&callbackURL=%2Fverify-email");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/verify-email?error=INVALID_TOKEN");
    expect((await browser.get("/api/me")).status).toBe(401);
  });

  it("does not reveal existing accounts at sign-up, and warns the real owner instead", async () => {
    const email = "owner@example.test";
    await verifiedUser(email);
    const fresh = await signUp("newcomer@example.test");
    const duplicate = await signUp(email);

    expect(duplicate.res.status).toBe(fresh.res.status);
    expect(Object.keys(duplicate.res.body).sort()).toEqual(Object.keys(fresh.res.body).sort());
    expect(await prisma.user.count({ where: { email } })).toBe(1);
    const { email: notice } = await waitForEmail(email, /already|tried to create/);
    expect(notice.text).toContain("http://localhost:3000/sign-in");
  });

  it("resets a password with a single-use emailed link and signs out every other session", async () => {
    const email = "grace@example.test";
    await verifiedUser(email);
    const oldSession = client(app);
    expect((await oldSession.post("/api/auth/sign-in/email", { email, password: PASSWORD })).status).toBe(200);

    const requested = await client(app).post("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" });
    expect(requested.status).toBe(200);
    const { link } = await waitForEmail(email, /Reset your Fleqo password/);
    expect(link).toMatch(/^http:\/\/localhost:3000\/api\/auth\/reset-password\/[^?]+\?callbackURL=%2Freset-password$/);

    const landing = await client(app).get(pathOf(link));
    expect(landing.status).toBe(302);
    const token = new URL(landing.headers.location, "http://localhost:3000").searchParams.get("token")!;
    expect(landing.headers.location).toBe(`http://localhost:3000/reset-password?token=${token}`);

    const newPassword = "a-brand-new-passphrase";
    expect((await client(app).post("/api/auth/reset-password", { newPassword, token })).status).toBe(200);
    expect((await oldSession.get("/api/me")).status).toBe(401);
    expect((await client(app).post("/api/auth/sign-in/email", { email, password: PASSWORD })).status).toBe(401);
    expect((await client(app).post("/api/auth/sign-in/email", { email, password: newPassword })).status).toBe(200);

    const reused = await client(app).post("/api/auth/reset-password", { newPassword: "yet-another-passphrase", token });
    expect(reused.status).toBe(400);
    expect(reused.body.code).toBe("INVALID_TOKEN");
  });

  it("answers reset requests for unknown addresses exactly like known ones, without sending anything", async () => {
    await verifiedUser("known@example.test");
    const known = await client(app).post("/api/auth/request-password-reset", { email: "known@example.test", redirectTo: "/reset-password" });
    const unknown = await client(app).post("/api/auth/request-password-reset", { email: "nobody@example.test", redirectTo: "/reset-password" });
    expect(unknown.status).toBe(known.status);
    expect(unknown.body).toEqual(known.body);
    await waitForEmail("known@example.test", /Reset/);
    expect(sentEmails("nobody@example.test")).toHaveLength(0);
  });

  it("refuses reset and verification links that would redirect off-site", async () => {
    await verifiedUser("redirect@example.test");
    const reset = await client(app).post("/api/auth/request-password-reset", {
      email: "redirect@example.test",
      redirectTo: "https://evil.example/reset",
    });
    expect(reset.status).toBe(403);
    const verify = await client(app).get("/api/auth/verify-email?token=x&callbackURL=https%3A%2F%2Fevil.example");
    expect(verify.status).toBe(403);
  });

  it("rejects email settings that cannot work", () => {
    const base = { EMAIL_PROVIDER: undefined, EMAIL_FROM: undefined, RESEND_API_KEY: undefined, REQUIRE_EMAIL_VERIFICATION: false };
    expect(emailConfigProblems(base)).toEqual([]);
    expect(emailConfigProblems({ ...base, EMAIL_PROVIDER: "resend", EMAIL_FROM: "Fleqo <a@b.c>" })).toEqual([
      "RESEND_API_KEY is required for EMAIL_PROVIDER=resend",
    ]);
    expect(emailConfigProblems({ ...base, EMAIL_PROVIDER: "log" })).toEqual(["EMAIL_FROM is required when EMAIL_PROVIDER is set"]);
    expect(emailConfigProblems({ ...base, REQUIRE_EMAIL_VERIFICATION: true })[0]).toMatch(/needs EMAIL_PROVIDER/);
  });
});
