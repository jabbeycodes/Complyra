import { test, expect, type Page } from "./fixtures";

async function signIn(
  page: Page,
  username = "sarah.mitchell",
  password = "Evergreen!demo1",
  agencyCode = "EVERGREEN-MO",
) {
  await page.goto("/");
  await page.getByLabel("Provider code").fill(agencyCode);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
}

test("priorities open their source, require evidence, and persist completion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Needs attention 3" }),
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
  await page.getByRole("dialog", { name: "Mark this requirement complete?" }).getByRole("button", { name: "Save completion", exact: true }).click();
  await expect(dialog).toContainText("Completion evidence recorded");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("heading", { name: "Needs attention 2" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Needs attention 2" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("plan approval keeps earlier versions in the document history", async ({
  page,
}) => {
  await signIn(page);
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
  await page.getByRole("dialog", { name: "Approve this requirement?" }).getByRole("button", { name: "Approve & activate", exact: true }).click();
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
  await signIn(page);
  await page.getByRole("button", { name: "Requirements", exact: true }).click();
  await page
    .getByRole("button", { name: "Add requirement", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Program site").selectOption({ label: "Maple House" });
  await dialog.getByLabel("Individual", { exact: true }).selectOption({ label: "Jodie Williams" });
  await dialog
    .getByLabel("Requirement", { exact: true })
    .fill("Verify sample wheelchair maintenance log");
  await dialog.getByLabel("Responsible person").selectOption({ label: "Alex Morgan" });
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
  await page.getByRole("dialog", { name: "Approve this requirement?" }).getByRole("button", { name: "Approve & activate", exact: true }).click();
  await page
    .getByRole("button", { name: "Audit center", exact: true })
    .click();
  await page.getByLabel("Program site").selectOption("Maple House");
  await page
    .getByRole("combobox", { name: "Individual", exact: true })
    .selectOption("Jodie Williams");
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export audit register" }).click();
  const download = await dl;
  expect(download.suggestedFilename()).toBe(
    "complyrer-sample-audit-register.csv",
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

test("sample plan upload retains its PDF separately and creates an indexed draft", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Documents", exact: true }).click();
  await page.getByRole("button", { name: "Add document", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Program site").selectOption({ label: "Maple House" });
  await dialog.getByLabel("Individual", { exact: true }).selectOption({ label: "Jodie Williams" });
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
    localStorage.getItem("complyra-v2-meta"),
  );
  expect(localData).not.toContain("%PDF");
});

test("search and copilot answers lead to the correct sample records", async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel("Search all requirements").fill("medication");
  await page
    .locator(".search-results")
    .getByRole("button", { name: /Renew medication delegation Brandon Miller/ })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Taylor Reed");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Records Ask Complyrer", exact: true }).click();
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
  await signIn(page);
  await page.getByLabel("Filter by site").selectOption("Oakwood House");
  await expect(
    page.getByRole("heading", { name: "No overdue items" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await expect(page.locator(".person-card")).toHaveCount(2);
  await page.locator(".person-card").first().click();
  await expect(page.locator(".individual-chart")).toBeVisible();
  await expect(page.getByRole("button", { name: "Back to individuals" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("acknowledgment sheet lists assigned staff and exports one PDF", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: /Acknowledgments/ }).click();
  await page.getByRole("button", { name: "Jodie Williams", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "PCSP acknowledgment sheet" });
  await expect(sheet).toContainText("Alex Morgan");
  await expect(sheet).toContainText("Pending");
  await expect(sheet).toContainText("Sarah Mitchell");
  const download = page.waitForEvent("download");
  await sheet
    .getByRole("button", { name: "Export acknowledgment sheet" })
    .click();
  expect((await download).suggestedFilename()).toMatch(
    /complyrer-acknowledgment-jodie-williams/,
  );
});

test("a DSP cannot add or approve requirements", async ({ page }) => {
  await signIn(page, "alex.morgan");
  await expect(
    page.getByRole("button", { name: "Add requirement", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: /Acknowledgments/ }).click();
  await page.getByRole("button", { name: "Jodie Williams", exact: true }).click();
  await expect(
    page.getByRole("dialog"),
  ).toContainText("Your signature");
});

test("an administrator adds a member who must change the temporary password", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page.getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a member" });
  await dialog.getByLabel("Full name").fill("Jordan Blake");
  await dialog.getByLabel("Username").fill("jordan.blake");
  await dialog.getByLabel("Temporary password").fill("TempPass!1");
  await dialog.getByRole("button", { name: "Create member account" }).click();
  await expect(dialog).toContainText("EVERGREEN-MO");
  await expect(dialog).toContainText("jordan.blake");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("jordan.blake");
  await page.getByLabel("Password", { exact: true }).fill("TempPass!1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your own password" }),
  ).toBeVisible();
  await page.getByLabel("Temporary password").fill("TempPass!1");
  await page.getByLabel("New password", { exact: true }).fill("Jordan!own2");
  await page.getByLabel("Confirm new password").fill("Jordan!own2");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
});

test("an administrator can open role templates and invite HR without care records", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Roles & access", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Roles & access" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /HM House manager/ }).click();
  await expect(page.getByRole("heading", { name: "House manager" })).toBeVisible();
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await page.getByRole("button", { name: "Add member" }).click();
  const dialog = page.getByRole("dialog", { name: "Add a member" });
  await dialog.getByLabel("Full name").fill("Riley Hart");
  await dialog.getByLabel("Username").fill("riley.hart");
  await dialog.getByLabel("Temporary password").fill("TempPass!1");
  await dialog.getByLabel("Role").selectOption("hr");
  await dialog.getByRole("button", { name: "Create member account" }).click();
  await expect(dialog).toContainText("riley.hart");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill("riley.hart");
  await page.getByLabel("Password", { exact: true }).fill("TempPass!1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your own password" }),
  ).toBeVisible();
  await page.getByLabel("Temporary password").fill("TempPass!1");
  await page.getByLabel("New password", { exact: true }).fill("Riley!own2");
  await page.getByLabel("Confirm new password").fill("Riley!own2");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: "Staff", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Individuals", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Acknowledgments" }),
  ).toHaveCount(0);
});

test("an agency can set itself up with a state agency code", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Set up an agency" }).click();
  await page.getByLabel("Agency name").fill("Maplewood Homes");
  await page.getByLabel("Home state").selectOption("MO");
  await page.getByLabel("Short name for the provider code").fill("maplewood");
  await page.getByLabel("First administrator name").fill("Pat Okonkwo");
  await page.getByLabel("Username").fill("pat.okonkwo");
  await page.getByLabel("Temporary password").fill("TempPass!1");
  await page.getByRole("button", { name: "Submit agency" }).click();
  await expect(page.getByRole("heading", { name: "Submitted for review" })).toBeVisible();
  await expect(page.getByText("MAPLEWOOD-MO", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Continue to sign in" }).click();
  await expect(page.getByLabel("Provider code")).toHaveValue("MAPLEWOOD-MO");
  await page.getByLabel("Password", { exact: true }).fill("TempPass!1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByRole("heading", { name: "Choose your own password" }),
  ).toBeVisible();
  await page.getByLabel("Temporary password").fill("TempPass!1");
  await page.getByLabel("New password", { exact: true }).fill("Pat!own2");
  await page.getByLabel("Confirm new password").fill("Pat!own2");
  await page.getByRole("button", { name: "Save new password" }).click();
  await expect(
    page.getByRole("heading", { name: "Waiting for Complyrer review" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByLabel("Provider code").fill("COMPLYRER-MO");
  await page.getByLabel("Username").fill("platform.owner");
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Platform", exact: true }).click();
  await expect(page.getByText("MAPLEWOOD-MO")).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).click();
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("button", { name: "Sign out" }).click();
  await page.getByLabel("Provider code").fill("MAPLEWOOD-MO");
  await page.getByLabel("Username").fill("pat.okonkwo");
  await page.getByLabel("Password", { exact: true }).fill("Pat!own2");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
});

test("overview shows agency scores, assigned site cards, and personal work", async ({
  page,
}) => {
  await signIn(page);
  await expect(page.getByText("Agency current")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Agency compliance" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Maple House compliance/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Oakwood House compliance/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Oakwood House compliance/ }).click();
  await expect(
    page.getByRole("heading", { name: "No overdue items" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: /Your work/ })).toBeVisible();
  await page.getByLabel("Filter by site").selectOption("All sites");
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await expect(page.locator(".location-card")).toHaveCount(2);
  await expect(page.locator(".site-grid")).toBeVisible();

  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("button", { name: "Sign out" }).click();
  await signIn(page, "alex.morgan");
  await expect(
    page.getByRole("button", { name: /Maple House compliance/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Oakwood House compliance/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Your work/ })).toBeVisible();
  await expect(page.locator(".personal-queue-row").first()).toBeVisible();
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await expect(page.locator(".location-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Maple House" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Oakwood House" })).toHaveCount(0);
});
