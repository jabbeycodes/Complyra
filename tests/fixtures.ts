import { test as base, expect, type Page } from "@playwright/test";
export { expect } from "@playwright/test";
export type { Page } from "@playwright/test";

// The fictional seed is a September snapshot. Keep calendar assertions stable
// while allowing real timers and asynchronous actions to run normally.
// The instant is pinned with an explicit Central offset: the product judges
// doses on the America/Chicago agency clock, and a timezone-naive string is
// parsed in the host's local timezone (on a UTC host noon becomes 07:00 CDT
// and morning doses are still inside their window instead of overdue).
export const test = base.extend<{ sampleDate: void }>({
  sampleDate: [async ({ page }, use) => {
    await page.clock.setFixedTime(new Date("2026-09-12T12:00:00-05:00"));
    await use();
  }, { auto: true }],
});

/**
 * Mobile shell: open the MAR's person picker from the home screen.
 *
 * Medications live UNDER Health on mobile (founder directive 2026-10-31,
 * PR #189): the home screen's Medications entry opens Health, and Health's
 * "Medications — Pass meds and record doses" row opens the MAR. Specs
 * written before that change clicked Medications once and expected the
 * picker; this helper takes the current route and tolerates either.
 */
export async function openMobileMar(page: Page) {
  const picker = page.getByText("Pick the person whose medications");
  const healthRow = page.getByRole("button", { name: /Pass meds and record doses/ });
  await page.getByRole("button", { name: /Medications/ }).first().click();
  await healthRow.or(picker).first().waitFor();
  if (await healthRow.isVisible()) await healthRow.click();
  await expect(picker).toBeVisible();
}
