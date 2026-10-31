import { expect, test } from "./fixtures";
import { signUpWithOrganization } from "./helpers";

test("the sidebar shows live system health, the release and the demo-data notice", async ({ page }) => {
  await signUpWithOrganization(page, "Status Co");

  // Real readiness from the running API: database and Redis are up.
  const status = page.getByTestId("system-status");
  await expect(status).toHaveAttribute("data-state", "ok");
  await expect(status).toContainText("All systems operational");
  await expect(status).toContainText("v1.1");
  await expect(status).toContainText("Mock integrations · synthetic data");

  // Redis down: the API answers 503 with the dependency breakdown.
  await page.route("**/api/ready", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, database: "connected", redis: "unavailable" }) }),
  );
  await page.reload();
  await expect(status).toHaveAttribute("data-state", "queue");
  await expect(status).toContainText("Queue unavailable");
  await expect(status).toContainText("Events are kept and run later");

  // API not reachable at all.
  await page.unroute("**/api/ready");
  await page.route("**/api/ready", (route) => route.abort());
  await page.reload();
  await expect(status).toHaveAttribute("data-state", "down");
  await expect(status).toContainText("API unreachable");
});
