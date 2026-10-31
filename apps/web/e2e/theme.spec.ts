import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { signUpWithOrganization } from "./helpers";

const htmlTheme = (page: Page) => page.evaluate(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
// Headers render a desktop and a mobile toggle; use whichever is shown at this viewport.
const toggle = (page: Page) => page.locator('[data-testid="theme-toggle"]:visible').first();

test.describe("light / dark theme", () => {
  test("one click switches the theme, and the choice persists across reloads, auth pages and the app", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(toggle(page)).toHaveAttribute("aria-label", "Switch to dark theme");

    // Single click to dark, single click back to light, no menu in between.
    await toggle(page).click();
    await expect.poll(() => htmlTheme(page)).toBe("dark");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute("aria-label", "Switch to light theme");
    await toggle(page).click();
    await expect.poll(() => htmlTheme(page)).toBe("light");
    await toggle(page).click();
    await expect.poll(() => htmlTheme(page)).toBe("dark");
    expect(await page.evaluate(() => localStorage.getItem("theme"))).toBe("dark");

    // Applied before first paint: the class is present as soon as the DOM is parsed (no flash).
    await page.goto("/sign-in", { waitUntil: "domcontentloaded" });
    expect(await htmlTheme(page)).toBe("dark");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await htmlTheme(page)).toBe("dark");

    await signUpWithOrganization(page, "Theme Co");
    expect(await htmlTheme(page)).toBe("dark");

    // The app's own toggle flips it back, and Settings reflects the stored choice.
    await toggle(page).click();
    await expect.poll(() => htmlTheme(page)).toBe("light");
    await page.goto("/settings");
    await expect(page.getByTestId("theme-select-light")).toHaveAttribute("aria-checked", "true");
    await page.getByTestId("theme-select-dark").click();
    await expect.poll(() => htmlTheme(page)).toBe("dark");
    await page.reload();
    await expect(page.getByTestId("theme-select-dark")).toHaveAttribute("aria-checked", "true");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(await htmlTheme(page)).toBe("dark");
  });

  test("first visits follow the device until the visitor picks a theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await expect.poll(() => htmlTheme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await expect.poll(() => htmlTheme(page)).toBe("light");

    // An explicit click wins over later device changes.
    await toggle(page).click();
    await expect.poll(() => htmlTheme(page)).toBe("dark");
    await page.emulateMedia({ colorScheme: "light" });
    await page.reload();
    expect(await htmlTheme(page)).toBe("dark");
  });

  test("the toggle and the Settings selector are keyboard accessible", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/sign-up");
    await toggle(page).focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => htmlTheme(page)).toBe("dark");
    await page.keyboard.press("Space");
    await expect.poll(() => htmlTheme(page)).toBe("light");

    await signUpWithOrganization(page, "Keyboard Co");
    await page.goto("/settings");
    const group = page.getByRole("radiogroup", { name: "Theme" });
    await group.getByRole("radio", { checked: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(group.getByRole("radio", { checked: true })).toBeFocused();
  });
});
