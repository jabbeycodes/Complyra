import { test, expect, type Page } from "./fixtures";
import { mkdirSync } from "node:fs";

/**
 * Chart tabs repair (wave 7A). On the Individual chart the 12-tab health
 * tracker strip was an unbounded flex row: it painted across the
 * neighbouring Behavior column and off the page edge, crushing buttons to
 * word-width ribbons and leaving tabs under the spill unclickable; the
 * Consents register table forced the whole phone-width chart column to
 * 552px so every widget clipped; and PRN form labels ran together inline
 * on desktop. These tests pin the repaired behaviour: the strip stays
 * inside its widget at desktop and phone widths, exactly one tab is
 * selected and exactly its panel renders (tracker tabs and the plan-stack
 * "Must acknowledge" / "Checked in plan" tabs), hit tests land on the tab
 * itself, wide tables scroll inside their panel, and PRN labels stack.
 */

const SHOT_DIR = "wave7a-shots";

async function shot(page: Page, name: string) {
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png` }).catch(() => {});
}

async function signIn(page: Page) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("banner").or(page.locator(".topbar")),
  ).toBeVisible({ timeout: 15_000 });
}

async function openEllisChartDesktop(page: Page) {
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: /Ellis Hart/ }).first().click();
  const chart = page.locator(".individual-chart");
  await expect(
    chart.getByRole("heading", { name: "Trackers and logs" }),
  ).toBeVisible();
  return chart;
}

async function openEllisChartMobile(page: Page) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("sarah.mitchell");
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByText("Select your home").waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /Cedar House/ }).click();
  await page.getByText("Today at Cedar House").waitFor({ timeout: 30_000 });
  await page
    .getByRole("button", { name: /Individuals/ })
    .first()
    .click();
  await page.getByRole("button", { name: /Ellis Hart/ }).click();
  const chart = page.locator(".individual-chart");
  await expect(
    chart.getByRole("heading", { name: "Trackers and logs" }),
  ).toBeVisible({ timeout: 30_000 });
  return chart;
}

/** Labels of the tabs marked selected inside one tablist. */
async function selectedLabels(tablist: ReturnType<Page["locator"]>) {
  return tablist
    .getByRole("tab")
    .evaluateAll((tabs) =>
      tabs
        .filter((t) => t.getAttribute("aria-selected") === "true")
        .map((t) => (t.textContent ?? "").trim()),
    );
}

test.describe("chart tracker tabs — desktop", () => {
  test("strip stays inside its widget, no tab is covered, one tab one panel", async ({
    page,
  }) => {
    await signIn(page);
    const chart = await openEllisChartDesktop(page);
    const widget = chart.locator(".health-track-widget");
    const tablist = chart.getByRole("tablist", { name: "Health trackers" });
    const tabs = tablist.getByRole("tab");
    await expect(tabs).toHaveCount(12);

    // Bounding-box containment: strip and every tab inside the widget box,
    // tabs at natural height (the broken layout crushed them into tall
    // word-per-line ribbons up to ~104px).
    const widgetBox = await widget.boundingBox();
    const stripBox = await tablist.boundingBox();
    expect(widgetBox).not.toBeNull();
    expect(stripBox).not.toBeNull();
    expect(stripBox!.x).toBeGreaterThanOrEqual(widgetBox!.x - 1);
    expect(stripBox!.x + stripBox!.width).toBeLessThanOrEqual(
      widgetBox!.x + widgetBox!.width + 1,
    );
    const tabBoxes = await tabs.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { h: r.height, clipped: el.scrollWidth > el.clientWidth + 1 };
      }),
    );
    for (const b of tabBoxes) {
      expect(b.h).toBeLessThanOrEqual(56);
      expect(b.clipped).toBe(false);
    }

    // Hit test: the centre of every tab is the tab itself — nothing (in
    // particular not the neighbouring Behavior column) paints over it.
    // Centre the strip in the viewport first so every wrapped row is
    // inside the hit-testable area.
    await tablist.evaluate((el) =>
      el.scrollIntoView({ block: "center" }),
    );
    await page.waitForTimeout(300);
    const covered = await tabs.evaluateAll((els) =>
      els
        .map((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(
            r.left + r.width / 2,
            r.top + r.height / 2,
          );
          return hit === el || el.contains(hit)
            ? null
            : (el.textContent ?? "").trim();
        })
        .filter(Boolean),
    );
    expect(covered).toEqual([]);
    await shot(page, "after-desktop-chart-tabs");

    // One tab → exactly that tab selected, exactly its panel rendered.
    const panel = chart.locator("#health-track-panel");
    await tabs.filter({ hasText: "Respiratory" }).click();
    expect(await selectedLabels(tablist)).toEqual(["Respiratory"]);
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      "health-track-tab-respiratory",
    );
    await expect(panel.getByText("Treatment", { exact: true })).toBeVisible();
    await expect(widget.getByRole("tabpanel")).toHaveCount(1);

    await tabs.filter({ hasText: "Intake — meals & fluids" }).click();
    expect(await selectedLabels(tablist)).toEqual([
      "Intake — meals & fluids",
    ]);
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      "health-track-tab-intake",
    );
    await expect(panel.getByText("Meal or fluid")).toBeVisible();
    // No residue of the previously open panel stacked underneath.
    await expect(panel.getByText("Treatment", { exact: true })).toHaveCount(0);
  });

  test("plan document tabs render their own lists, not the tracker panel", async ({
    page,
  }) => {
    await signIn(page);
    const chart = await openEllisChartDesktop(page);
    const stack = chart.locator(".plan-stack");
    const tablist = stack.getByRole("tablist", {
      name: "Plan document sections",
    });
    await tablist.scrollIntoViewIfNeeded();

    expect(await selectedLabels(tablist)).toEqual(["Must acknowledge"]);
    await expect(stack.locator(".obligation-list")).toBeVisible();
    await expect(
      stack.getByText("These sections were found in the plan."),
    ).toHaveCount(0);

    await tablist.getByRole("tab", { name: "Checked in plan" }).click();
    expect(await selectedLabels(tablist)).toEqual(["Checked in plan"]);
    await expect(
      stack.getByText("These sections were found in the plan."),
    ).toBeVisible();
    // The checked list is its own panel — no health-tracker content bleeds
    // into it (the reported "Checked in plan shows the Respiratory table").
    await expect(stack.getByText("Treatment", { exact: true })).toHaveCount(0);
    await expect(stack.getByText("Vaccine", { exact: true })).toHaveCount(0);

    await tablist.getByRole("tab", { name: "Must acknowledge" }).click();
    expect(await selectedLabels(tablist)).toEqual(["Must acknowledge"]);
    await expect(
      stack.getByText("These sections were found in the plan."),
    ).toHaveCount(0);
    await expect(stack.locator(".obligation-list")).toBeVisible();
  });

  test("PRN form labels stack above their controls on desktop", async ({
    page,
  }) => {
    await signIn(page);
    const chart = await openEllisChartDesktop(page);
    const form = chart.locator("form.stack").first();
    await form.scrollIntoViewIfNeeded();
    const styles = await form.evaluate((el) => {
      const label = el.querySelector("label");
      return {
        form: getComputedStyle(el).display,
        label: label ? getComputedStyle(label).display : null,
      };
    });
    expect(styles.form).toBe("grid");
    expect(styles.label).toBe("grid");
    // The control inside the first label starts below the label's text,
    // not run together on the same inline line.
    const geometry = await form.evaluate((el) => {
      const label = el.querySelector("label");
      const control = label?.querySelector("input, textarea, select");
      if (!label || !control) return null;
      const lr = label.getBoundingClientRect();
      const cr = control.getBoundingClientRect();
      return { labelTop: lr.top, controlTop: cr.top, controlLeft: cr.left, labelLeft: lr.left };
    });
    expect(geometry).not.toBeNull();
    expect(geometry!.controlTop).toBeGreaterThan(geometry!.labelTop + 8);
    expect(Math.abs(geometry!.controlLeft - geometry!.labelLeft)).toBeLessThan(2);
  });
});

for (const width of [390, 544]) {
  test.describe(`chart tracker tabs — phone ${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });

    test("chart fits the viewport, tables scroll inside panels, tabs switch panels", async ({
      page,
    }) => {
      const chart = await openEllisChartMobile(page);

      // The chart column must size to the phone, not to the widest table:
      // no element may paint past the viewport (contained scroll regions
      // excepted — their content is clipped by their own box).
      const overflow = await page.evaluate((w) => {
        const skip = (el: Element) => {
          for (let n: Element | null = el; n; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (
              n instanceof HTMLElement &&
              (cs.overflowX === "auto" || cs.overflowX === "scroll") &&
              n.getBoundingClientRect().right <= w + 1
            )
              return true;
            if (cs.display === "none" || cs.visibility === "hidden")
              return true;
          }
          return false;
        };
        const bad: string[] = [];
        document.querySelectorAll("*").forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width > 0 && r.right > w + 1 && !skip(el))
            bad.push(
              `${el.tagName}.${(el as HTMLElement).className?.toString().split(" ")[0] ?? ""} right=${Math.round(r.right)}`,
            );
        });
        return {
          docScrollWidth: document.documentElement.scrollWidth,
          bad: bad.slice(0, 8),
        };
      }, width);
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(width + 1);
      expect(overflow.bad).toEqual([]);

      // Personal Spending: the 620px ledger table scrolls INSIDE its wrap;
      // the wrap itself never crosses the viewport edge.
      const wrap = chart.locator(".ps-table-wrap").first();
      await wrap.scrollIntoViewIfNeeded();
      const wrapBox = await wrap.boundingBox();
      expect(wrapBox).not.toBeNull();
      expect(wrapBox!.x + wrapBox!.width).toBeLessThanOrEqual(width + 1);
      const ps = await wrap.evaluate((el) => ({
        clientW: el.clientWidth,
        scrollW: el.scrollWidth,
      }));
      expect(ps.scrollW).toBeGreaterThan(ps.clientW);

      // Tracker strip is contained in its widget and still switches panels;
      // Playwright scrolls the strip itself to reach the Vitals tab.
      const widget = chart.locator(".health-track-widget");
      const tablist = chart.getByRole("tablist", { name: "Health trackers" });
      await tablist.scrollIntoViewIfNeeded();
      const widgetBox = await widget.boundingBox();
      const stripBox = await tablist.boundingBox();
      expect(stripBox!.x).toBeGreaterThanOrEqual(widgetBox!.x - 1);
      expect(stripBox!.x + stripBox!.width).toBeLessThanOrEqual(
        widgetBox!.x + widgetBox!.width + 1,
      );
      await tablist.getByRole("tab", { name: "Vitals" }).click();
      expect(await selectedLabels(tablist)).toEqual(["Vitals"]);
      await expect(chart.locator("#health-track-panel")).toHaveAttribute(
        "aria-labelledby",
        "health-track-tab-vitals",
      );
      await shot(page, `after-phone${width}-chart-tabs`);
    });
  });
}
