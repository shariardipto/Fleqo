import { test as base, expect } from "@playwright/test";

/**
 * Fails a test on uncaught page errors, CSP violations or console errors.
 * "Failed to load resource" lines are ignored: tests deliberately trigger 401/403 responses,
 * which the UI handles and which Chrome logs as resource errors.
 */
export const test = base.extend<{ consoleGuard: void }>({
  consoleGuard: [
    async ({ context }, use) => {
      const problems: string[] = [];
      const watch = (page: import("@playwright/test").Page) => {
        page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
        page.on("console", (message) => {
          if (message.type() !== "error") return;
          const text = message.text();
          if (/Failed to load resource/i.test(text)) return;
          problems.push(`console: ${text}`);
        });
      };
      context.pages().forEach(watch);
      context.on("page", watch);
      await use();
      expect(problems, "browser console errors").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
