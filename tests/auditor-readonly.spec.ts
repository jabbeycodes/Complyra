import { test, expect, type Page } from "./fixtures";

/**
 * Wave 7R (simulation batch 105): the auditor is read-only — "Auditors
 * see everything" (Joshua, 2026-09-19) with no edit/review power
 * anywhere. Batch 105 found enabled write affordances on the auditor's
 * phone pass (delegation "Open form", binder "Add contact" + "Upload
 * document", write-inviting ledger copy). This spec pins the auditor
 * matrix on the surfaces that are gated today — desktop binder, the
 * delegation form modal's internals, the Delegations page, the phone
 * MAR pass, the phone GER log, and the House Card open-month note
 * (whose wording this wave fixed) — so a future change cannot quietly
 * hand the auditor a write control again. Surfaces whose fixes ride
 * other in-flight PRs are listed in the wave 7R PR body, not pinned
 * here.
 */

async function signInAsAuditor(page: Page) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("mark.delaney");
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("banner").or(page.locator(".topbar")),
  ).toBeVisible({ timeout: 10_000 });
}

test.describe("auditor read-only matrix (wave 7R)", () => {
  test("House Card: neutral open-month note and no record form", async ({
    page,
  }) => {
    await signInAsAuditor(page);
    await page
      .getByRole("button", { name: "Sites & programs", exact: true })
      .click();
    await page.getByRole("button", { name: "Open site" }).first().click();
    await expect(
      page.getByRole("button", { name: "Back to sites" }),
    ).toBeVisible({ timeout: 15_000 });
    const houseCardTab = page.getByRole("tab", {
      name: "House Card",
      exact: true,
    });
    await expect(houseCardTab).toBeVisible({ timeout: 15_000 });
    await houseCardTab.click();
    // The ledger itself is visible (auditors read money trackers)…
    await expect(page.getByText("Card balance now")).toBeVisible();
    // …but nothing on it invites or offers recording.
    await expect(
      page.getByText("New entries can be recorded"),
    ).toHaveCount(0);
    await expect(page.getByText("Record an entry")).toHaveCount(0);
    await expect(
      page.locator(".hc-close-note"),
    ).toContainText("It has not been signed closed yet.");
  });

  test("delegation form modal: view and export only, no edit or sign controls", async ({
    page,
  }) => {
    await signInAsAuditor(page);
    await page
      .getByRole("button", { name: "Individuals", exact: true })
      .click();
    await page.getByRole("button", { name: /Ellis Hart/ }).first().click();
    const chart = page.locator(".individual-chart");
    await expect(chart.locator("h1", { hasText: "Ellis Hart" })).toBeVisible();
    await chart
      .getByRole("button", { name: "Open form" })
      .first()
      .click();
    const modal = page.locator(".modal");
    await expect(
      modal.getByRole("button", { name: /Download PDF/ }),
    ).toBeVisible({ timeout: 15_000 });
    for (const label of [
      "Edit form details",
      "Edit roster names",
      "Save roster",
      "Adopt signature",
    ]) {
      await expect(
        modal.getByRole("button", { name: new RegExp(label) }),
      ).toHaveCount(0);
    }
    await expect(
      modal.getByRole("button", { name: /Sign as/ }),
    ).toHaveCount(0);
    await expect(modal.locator("input[type='file']")).toHaveCount(0);
  });

  test("Delegations page: no create control", async ({ page }) => {
    await signInAsAuditor(page);
    await page
      .getByRole("button", { name: "Delegations", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /New delegation/ }),
    ).toHaveCount(0);
  });

  test("Employee Hub binder (desktop): no upload or contact edit", async ({
    page,
  }) => {
    await signInAsAuditor(page);
    await page
      .getByRole("button", { name: "Employee Hub", exact: true })
      .click();
    await expect(
      page.getByRole("tab", { name: "My Schedule", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    const binderTab = page.getByRole("tab", {
      name: "New Hire Binder",
      exact: true,
    });
    await expect(binderTab).toBeVisible({ timeout: 15_000 });
    await binderTab.click();
    const main = page.locator("main");
    await expect(
      main.getByRole("button", { name: /Add contact|Edit contact/ }),
    ).toHaveCount(0);
    await expect(main.locator("input[type='file']")).toHaveCount(0);
  });
});

test.describe("auditor read-only matrix — phone (wave 7R)", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  async function signInPhone(page: Page) {
    await signInAsAuditor(page);
    // The auditor has no membership home: pick Cedar House.
    await page
      .getByRole("button", { name: /Cedar House/ })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: /Medications/ }).first(),
    ).toBeVisible({ timeout: 10_000 });
  }

  test("MAR pass: dose buttons are disabled, with the reason in words", async ({
    page,
  }) => {
    await signInPhone(page);
    await page
      .getByRole("button", { name: /Medications/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Ellis Hart/ })
      .first()
      .click();
    // Pass rows are navigation; open the 8:00 AM pass…
    await page
      .getByRole("button", { name: /8:00 AM/ })
      .first()
      .click();
    // …inside it, the dose button itself is disabled for a viewer whose
    // role cannot record, and the screen says so in words.
    const doseButton = page
      .getByRole("button", { name: /Levetiracetam/ })
      .first();
    await expect(doseButton).toBeVisible();
    await expect(doseButton).toBeDisabled();
    await expect(
      page.getByText("Your role can view this pass but cannot record doses."),
    ).toBeVisible();
  });

  test("incident reports: readable, no File control", async ({ page }) => {
    await signInPhone(page);
    await page
      .getByRole("button", { name: /Quick log/ })
      .first()
      .click();
    await page
      .getByRole("button", { name: /Incident report/ })
      .first()
      .click();
    await expect(page.getByText("Recent reports")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "File an incident report" }),
    ).toHaveCount(0);
  });

  test("House Card (phone): neutral note, print only", async ({ page }) => {
    await signInPhone(page);
    await page
      .getByRole("button", { name: /House Card/ })
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "Print statement" }),
    ).toBeVisible();
    await expect(
      page.getByText("New entries can be recorded"),
    ).toHaveCount(0);
    await expect(
      page.locator(".hc-close-note"),
    ).toContainText("It has not been signed closed yet.");
  });
});
