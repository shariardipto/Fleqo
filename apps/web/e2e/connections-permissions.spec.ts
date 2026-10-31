import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { PASSWORD, signUpWithOrganization, uniqueEmail } from "./helpers";

const PROVIDERS = ["mock_store", "mock_crm", "mock_sheet"] as const;

async function connectAll(page: Page) {
  await page.goto("/connections");
  for (const provider of PROVIDERS) {
    await page.getByTestId(`connection-${provider}`).getByRole("button", { name: "Connect" }).click();
    if (provider === "mock_store") await page.getByRole("button", { name: "I have stored it" }).click();
    await expect(page.getByTestId(`connection-${provider}`).getByText("Active")).toBeVisible();
  }
}

/** WCAG contrast ratio between a switch's track and the card behind it (canvas resolves any CSS color format). */
async function trackContrast(page: Page, provider: string) {
  return page.getByTestId(`connection-${provider}`).getByRole("switch").evaluate((track) => {
    const rgb = (color: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
    };
    const luminance = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    let surface: Element | null = track.parentElement;
    while (surface && getComputedStyle(surface).backgroundColor === "rgba(0, 0, 0, 0)") surface = surface.parentElement;
    const a = luminance(rgb(getComputedStyle(track).backgroundColor));
    const b = luminance(rgb(getComputedStyle(surface ?? document.body).backgroundColor));
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), track: rgb(getComputedStyle(track).backgroundColor) };
  });
}

test("connection switches match the Active badge, read clearly in light and dark mode, and round-trip", async ({ page }) => {
  await signUpWithOrganization(page, "Switch Regression");
  await connectAll(page);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.reload();
    for (const provider of PROVIDERS) {
      const card = page.getByTestId(`connection-${provider}`);
      await expect(card.getByText("Active")).toBeVisible();
      const toggle = card.getByRole("switch");
      await expect(toggle).toBeChecked();
      await expect(toggle).toBeEnabled();
      await expect(card.getByTestId("connection-toggle-label")).toHaveText("Enabled");
      const { ratio, track } = await trackContrast(page, provider);
      expect(ratio, `${provider} ${scheme} track contrast`).toBeGreaterThanOrEqual(3);
      expect(track[1], `${provider} ${scheme} track is green like the badge`).toBeGreaterThan(Math.max(track[0], track[2]));
    }
  }

  // Disable → badge, switch and label all agree; the other connections stay editable.
  const crm = page.getByTestId("connection-mock_crm");
  await crm.getByRole("switch").click();
  await expect(crm.getByText("Disabled", { exact: true }).first()).toBeVisible();
  await expect(crm.getByRole("switch")).not.toBeChecked();
  await expect(crm.getByTestId("connection-toggle-label")).toHaveText("Disabled");
  await expect(page.getByTestId("connection-mock_sheet").getByRole("switch")).toBeEnabled();

  await page.reload();
  await expect(crm.getByRole("switch")).not.toBeChecked();
  await crm.getByRole("switch").click();
  await expect(crm.getByText("Active")).toBeVisible();
  await expect(crm.getByRole("switch")).toBeChecked();
});

test("members join through an invite link and see a read-only view instead of greyed-out switches", async ({ page, browser }) => {
  await signUpWithOrganization(page, "Invite Link Co");
  await connectAll(page);

  const invitee = uniqueEmail("member");
  await page.getByRole("link", { name: "Team" }).click();
  await page.getByLabel("Email").fill(invitee);
  await page.getByRole("button", { name: "Invite" }).click();
  const link = await page.getByLabel("Invite link").inputValue();
  expect(link).toMatch(/\/invite\/[\w-]+$/);

  // Someone else signed in cannot use the link.
  const strangerContext = await browser.newContext();
  const stranger = await strangerContext.newPage();
  await signUpWithOrganization(stranger, "Stranger Co");
  await stranger.goto(link);
  await expect(stranger.getByText("This invitation cannot be used")).toBeVisible();
  await strangerContext.close();

  // The invitee opens the link, creates an account with the invited address and accepts.
  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await member.goto(link);
  await member.getByRole("link", { name: "Create account" }).click();
  await expect(member).toHaveURL(/\/sign-up\?next=/);
  await member.getByLabel("Name").fill("New Member");
  await member.getByLabel("Email").fill(invitee);
  await member.getByLabel("Password").fill(PASSWORD);
  await member.getByRole("button", { name: "Create account" }).click();
  await expect(member).toHaveURL(/\/invite\//);
  await expect(member.getByTestId("invitation-details")).toContainText("Invite Link Co");
  await member.getByRole("button", { name: "Accept invitation" }).click();
  await expect(member).toHaveURL(/\/dashboard/);

  await member.goto("/connections");
  for (const provider of PROVIDERS) {
    const card = member.getByTestId(`connection-${provider}`);
    await expect(card.getByText("Active")).toBeVisible();
    await expect(card.getByTestId("connection-view-only")).toBeVisible();
    await expect(card.getByRole("switch")).toHaveCount(0);
  }
  await memberContext.close();
});
