import { expect, test } from "./fixtures";
import { signUpWithOrganization } from "./helpers";

test.describe("public landing page", () => {
  test("anonymous visitors see the landing page and reach sign-in / sign-up", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Connect Your Workflows.");
    await expect(page.getByTestId("nav-dashboard")).toHaveCount(0);

    await page.getByTestId("nav-sign-in").click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await page.getByRole("link", { name: "Back to home" }).click();
    await expect(page).toHaveURL(/\/$/);

    await page.getByTestId("nav-get-started").click();
    await expect(page).toHaveURL(/\/sign-up$/);
    await page.goto("/");
    await page.getByTestId("primary-cta").first().click();
    await expect(page).toHaveURL(/\/sign-up$/);

    await page.goto("/");
    await page.getByTestId("explore-demo").click();
    await expect(page).toHaveURL(/#demo$/);
    await expect(page.getByTestId("interactive-demo")).toBeInViewport();
  });

  test("protected routes still require authentication", async ({ page }) => {
    for (const path of ["/dashboard", "/connections", "/workflows", "/executions", "/settings"]) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`/sign-in\\?next=${encodeURIComponent(path)}`));
    }
  });

  test("signed-in visitors get Go to Dashboard; signing out returns to sign-in", async ({ page }) => {
    await signUpWithOrganization(page, "Landing Co");
    await page.goto("/");
    await expect(page.getByTestId("nav-dashboard")).toBeVisible();
    await expect(page.getByTestId("nav-sign-in")).toHaveCount(0);
    await expect(page.getByTestId("primary-cta").first()).toHaveText(/Go to Dashboard/);
    await page.getByTestId("nav-dashboard").click();
    await expect(page).toHaveURL(/\/dashboard$/);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/sign-in/);
    await page.goto("/");
    await expect(page.getByTestId("nav-sign-in")).toBeVisible();
  });

  test("the interactive demo runs entirely in the browser: sync, duplicate and retry", async ({ page }) => {
    await page.goto("/#demo");
    const apiCalls: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url());
    });

    const log = page.getByTestId("demo-log");
    await page.getByTestId("demo-send").click();
    await expect(log).toContainText("Run succeeded", { timeout: 15_000 });
    await expect(page.getByTestId("demo-crm-count")).toHaveText("1 customer");
    await expect(page.getByTestId("demo-sheet-count")).toHaveText("1 row");

    await page.getByTestId("demo-resend").click();
    await expect(log).toContainText("acknowledged (200) · no new run", { timeout: 15_000 });
    await expect(page.getByTestId("demo-sheet-count")).toHaveText("1 row");

    await page.getByTestId("demo-outage").click();
    await page.getByTestId("demo-send").click();
    await expect(log).toContainText("simulated temporary outage", { timeout: 15_000 });
    await expect(log).toContainText("completed CRM action not repeated", { timeout: 15_000 });
    await expect(page.getByTestId("demo-sheet-count")).toHaveText("2 rows");

    // The header's session check (GET /api/auth/get-session) may refresh on focus; the demo itself makes no API calls.
    const demoCalls = apiCalls.filter((url) => !url.includes("/api/auth/get-session"));
    expect(demoCalls, `API calls during the demo: ${apiCalls.join(", ")}`).toEqual([]);
  });

  test("every link on the landing and docs pages resolves", async ({ page, request }) => {
    const checked = new Set<string>();
    for (const source of ["/", "/docs"]) {
      await page.goto(source);
      const links = await page
        .locator("a[href]")
        .evaluateAll((anchors) => anchors.map((a) => ({ href: a.getAttribute("href")!, target: a.getAttribute("target"), rel: a.getAttribute("rel") ?? "" })));
      for (const { href, target, rel } of links) {
        if (checked.has(href)) continue;
        checked.add(href);
        const url = new URL(href, page.url());
        if (url.origin !== new URL(page.url()).origin) {
          // External links are not fetched; they must be HTTPS and open safely in a new tab.
          expect(url.protocol, `external link ${href}`).toBe("https:");
          if (target === "_blank") expect(rel, `rel on ${href}`).toContain("noopener");
          continue;
        }
        const response = await request.get(url.pathname);
        expect(response.status(), `${href} from ${source}`).toBeLessThan(400);
        if (url.hash) {
          const target = await request.get(url.pathname).then((r) => r.text());
          expect(target, `anchor ${href}`).toContain(`id="${url.hash.slice(1)}"`);
        }
      }
    }
    expect(checked.size).toBeGreaterThan(15);
  });

  test("SEO metadata, Open Graph image, robots and sitemap are served", async ({ page, request }) => {
    await page.goto("/");
    await expect(page).toHaveTitle("Fleqo — Integration & Workflow Automation");
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /signed webhooks/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", /Fleqo/);
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute("content");
    expect(ogImage).toBeTruthy();
    const image = await request.get(new URL(ogImage!).pathname);
    expect(image.headers()["content-type"]).toContain("image/png");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /^https?:\/\/[^/]+\/?$/);
    expect((await request.get("/robots.txt").then((r) => r.text()))).toContain("Disallow: /dashboard");
    expect((await request.get("/sitemap.xml").then((r) => r.text()))).toContain("/docs");
  });

  for (const viewport of [
    { name: "phone", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
  ]) {
    test(`no horizontal overflow on public pages (${viewport.name})`, async ({ page }) => {
      await page.setViewportSize(viewport);
      for (const path of ["/", "/docs", "/sign-in", "/sign-up"]) {
        await page.goto(path);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${path} @ ${viewport.width}px`).toBeLessThanOrEqual(1);
      }
    });
  }

  test("mobile menu opens, navigates and closes", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const menu = page.getByRole("dialog", { name: "Menu" });
    await expect(menu).toBeVisible();
    await menu.getByRole("link", { name: "Features" }).click();
    await expect(menu).toBeHidden();
    await expect(page).toHaveURL(/#features$/);
  });
});
