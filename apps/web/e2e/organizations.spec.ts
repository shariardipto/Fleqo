import { expect, test } from "./fixtures";
import { signUpWithOrganization } from "./helpers";

test("creating and switching organizations keeps each tenant's data separate", async ({ page }) => {
  await signUpWithOrganization(page, "Alpha Store");

  // Alpha gets a Mock Store connection.
  await page.goto("/connections");
  await page.getByTestId("connection-mock_store").getByRole("button", { name: "Connect" }).click();
  await page.getByRole("button", { name: "I have stored it" }).click();
  await expect(page.getByTestId("connection-mock_store").getByText("Active")).toBeVisible();

  // A second organization from the switcher starts empty.
  await page.getByRole("button", { name: "Switch organization" }).click();
  await page.getByRole("menuitem", { name: "New organization" }).click();
  await page.getByLabel("Organization name").fill("Beta Store");
  await page.getByRole("button", { name: "Create organization" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("button", { name: "Switch organization" })).toContainText("Beta Store");
  await page.goto("/connections");
  await expect(page.getByTestId("connection-mock_store").getByText("Not connected.")).toBeVisible();

  // Switching back shows Alpha's data again.
  await page.getByRole("button", { name: "Switch organization" }).click();
  await page.getByRole("menuitem", { name: "Alpha Store" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("button", { name: "Switch organization" })).toContainText("Alpha Store");
  await page.goto("/connections");
  await expect(page.getByTestId("connection-mock_store").getByText("Active")).toBeVisible();

  // The session survives a full reload (database-backed session, httpOnly cookie).
  await page.reload();
  await expect(page.getByRole("button", { name: "Switch organization" })).toContainText("Alpha Store");
});
