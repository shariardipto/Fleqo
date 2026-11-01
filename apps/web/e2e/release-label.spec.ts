import { expect, test } from "./fixtures";
import { signUpWithOrganization } from "./helpers";

test("the sidebar shows the product name and release", async ({ page }) => {
  await signUpWithOrganization(page, "Release Co");
  const label = page.getByTestId("release-label");
  await expect(label).toHaveText(/^Workflow Automation\s*v1\.1$/);
});
