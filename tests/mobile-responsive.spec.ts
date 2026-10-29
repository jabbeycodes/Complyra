import { test, expect, type Page } from "./fixtures";

// Phone-width responsive pass for the desktop pages the mobile shell's
// tiles deep-link into (PR #134's shell opens these in the desktop layout
// under a "‹ Mobile home" return bar). The MAR and ISP tiles keep their
// dedicated mobile flows — those are covered by mobile-shell.spec.ts and
// are not walked here.
//
// For every page: the return bar is visible, the document does not scroll
// horizontally, and no visible element crosses the right edge of the
// viewport unless it lives inside a horizontally scrollable container
// (contained scrolling, e.g. the hub's recurring-pattern strip). Record
// content clipped by the shell counts as overflow. Screenshots land in
// mobile-screenshots-responsive/ as the after-state evidence; the same
// names with a before- prefix were captured pre-pass.
test.use({ viewport: { width: 390, height: 844 } });
test.setTimeout(300_000);

const DIR = "mobile-screenshots-responsive";
const shot = (name: string) => `${DIR}/${name}`;

async function overflowOffenders(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const iw = window.innerWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.right > iw + 1)) continue;
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      let contained = false;
      let node: HTMLElement | null = el;
      while (node && node !== document.body) {
        const ncs = getComputedStyle(node);
        if (
          (ncs.overflowX === "auto" || ncs.overflowX === "scroll") &&
          node.scrollWidth > node.clientWidth
        ) {
          contained = true;
          break;
        }
        node = node.parentElement;
      }
      if (!contained) {
        out.push(
          `${el.tagName}.${(el.className as string).toString().split(" ")[0]} right=${Math.round(r.right)} w=${Math.round(r.width)}`,
        );
      }
      if (out.length >= 8) break;
    }
    return out;
  });
}

async function expectNoOverflow(page: Page, label: string) {
  const docWidth = await page.evaluate(
    () => document.scrollingElement?.scrollWidth ?? 0,
  );
  expect(docWidth, `${label}: document scrollWidth`).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
  expect(await overflowOffenders(page), `${label}: clipped elements`).toEqual(
    [],
  );
}

async function signInToShell(page: Page) {
  await page.clock.setFixedTime(new Date("2026-09-12T13:30:00.000Z"));
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Select your home")).toBeVisible({
    timeout: 60_000,
  });
  await page.getByRole("button", { name: /Cedar House/ }).click();
  await expect(page.getByText("Today at Cedar House")).toBeVisible();
}

async function openTile(page: Page, label: RegExp) {
  await page.getByRole("button", { name: label }).first().click();
  await expect(page.locator(".mobile-return-bar")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
}

async function backHome(page: Page) {
  await page.locator(".mobile-return-bar").click();
  await expect(page.getByText("Today at Cedar House")).toBeVisible({
    timeout: 30_000,
  });
}

test("deep-linked pages lay out at phone width", async ({ page }) => {
  await signInToShell(page);

  // Employee Hub (Time Clock tile): landing + the tabs with forms/tables.
  await openTile(page, /Time Clock/);
  await expectNoOverflow(page, "employee hub");
  await page.screenshot({ path: shot("after-employee-hub.png"), fullPage: true });
  for (const [tab, name] of [
    ["Time Clock", "after-employee-hub-time-clock.png"],
    ["My Timecard", "after-employee-hub-my-timecard.png"],
    ["Time Off", "after-employee-hub-time-off.png"],
    ["Open Shifts", "after-employee-hub-open-shifts.png"],
    ["Payroll", "after-hub-payroll.png"],
  ] as const) {
    await page.getByRole("tab", { name: tab }).click();
    await page.waitForTimeout(500);
    await expectNoOverflow(page, `employee hub / ${tab}`);
    await page.screenshot({ path: shot(name), fullPage: true });
  }
  await backHome(page);

  // Appointments: month grid + a day that has visits.
  await openTile(page, /Appointments/);
  await expectNoOverflow(page, "appointments");
  await page.screenshot({ path: shot("after-appointments.png"), fullPage: true });
  await page.locator(".appointments-cell", { hasText: /^22/ }).first().click();
  await page.waitForTimeout(500);
  await expectNoOverflow(page, "appointments day list");
  await page.screenshot({
    path: shot("after-appointments-day.png"),
    fullPage: true,
  });
  await backHome(page);

  // Supply forecast (Med Count tile).
  await openTile(page, /Med Count/);
  await expectNoOverflow(page, "supply forecast");
  await page.screenshot({
    path: shot("after-supply-forecast.png"),
    fullPage: true,
  });
  await backHome(page);

  // Individuals tile -> person -> desktop chart; the shift-note score
  // table must fit the screen (it was clipped at ~1280px before the pass).
  await page.getByRole("button", { name: /Individuals/ }).first().click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  await expect(page.locator(".mobile-return-bar")).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(600);
  await expectNoOverflow(page, "individual chart");
  await page.screenshot({ path: shot("after-individual-chart.png") });
  await page.locator("#chart-shift-notes").scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const tableBox = await page
    .locator("table.clinician-note")
    .first()
    .boundingBox();
  expect(tableBox).not.toBeNull();
  expect(tableBox!.x + tableBox!.width).toBeLessThanOrEqual(390);
  await expectNoOverflow(page, "individual chart / shift notes");
  await page.screenshot({ path: shot("after-individual-chart-notes.png") });
  // One tap back: the desktop Individuals list.
  await page.getByRole("button", { name: /Back to individuals/ }).click();
  await page.waitForTimeout(600);
  await expectNoOverflow(page, "individuals list");
  await page.screenshot({
    path: shot("after-individuals-list.png"),
    fullPage: true,
  });
  await backHome(page);

  // My Tasks: a queue item lands on the chart or the Overview dashboard.
  await page.getByRole("button", { name: /My Tasks/ }).first().click();
  await page.waitForTimeout(500);
  await page.locator(".msh-list .msh-row").first().click();
  await page.waitForTimeout(800);
  await expect(page.locator(".mobile-return-bar")).toBeVisible();
  await expectNoOverflow(page, "my tasks target");
  await page.screenshot({
    path: shot("after-my-tasks-target.png"),
    fullPage: true,
  });
  await backHome(page);
});

test("weekly checklist: stacked items, sticky sign shortcut, past weeks", async ({
  page,
}) => {
  await signInToShell(page);
  await openTile(page, /Checklists/);
  await expectNoOverflow(page, "weekly checklist");
  await page.screenshot({
    path: shot("after-weekly-checklist.png"),
    fullPage: true,
  });

  // The prompt takes its own row: it is wider than the old squeezed
  // column (which measured ~110px at this viewport).
  const promptBox = await page.locator(".checklist-prompt").first().boundingBox();
  expect(promptBox).not.toBeNull();
  expect(promptBox!.width).toBeGreaterThan(250);

  // The sticky shortcut is offered to the assignee and scrolls the real
  // signature block into view.
  const bar = page.locator(".checklist-sticky-bar");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "Sign & submit" }).click();
  await page.waitForTimeout(900);
  const sigBox = await page.locator(".sig-field").first().boundingBox();
  expect(sigBox).not.toBeNull();
  expect(sigBox!.y).toBeGreaterThanOrEqual(0);
  expect(sigBox!.y).toBeLessThan(844);

  // Past weeks render as stacked cards, not a wide table.
  const pastCard = page
    .locator('[data-tour="hm-checklist"] .table-scroll tbody tr')
    .first();
  const pastBox = await pastCard.boundingBox();
  expect(pastBox).not.toBeNull();
  expect(pastBox!.x + pastBox!.width).toBeLessThanOrEqual(390);
  await expectNoOverflow(page, "weekly checklist / past weeks");
});
