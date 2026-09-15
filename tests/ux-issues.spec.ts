import { test, expect, type Page, type Locator } from "./fixtures";

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.locator('input[autocomplete="current-password"]').fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.locator(".topbar")).toBeVisible({ timeout: 10_000 });
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

async function openNewDelegationForm(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) {
    await menu.click();
  }
  await page.locator(".sidebar").getByRole("button", { name: "Delegations", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Delegations" })).toBeVisible();
  await page.getByRole("button", { name: "RN delegation forms" }).click();
  await page.getByRole("button", { name: "New delegation" }).click();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeVisible();
}

function box(locator: Locator) {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
}

function overlaps(
  a: { top: number; left: number; right: number; bottom: number },
  b: { top: number; left: number; right: number; bottom: number },
) {
  return !(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1);
}

test("new delegation fields do not overlap and Create stays visible", async ({
  page,
}) => {
  await signIn(page);
  await openNewDelegationForm(page);
  const form = page.locator("form.delegation-editor");
  const labels = form.locator("label.form-label");
  const count = await labels.count();
  expect(count).toBeGreaterThanOrEqual(5);
  const boxes = [];
  for (let i = 0; i < count; i++) boxes.push(await box(labels.nth(i)));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      expect(
        overlaps(boxes[i]!, boxes[j]!),
        `label ${i} overlaps label ${j}`,
      ).toBe(false);
    }
  }
  const create = page.getByRole("button", { name: "Create", exact: true });
  await expect(create).toBeInViewport();
  const createBox = await box(create);
  const formBox = await box(form);
  expect(createBox.bottom).toBeLessThanOrEqual(formBox.bottom + 2);
  expect(createBox.height).toBeGreaterThan(20);
});

test("new delegation stacks to one column on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await openNewDelegationForm(page);
  const individual = page.locator("form.delegation-editor label.form-label").filter({
    hasText: "Individual",
  });
  const task = page.locator("form.delegation-editor label.form-label").filter({
    hasText: "Delegated task",
  });
  const a = await box(individual);
  const b = await box(task);
  expect(overlaps(a, b)).toBe(false);
  expect(Math.abs(a.left - b.left)).toBeLessThan(8);
  const create = page.getByRole("button", { name: "Create", exact: true });
  await create.scrollIntoViewIfNeeded();
  await expect(create).toBeVisible();
  const createBox = await box(create);
  expect(createBox.height).toBeGreaterThan(20);
  expect(createBox.width).toBeGreaterThan(20);
});

test("profile modal does not grow a horizontal scrollbar", async ({ page }) => {
  await signIn(page);
  await page.getByRole("button", { name: "Your profile" }).click();
  const dialog = page.getByRole("dialog", { name: "Your profile" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Electronic signature" })).toBeVisible();
  const overflow = await dialog.locator(".modal-body").evaluate((el) => ({
    client: el.clientWidth,
    scroll: el.scrollWidth,
  }));
  expect(overflow.scroll).toBeLessThanOrEqual(overflow.client + 1);
});

test("searching Jodie does not list five identical current PCSP rows", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("Search all requirements").fill("Jodie");
  const results = page.locator(".search-results > button");
  await expect(results.first()).toBeVisible();
  const count = await results.count();
  expect(count).toBeGreaterThan(0);
  expect(count).toBeLessThanOrEqual(6);
  const labels = await results.allTextContents();
  const current = labels.filter((text) => text.includes("Acknowledge current PCSP"));
  expect(current.length).toBeLessThan(5);
  expect(new Set(labels.map((text) => text.replace(/\s+/g, " ").trim())).size).toBe(
    labels.length,
  );
  await expect(results.first().locator(".search-meta")).toBeVisible();
  await results.first().click();
  await expect(
    page.getByRole("dialog", { name: "Requirement details" }),
  ).toBeVisible();
});

test("search empty state copy is unchanged", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Search all requirements").fill("zzzz-no-such-record");
  await expect(page.locator(".search-results p")).toHaveText(
    "No matching records. Try a name or site.",
  );
});
