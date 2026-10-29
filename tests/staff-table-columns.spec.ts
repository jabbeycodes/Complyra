import { test, expect, type Page } from "./fixtures";

// D-06 / D-09 regression spec.
//
// D-06: the Staff table header renders (in order) Certificates, Assign role,
// Password, but the body rows used to render AssignRoleControl,
// ResetPasswordControl, then the Certificates "View" button — so for a viewer
// holding all three permissions every control sat under the wrong heading.
// D-09 (Staff part): a search matching nobody rendered an empty <tbody>
// directly under a "0 team members" count, with no empty-state message.
//
// The demo admin (sarah.mitchell) holds all three permissions
// (hr.view_staff / certificates.manage, members.assign_roles,
// members.reset_password). The first row of Sarah's own record is not used for
// the column assertions: ResetPasswordControl intentionally renders nothing
// for your own row and AssignRoleControl renders a static label for the
// signed-in administrator, so the assertions run on the first row after
// filtering to a non-self staff member (Alex Morgan), where all three
// controls actually render.

// Cold Vite dev-server compiles can make the first sign-in slow.
test.setTimeout(90_000);

async function signIn(page: Page, username = "sarah.mitchell") {
  await page.goto("/");
  await page.getByLabel("Provider code").fill("EVERGREEN-MO");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("banner").or(page.locator(".topbar"))).toBeVisible({
    timeout: 10_000,
  });
}

async function dismissTour(page: Page) {
  await page
    .getByRole("dialog", { name: "Interactive demo tour" })
    .waitFor({ state: "visible", timeout: 3_000 })
    .catch(() => undefined);
  await page.keyboard.press("Escape");
}

async function openStaff(page: Page) {
  await signIn(page);
  await dismissTour(page);
  const menu = page.getByRole("button", { name: "Open navigation" });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Staff", exact: true }).click();
  await expect(page.getByLabel("Search staff")).toBeVisible({
    timeout: 15_000,
  });
}

/** Index of a header cell by its exact text, within the Staff table. */
async function headerIndex(page: Page, label: string): Promise<number> {
  const headers = page.locator("table thead th");
  const texts = await headers.allTextContents();
  const index = texts.findIndex((text) => text.trim() === label);
  expect(index, `header "${label}" should exist`).toBeGreaterThanOrEqual(0);
  return index;
}

test("staff table cells sit under their matching headers (D-06)", async ({
  page,
}) => {
  await openStaff(page);

  // Filter to one non-self staff member so all three permission-gated
  // controls render in the (now first) data row.
  await page.getByLabel("Search staff").fill("Alex Morgan");
  const rows = page.locator("table tbody tr");
  await expect(rows).toHaveCount(1);
  const firstRow = rows.first();
  await expect(firstRow).toContainText("Alex Morgan");

  const cells = firstRow.locator("td");

  const certIndex = await headerIndex(page, "Certificates");
  const assignIndex = await headerIndex(page, "Assign role");
  const passwordIndex = await headerIndex(page, "Password");

  // Certificates column: the certificates "View" button.
  await expect(
    cells.nth(certIndex).getByRole("button", { name: "View", exact: true }),
  ).toBeVisible();

  // Assign role column: the role control (its selects / form).
  await expect(cells.nth(assignIndex).getByLabel("Assigned role")).toBeVisible();

  // Password column: the password reset control.
  await expect(
    cells
      .nth(passwordIndex)
      .getByRole("button", { name: "Reset password" }),
  ).toBeVisible();
});

test("staff search with no matches shows an empty state (D-09)", async ({
  page,
}) => {
  await openStaff(page);

  await page.getByLabel("Search staff").fill("zzz-no-such-staff-member");
  await expect(page.getByText("0 team members")).toBeVisible();
  await expect(page.locator("table tbody tr")).toHaveCount(0);
  // Shared <Empty> component: an empty-state message inside the same panel,
  // not just a bare empty table.
  await expect(page.locator(".panel .empty")).toBeVisible();
  await expect(page.locator(".panel .empty")).toContainText(
    /no staff|no matching|no team members/i,
  );
});
