import { test, expect, type Page } from "./fixtures";

const TABS = [
  "Overview",
  "Individuals",
  "QA Review",
  "Checklists",
  "Training",
  "Medications",
  "Mileage",
  "Shift notes",
  "Staff",
] as const;

function shotPath(name: string) {
  return `${process.env.WALKTHROUGH_DIR || "/opt/cursor/artifacts/screenshots"}/${name}`;
}

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

async function closeMobileNav(page: Page) {
  const close = page.locator(".sidebar-close");
  if (await close.count()) await close.click({ force: true });
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const el = document.querySelector(".sidebar");
        if (!el) return true;
        return el.getBoundingClientRect().right <= 4;
      }),
    )
    .toBe(true);
}

async function openSiteDetail(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.locator(".sidebar").getByRole("button", { name: "Sites & programs", exact: true }).click();
  const open = page.locator(".sidebar.mobile-open");
  if (await open.isVisible()) await closeMobileNav(page);
  await page.locator(".site-grid .location-card").first().click();
  await expect(page.locator(".site-hero")).toBeVisible();
}

async function panelMetrics(page: Page) {
  return page.evaluate(() => {
    const shell = document.querySelector(".page-shell") as HTMLElement | null;
    const panel = document.querySelector(".site-detail-panel") as HTMLElement | null;
    const tabstrip = document.querySelector(".site-detail-tabs") as HTMLElement | null;
    const people = (document.body.innerText.match(/\bPeople\b/g) || []).length;
    return {
      shellOverflow: shell ? shell.scrollWidth - shell.clientWidth : 0,
      panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : 0,
      bodyOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tabWrap: tabstrip ? getComputedStyle(tabstrip).flexWrap : "",
      lastTab: tabstrip?.querySelectorAll("[role='tab']").item(tabstrip.querySelectorAll("[role='tab']").length - 1)?.textContent?.trim() ?? "",
      peopleHits: people,
      panelText: (panel?.innerText || "").slice(0, 400),
    };
  });
}

test("every site-detail tab at 1280 and 390: overflow, Staff last, no People", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const report: Array<Record<string, unknown>> = [];

  await page.setViewportSize({ width: 1280, height: 900 });
  await signIn(page);
  await openSiteDetail(page);
  await expect(page.locator(".site-detail-tabs [role='tab']").last()).toHaveText(/Staff/);

  for (const width of [1280, 390] as const) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    if (width === 390) {
      await page.addStyleTag({
        content: ".sidebar,.mobile-backdrop{transition:none!important}",
      });
      await page.locator(".site-detail-tabstrip").scrollIntoViewIfNeeded();
    }

    for (const label of TABS) {
      const tab = page.getByRole("tab", { name: label, exact: true });
      await tab.scrollIntoViewIfNeeded();
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await expect(page.locator(".site-detail-panel")).toBeVisible();
      await page.locator(".muted").filter({ hasText: "Loading" }).waitFor({ state: "hidden", timeout: 8_000 }).catch(() => undefined);
      if (label === "Overview") {
        await expect(page.locator(".site-detail-panel")).toContainText("Needs attention");
        await expect(page.locator(".site-detail-panel")).not.toContainText("Projects this home");
      }
      if (label === "Checklists") {
        // Drills nests under Checklists now (PR #86): no standalone Drills tab.
        // Assert the accordion sections exist and drills content renders clean.
        const sections = page.locator(".checklist-section-summary");
        await expect(sections.filter({ hasText: "Emergency drills" })).toHaveCount(1);
        await expect(sections.filter({ hasText: "Monthly home checks" })).toHaveCount(1);
        await expect(page.locator(".site-detail-panel")).not.toContainText("severe_weather");
        await expect(page.locator(".site-detail-panel")).not.toContainText("date not set");
        await expect(page.getByRole("button", { name: "Start weekly checklist" })).toBeVisible();
      }
      if (label === "QA Review") {
        await expect(page.locator(".site-detail-panel .empty svg")).toHaveCount(0);
        await expect(page.getByRole("button", { name: /Start review/ })).toBeVisible();
      }
      if (label === "Shift notes") {
        await expect(
          page
            .locator(".site-detail-panel")
            .getByRole("heading", { name: "Shift notes", exact: true }),
        ).toBeVisible();
      }
      const slug = label.toLowerCase().replace(/\s+/g, "_");
      await page.locator(".site-detail-panel").scrollIntoViewIfNeeded();
      const selectedBg = await tab.evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(selectedBg, `${label} @${width} selected moss`).toBe("rgb(63, 92, 59)");
      await page.screenshot({
        path: shotPath(`tab_${slug}_${width}.png`),
        fullPage: false,
      });
      const metrics = await panelMetrics(page);
      report.push({ width, label, ...metrics });
      expect(metrics.lastTab, `${label} @${width} Staff last`).toMatch(/Staff/);
      expect(metrics.peopleHits, `${label} @${width} People wording`).toBe(0);
      expect(metrics.tabWrap, `${label} @${width} nowrap tabs`).toBe("nowrap");
      expect(metrics.bodyOverflow, `${label} @${width} page overflow`).toBeLessThanOrEqual(8);
    }
  }

  console.log("TAB_AUDIT " + JSON.stringify(report, null, 2));
});
