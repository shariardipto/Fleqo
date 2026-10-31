import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-123";

export function uniqueEmail(prefix = "e2e") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.test`;
}

/** Signs up through the UI and creates an organization via onboarding. */
export async function signUpWithOrganization(page: Page, orgName: string, email = uniqueEmail()) {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("E2E Operator");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByLabel("Organization name").fill(orgName);
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  return email;
}

export async function chooseOption(page: Page, label: string, option: string) {
  await page.getByLabel(label).click();
  await page.getByRole("option", { name: option }).click();
}
