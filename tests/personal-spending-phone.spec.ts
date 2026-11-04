import { test, expect, type Page } from "./fixtures";
import { mkdirSync } from "node:fs";

/**
 * Personal Spending phone surface consistency (wave 7K, simulation
 * batch 49). On the hosted simulation the Quick log's Personal
 * Spending flow showed per-person amounts for one Juniper DSP and no
 * amounts for another DSP and the house manager at the same home:
 * the chooser list carried no amounts at all (names + home only,
 * while the Health door shows the balance on the person's row), and
 * the person view behind it collapsed "the ledgers have not loaded
 * yet" into a factual $0.00 balance and "Nothing recorded yet" —
 * the status load that feeds it loads spending last, so whether a
 * user saw amounts depended on timing, not on their role or data.
 *
 * These tests pin the repaired surface at 390px for two DSP personas
 * at two different homes: the chooser states every person's current
 * balance (untruncated), and the amount on the chooser row equals
 * the balance pin on that person's own view.
 */

const SHOT_DIR = "wave7k-shots";

async function shot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` }).catch(() => {});
}

async function signInMobile(page: Page, username: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page
    .getByText(/Today at/)
    .or(page.getByText("Select your home"))
    .first()
    .waitFor({ timeout: 30_000 });
  if (await page.getByText("Select your home").isVisible()) {
    return true;
  }
  return false;
}

async function openSpendingChooser(page: Page) {
  await page.getByRole("button", { name: /Quick log/ }).first().click();
  const tile = page.getByRole("button", { name: /Personal spending/ }).first();
  await tile.waitFor({ timeout: 15_000 });
  // Enter the flow immediately, without waiting for the tile's status
  // line to settle: the amounts must be right on this path too.
  await tile.click();
  await page.getByText("Pick the Individual").waitFor({ timeout: 10_000 });
  return page.locator(".msh-people");
}

async function chooserRow(page: Page, name: string) {
  return page.locator(".msh-people .msh-row", { hasText: name }).first();
}

async function expectChooserAmounts(
  page: Page,
  people: { name: string; balance: string }[],
) {
  for (const { name, balance } of people) {
    const row = await chooserRow(page, name);
    const amount = row.locator(".msh-row-amount");
    await expect(amount).toHaveText(balance, { timeout: 15_000 });
    // Money amounts must never truncate: the amount renders at its
    // full width, inside the row and inside the viewport.
    const metrics = await amount.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return {
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
        right: rect.right,
        viewport: window.innerWidth,
      };
    });
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
  }
}

async function pinFor(page: Page, name: string) {
  await (await chooserRow(page, name)).click();
  const pin = page.locator(".mq-pin-value");
  await expect(pin).toBeVisible({ timeout: 15_000 });
  const value = (await pin.innerText()).trim();
  await page.getByRole("button", { name: /All Individuals/ }).click();
  await page.getByText("Pick the Individual").waitFor({ timeout: 10_000 });
  return value;
}

test("willow DSP: chooser amounts match each person's balance pin", async ({
  page,
}) => {
  const needsPick = await signInMobile(page, "casey.adams");
  if (needsPick) {
    await page.getByRole("button", { name: /Willow House/ }).click();
    await page.getByText(/Today at Willow/).waitFor({ timeout: 30_000 });
  }
  await openSpendingChooser(page);
  // Read the settled pins first (the person's own view is the truth),
  // then require the chooser to state the same figures.
  const harper = await pinFor(page, "Harper Soto");
  const reese = await pinFor(page, "Reese Lang");
  expect(harper).toMatch(/^-?\$/);
  expect(reese).toMatch(/^-?\$/);
  await expectChooserAmounts(page, [
    { name: "Harper Soto", balance: harper },
    { name: "Reese Lang", balance: reese },
  ]);
  await shot(page, "after-390-casey-chooser-amounts");
});

test("cedar DSP: chooser amounts match each person's balance pin", async ({
  page,
}) => {
  const needsPick = await signInMobile(page, "alex.morgan");
  if (needsPick) {
    await page.getByRole("button", { name: /Cedar House/ }).click();
    await page.getByText(/Today at Cedar/).waitFor({ timeout: 30_000 });
  }
  await openSpendingChooser(page);
  const ellis = await pinFor(page, "Ellis Hart");
  const morgan = await pinFor(page, "Morgan Pruitt");
  expect(ellis).toMatch(/^-?\$/);
  expect(morgan).toMatch(/^-?\$/);
  await expectChooserAmounts(page, [
    { name: "Ellis Hart", balance: ellis },
    { name: "Morgan Pruitt", balance: morgan },
  ]);
  await shot(page, "after-390-alex-chooser-amounts");
});

test("person view entered before the status load lands never states a false $0.00", async ({
  page,
}) => {
  const needsPick = await signInMobile(page, "casey.adams");
  if (needsPick) {
    await page.getByRole("button", { name: /Willow House/ }).click();
    await page.getByText(/Today at Willow/).waitFor({ timeout: 30_000 });
  }
  await openSpendingChooser(page);
  // Harper Soto has a real ledger in the demo seed (pin $10.20 when
  // settled). Entering immediately must still end at her true
  // balance, and the settled view must not claim an empty ledger.
  await (await chooserRow(page, "Harper Soto")).click();
  await expect(page.locator(".mq-pin-value")).toHaveText("$10.20", {
    timeout: 15_000,
  });
  await expect(
    page.getByText("Nothing recorded in Harper Soto"),
  ).toHaveCount(0);
  await shot(page, "after-390-casey-harper-pin");
});
