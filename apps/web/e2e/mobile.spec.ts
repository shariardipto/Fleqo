import { expect, test } from "./fixtures";
import { signUpWithOrganization } from "./helpers";

test("mobile navigation and empty states render", async ({ page }) => {
  await signUpWithOrganization(page, "Mobile Store");

  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("link", { name: "Executions" }).click();
  await expect(page.getByRole("heading", { name: "Executions", exact: true })).toBeVisible();
  await expect(page.getByText("No executions yet")).toBeVisible();

  // No horizontal overflow at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
