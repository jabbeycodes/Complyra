import { test as base } from "@playwright/test";
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
 * Open one Individual's MAR in the phone shell. Since #189 medications live
 * UNDER Health on mobile: the home's Medications door opens the Health
 * person picker, and the MAR is the Medications row inside that person's
 * Health screen. Every spec goes through here so a future nav change is a
 * one-line fix.
 */
export async function openPersonMar(page: import("@playwright/test").Page, personName: string | RegExp) {
  await page.getByRole("button", { name: /Medications/ }).first().click();
  await page
    .getByRole("button", { name: typeof personName === "string" ? new RegExp(personName) : personName })
    .first()
    .click();
  // From the person's Health view the MAR opens on that same person
  // (wave 1: no second person picker).
  const marRow = page.getByRole("button", { name: /^Medications Pass meds/ });
  if (await marRow.isVisible().catch(() => false)) await marRow.click();
}
