import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures";
import { PASSWORD, signUpWithOrganization } from "./helpers";

// The API under test writes emails as JSON files (EMAIL_PROVIDER=file); this is that directory.
const EMAIL_DIR = process.env.E2E_EMAIL_DIR;

async function emailLink(to: string, subject: RegExp): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const files = EMAIL_DIR ? readdirSync(EMAIL_DIR).sort().reverse() : [];
    for (const file of files) {
      const email = JSON.parse(readFileSync(path.join(EMAIL_DIR!, file), "utf8")) as { to: string; subject: string; text: string };
      if (email.to === to && subject.test(email.subject)) return email.text.match(/https?:\/\/\S+/)![0];
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`No "${subject}" email for ${to}`);
}

test.describe("password reset by email", () => {
  test.skip(!EMAIL_DIR, "Needs the API's file email transport (set E2E_EMAIL_DIR)");

  test("a forgotten password is replaced through the single-use emailed link", async ({ page }) => {
    const email = await signUpWithOrganization(page, "Reset Co");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);

    await page.getByRole("link", { name: "Forgot password?" }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(`If an account exists for ${email}`)).toBeVisible();

    // The link points at BETTER_AUTH_URL (the web origin); open the same path on the app under test.
    const link = new URL(await emailLink(email, /Reset your Fleqo password/));
    await page.goto(link.pathname + link.search);
    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await page.getByLabel("New password", { exact: true }).fill("brand-new-passphrase");
    await page.getByLabel("Confirm new password").fill("brand-new-passphrase");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/sign-in\?reset=success$/);
    await expect(page.getByText("Your password was changed.")).toBeVisible();

    // The old password no longer works; the new one does.
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: /invalid/i })).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill("brand-new-passphrase");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    // The link worked once.
    await page.goto(link.pathname + link.search);
    await expect(page.getByRole("heading", { name: "This link has expired" })).toBeVisible();
  });
});
