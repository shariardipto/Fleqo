import { expect, test } from "./fixtures";
import { chooseOption, signUpWithOrganization, uniqueEmail } from "./helpers";

test.describe.configure({ mode: "serial" });

test("operator completes import → workflow → simulation → execution review", async ({ page }) => {
  const email = await signUpWithOrganization(page, "E2E Store");

  // ── Connections ───────────────────────────────────────────────────────
  await page.getByRole("link", { name: "Connections" }).click();
  await expect(page.getByRole("heading", { name: "Connections" })).toBeVisible();

  await page.getByTestId("connection-mock_store").getByRole("button", { name: "Connect" }).click();
  const secretDialog = page.getByRole("dialog", { name: "Signing secret" });
  await expect(secretDialog).toBeVisible();
  await expect(secretDialog.getByLabel("Signing secret")).toHaveValue(/^whsec_/);
  await secretDialog.getByRole("button", { name: "I have stored it" }).click();

  await page.getByTestId("connection-mock_crm").getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("connection-mock_crm").getByText("Active")).toBeVisible();
  await page.getByTestId("connection-mock_sheet").getByRole("button", { name: "Connect" }).click();
  await expect(page.getByTestId("connection-mock_sheet").getByText("Active")).toBeVisible();

  // ── Workflow ──────────────────────────────────────────────────────────
  await page.goto("/workflows/new");
  await expect(page.getByRole("heading", { name: "New workflow" })).toBeVisible();
  await expect(page.getByLabel("Source for Email").first()).toContainText("Customer email");
  await page.getByRole("button", { name: "Create workflow" }).click();
  await expect(page).toHaveURL(/\/workflows\/[\w-]+$/);
  await expect(page.getByRole("heading", { name: "Order Sync" })).toBeVisible();
  await expect(page.getByRole("switch", { name: "Workflow enabled" })).toBeChecked();

  // ── Demo data + simulator ─────────────────────────────────────────────
  await page.getByRole("link", { name: "Demo data" }).click();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "created" })).toContainText("Fleqo synthetic generator");

  await page.getByLabel("Number of orders (1–100)").fill("3");
  await page.getByRole("button", { name: "Send signed events" }).click();
  await expect(page.getByTestId("delivery-row").filter({ hasText: "accepted" })).toHaveCount(3);

  await page.getByRole("button", { name: "Re-send first event (duplicate test)" }).click();
  await expect(page.getByTestId("delivery-row")).toHaveCount(1);
  await expect(page.getByTestId("delivery-row")).toContainText("duplicate");

  // Transient failure that the worker retries automatically.
  await page.getByLabel("Number of orders (1–100)").fill("1");
  await chooseOption(page, "Sheet fault injection", "Fail 1st attempt (transient)");
  await page.getByRole("button", { name: "Send signed events" }).click();
  await expect(page.getByTestId("delivery-row").filter({ hasText: "accepted" })).toHaveCount(1);
  await page.getByTestId("delivery-row").getByRole("link", { name: "View run" }).click();
  await expect(page.getByText("Succeeded").first()).toBeVisible();
  await expect(page.getByTestId("action-run").nth(1)).toContainText("2 attempts");
  await expect(page.getByTestId("action-run").nth(0)).toContainText("1 attempt");

  // Exhausted retries → dead letter → authorized manual retry.
  await page.getByRole("link", { name: "Demo data" }).click();
  await page.getByLabel("Number of orders (1–100)").fill("1");
  await chooseOption(page, "Sheet fault injection", "Fail 5 attempts (exhausts retries)");
  await page.getByRole("button", { name: "Send signed events" }).click();
  await expect(page.getByTestId("delivery-row").filter({ hasText: "accepted" })).toHaveCount(1);
  await page.getByTestId("delivery-row").getByRole("link", { name: "View run" }).click();
  await expect(page.getByText(/In dead-letter queue/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Retry failed actions" }).click();
  await expect(page.locator("[data-status=succeeded]").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("action-run").nth(0)).toContainText("1 attempt");
  await expect(page.getByTestId("action-run").nth(1)).toContainText("6 attempts");
  await expect(page.getByText("Manual retry requested")).toBeVisible();

  // ── Executions list ───────────────────────────────────────────────────
  await page.getByRole("link", { name: "Executions" }).click();
  await expect(page.getByTestId("execution-row")).toHaveCount(5);
  await chooseOption(page, "Filter by status", "succeeded");
  await expect(page.getByTestId("execution-row")).toHaveCount(5);
  await chooseOption(page, "Filter by status", "failed");
  await expect(page.getByText("No matching executions")).toBeVisible();

  // ── Destination records ───────────────────────────────────────────────
  await page.getByRole("link", { name: "Connections" }).click();
  await expect(page.getByRole("tab", { name: "Sheet rows (5)" })).toBeVisible();

  // ── Dashboard reflects persisted counts ───────────────────────────────
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByText("Sheet rows").locator("..")).toContainText("5");

  // ── Team + settings ───────────────────────────────────────────────────
  await page.getByRole("link", { name: "Team" }).click();
  const invitee = uniqueEmail("invitee");
  await page.getByLabel("Email").fill(invitee);
  await page.getByRole("button", { name: "Invite" }).click();
  await expect(page.getByTestId("invite-link-box")).toContainText(invitee);
  await expect(page.getByLabel("Invite link")).toHaveValue(/\/invite\/[\w-]+$/);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Name").fill("E2E Store Renamed");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Organization updated")).toBeVisible();
  await expect(page.getByText("organization.updated").or(page.getByText("workflow.created")).first()).toBeVisible();

  // ── Sign out ──────────────────────────────────────────────────────────
  await page.getByRole("button", { name: new RegExp(email.split("@")[0].slice(0, 10)) }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/sign-in/);
});
