import { test, expect } from "@playwright/test";

test("priorities open their source, require evidence, and persist completion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "What needs your attention 3" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Acknowledge updated PCSP Jodie/ })
    .click();
  const dialog = page.getByRole("dialog", { name: "Requirement details" });
  await dialog
    .getByRole("button", { name: /Save completion evidence/ })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("completion record");
  await dialog
    .getByRole("button", { name: /Jodie Williams · PCSP 2026 · v2/ })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Source reference" }),
  ).toContainText("Page 12");
  await page
    .getByRole("dialog", { name: "Source reference" })
    .getByRole("button", { name: "Close dialog" })
    .click();
  await dialog
    .getByLabel("Completion evidence")
    .fill("Sample signed acknowledgment ACK-0911");
  await dialog
    .getByRole("button", { name: /Save completion evidence/ })
    .click();
  await expect(dialog).toContainText("Completion evidence recorded");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("heading", { name: "What needs your attention 2" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What needs your attention 2" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("plan approval keeps earlier versions in the document history", async ({
  page,
}) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: "Review queue 2", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Review updated supervision requirement",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Approve & activate requirement" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Earlier plan versions are retained",
  );
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByLabel("Search documents").fill("Jodie");
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasText: "v3" })).toContainText("Active");
  await expect(rows.filter({ hasText: "v2" })).toContainText("Archived");
  await expect(rows.filter({ hasText: "v1" })).toContainText("Archived");
});

test("new requirement is reviewed, assigned, approved, and exportable", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await page
    .getByRole("button", { name: "Add requirement", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Requirement", { exact: true })
    .fill("Verify sample wheelchair maintenance log");
  await dialog.getByLabel("Responsible person").selectOption("Alex Morgan");
  await dialog
    .getByLabel("Source document & version")
    .fill("Jodie Williams · PCSP 2026 · v2");
  await dialog.getByLabel("Source page").fill("14");
  await dialog.getByRole("button", { name: "Save draft for review" }).click();
  await page
    .getByRole("button", {
      name: "Verify sample wheelchair maintenance log",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Alex Morgan");
  await page
    .getByRole("button", { name: "Approve & activate requirement" })
    .click();
  await page
    .getByRole("button", { name: "Audit center NEW", exact: true })
    .click();
  await page.getByLabel("Program site").selectOption("Maple House");
  await page
    .getByRole("combobox", { name: "Individual", exact: true })
    .selectOption("Jodie Williams");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export audit register" }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe(
    "complyra-sample-audit-register.csv",
  );
  await page
    .getByRole("button", {
      name: "Verify sample wheelchair maintenance log",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Audit mode displays records without editing",
  );
  await expect(
    page.getByRole("button", { name: /Save completion/ }),
  ).toHaveCount(0);
});

test("sample plan upload creates an indexed draft without storing document bytes", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Choose sample PDF")
    .setInputFiles({
      name: "fictional-plan.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 fictional-data-for-test"),
    });
  await dialog
    .getByLabel("Requirement", { exact: true })
    .fill("Review sample transport instructions");
  await dialog.getByLabel("Document page count").fill("12");
  await dialog.getByLabel("Source page").fill("4");
  await dialog.getByRole("button", { name: "Save draft for review" }).click();
  await page
    .getByRole("button", {
      name: "Review sample transport instructions",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toContainText("v4 draft");
  const localData = await page.evaluate(() =>
    localStorage.getItem("complyra-demo-v1"),
  );
  expect(localData).not.toContain("%PDF");
});

test("search and copilot answers lead to the correct sample records", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("Search all requirements").fill("medication");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /Renew medication delegation Brandon Miller/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Taylor Reed");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: /YOUR COMPLIANCE PARTNER/ }).click();
  await page
    .getByRole("button", { name: "Which delegations are expiring?" })
    .click();
  await expect(page.locator(".copilot-answer")).toContainText(
    "2 matching requirements",
  );
  await page
    .locator(".answer-source")
    .filter({ hasText: "Renew medication delegation" })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Brandon Miller");
});

test("site scope updates readiness and mobile navigation remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByLabel("Filter by site").selectOption("Cedar House");
  await expect(
    page.getByRole("heading", { name: "No overdue requirements" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await expect(page.locator(".person-card")).toHaveCount(4);
  await page.locator(".person-card").first().click();
  await expect(
    page.getByRole("dialog", { name: "Individual compliance profile" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
