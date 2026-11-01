import { test, expect, type Page } from "./fixtures";

// Wave 7L probe: the Quick log's House Card screen must state the
// same balance the chooser tile states once loaded — never a
// $0.00 pin standing in for a ledger that has not loaded. The
// not-loaded frame itself is not reproducible in the demo (the
// in-browser LocalApi resolves immediately, and the screen is
// seeded from the chooser's already-loaded ledger); that state is
// pinned by the render tests in
// src/features/mobile/quickLogHouseCard.test.tsx. This spec pins
// the loaded behavior at phone width, tile ↔ screen agreement
// included.
test.setTimeout(180_000);

async function signInAsDsp(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("alex.morgan");
  await page
    .locator('input[autocomplete="current-password"]')
    .fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Multi-home users get the home picker first; Alex Morgan is a
  // single-home (Cedar) DSP and lands in the shell home directly.
  const picker = page.getByText("Select your home");
  try {
    await picker.waitFor({ timeout: 5_000 });
    await page.getByRole("button", { name: /Cedar House/ }).click();
  } catch {
    // Single-home landing: already in the shell home.
  }
  await expect(page.getByRole("heading", { name: /Today at/ })).toBeVisible({
    timeout: 30_000,
  });
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

test("quick log house card screen agrees with its tile at 390px", async ({
  page,
}, testInfo) => {
  const shot = (name: string) =>
    `${process.env.WALKTHROUGH_DIR || testInfo.outputDir}/${name}`;
  await signInAsDsp(page);

  await page.getByRole("button", { name: /Quick log/ }).first().click();
  const houseTile = page.locator(".ql-tile", { hasText: "House card" });
  await expect(houseTile).toBeVisible({ timeout: 15_000 });
  // Wait for the tile's own load to land, then take its figure as
  // the truth the screen must agree with.
  await expect(houseTile.locator(".ql-tile-status")).not.toHaveText(
    "Loading…",
    { timeout: 15_000 },
  );
  const tileText = await houseTile.locator(".ql-tile-status").innerText();
  const tileBalance = tileText.match(/\$[\d,]+\.\d{2}/)?.[0];
  expect(tileBalance, `tile states a balance: ${tileText}`).toBeTruthy();

  await houseTile.click();
  const pin = page.locator(".mq-pin-value");
  await expect(pin).toBeVisible({ timeout: 15_000 });
  await expect(pin).toHaveText(tileBalance!);
  await expect(
    page.getByText("Loading the house card ledger…"),
  ).toHaveCount(0);
  await page.screenshot({ path: shot("house-card-quicklog-390.png") });

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth);
});
