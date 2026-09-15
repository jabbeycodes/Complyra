import { test, expect, type Page } from "./fixtures";

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

test("DPM sees an open site review and can download Cedar working copies", async ({
  page,
}) => {
  await signIn(page);
  await expect(
    page.getByRole("button", { name: /Confirm site-review checks are in place/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: /Confirm site-review checks are in place/ })
    .click();
  await expect(
    page.getByRole("heading", { name: /Site review pack · Willow House/ }),
  ).toBeVisible();
  await expect(page.getByText("Site review open")).toBeVisible();

  await page.getByLabel("Select site").selectOption("All sites");
  await page.getByRole("button", { name: "Site review pack" }).first().click();
  await expect(
    page.getByRole("heading", { name: /Site review pack · Cedar House/ }),
  ).toBeVisible();
  await expect(page.getByText("Site review in place")).toBeVisible();
  const reviewDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download site review" }).click();
  expect((await reviewDownload).suggestedFilename()).toMatch(
    /site-review-cedar-house/,
  );
  const surveyDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download pre-survey sheet" }).click();
  expect((await surveyDownload).suggestedFilename()).toMatch(
    /pre-survey-cedar-house/,
  );
});

test("chart pre-survey facts stay on the individual cover page", async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("heading", { name: "Ellis Hart" }).click();
  await expect(page.getByText("Pre-survey facts")).toBeVisible();
  await expect(page.getByLabel("Medicaid status")).toHaveValue("yes");
  await expect(
    page.getByLabel("Physician-ordered / specialized diet"),
  ).toHaveValue(/Nut allergy/);
});

test("DSP can view a site review but cannot save it", async ({ page }) => {
  await signIn(page, "alex.morgan");
  await page.getByRole("button", { name: "Sites & programs", exact: true }).click();
  await page.getByRole("button", { name: "Site review pack" }).click();
  await expect(
    page.getByRole("heading", { name: /Site review pack · Cedar House/ }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save site review" })).toHaveCount(0);
});
