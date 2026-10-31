import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signUpWithOrganization } from "./helpers";

/** WCAG 2.x A/AA checks (including colour contrast); collects serious or critical violations. */
async function audit(page: Page, label: string, findings: string[]) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  for (const violation of results.violations.filter((v) => v.impact === "serious" || v.impact === "critical")) {
    findings.push(`${label} · ${violation.id}: ${violation.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  }
}

for (const scheme of ["light", "dark"] as const) {
  test(`public pages pass WCAG AA checks in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    const findings: string[] = [];
    for (const path of ["/", "/docs", "/sign-in", "/sign-up"]) {
      await page.goto(path);
      await audit(page, path, findings);
    }
    expect(findings, `accessibility violations (${scheme})`).toEqual([]);
  });

  test(`app pages pass WCAG AA checks in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: "reduce" });
    await signUpWithOrganization(page, `A11y ${scheme}`);
    await page.goto("/connections");
    await page.getByTestId("connection-mock_store").getByRole("button", { name: "Connect" }).click();
    await page.getByRole("button", { name: "I have stored it" }).click();
    const findings: string[] = [];
    for (const path of ["/dashboard", "/connections", "/workflows/new", "/executions", "/demo", "/team", "/settings", "/onboarding"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await audit(page, path, findings);
    }
    expect(findings, `accessibility violations (${scheme})`).toEqual([]);
  });
}
