import { expect, test } from "./fixtures";

/**
 * Social sign-in through the real web → proxy → API path. Runs only when the API has providers
 * configured (the local release stack uses FAKE client IDs). The provider's own login page is
 * stubbed, so this proves the redirect, state/PKCE and error handling — not a live provider login.
 */
test.describe("social sign-in", () => {
  test.beforeEach(async ({ request }) => {
    const providers = await request.get("/api/public/auth-providers").then((r) => r.json());
    test.skip(!providers.providers.some((p: { id: string }) => p.id === "google"), "Google is not configured on this API");
  });

  test("only configured providers are offered, on sign-in and sign-up", async ({ page }) => {
    for (const path of ["/sign-in", "/sign-up"]) {
      await page.goto(path);
      await expect(page.getByTestId("social-google")).toBeVisible();
      await expect(page.getByTestId("social-github")).toBeVisible();
      await expect(page.getByTestId("social-apple")).toHaveCount(0);
      await expect(page.getByTestId("social-twitter")).toHaveCount(0);
    }
  });

  test("Google starts an authorization-code + PKCE flow and a cancelled consent returns a clear message", async ({ page }) => {
    await page.route("https://accounts.google.com/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<p>Google (stubbed)</p>" }));
    await page.goto("/sign-in");
    await page.getByTestId("social-google").click();
    await page.waitForURL(/accounts\.google\.com/);

    const authorize = new URL(page.url());
    const origin = new URL(test.info().project.use.baseURL ?? "http://localhost:3000").origin;
    expect(authorize.searchParams.get("redirect_uri")).toBe(`${origin}/api/auth/callback/google`);
    expect(authorize.searchParams.get("response_type")).toBe("code");
    expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorize.searchParams.get("state");
    expect(state).toBeTruthy();

    // The user presses "Cancel" on Google's consent screen.
    await page.goto(`/api/auth/callback/google?error=access_denied&state=${encodeURIComponent(state!)}`);
    await expect(page).toHaveURL(/\/sign-in\?error=access_denied/);
    await expect(page.getByRole("alert").filter({ hasText: "Sign-in was cancelled" })).toBeVisible();
  });

  test("an existing-account conflict is explained without leaking details", async ({ page }) => {
    await page.goto("/sign-in?error=account%20not%20linked");
    await expect(page.getByRole("alert").filter({ hasText: "An account with this email already exists" })).toBeVisible();
    // Unknown codes get a generic message; the raw parameter is never rendered.
    await page.goto("/sign-in?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E");
    await expect(page.getByRole("alert").filter({ hasText: "Sign-in could not be completed" })).toBeVisible();
    await expect(page.getByText("alert(1)")).toHaveCount(0);
  });
});
