import { test as base } from "@playwright/test";
export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";

// The fictional seed is a September snapshot. Keep calendar assertions stable
// while allowing real timers and asynchronous actions to run normally.
export const test = base.extend<{ sampleDate: void }>({
  sampleDate: [async ({ page }, use) => {
    await page.clock.setFixedTime(new Date("2026-09-12T12:00:00"));
    await use();
  }, { auto: true }],
});
