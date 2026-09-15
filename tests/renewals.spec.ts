import { test, expect, type Page } from "./fixtures";

async function signIn(
  page: Page,
  username: string,
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

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Your profile" }).click();
  await page.getByRole("dialog", { name: "Your profile" }).getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Provider code")).toBeVisible();
}

async function openEllis(page: Page) {
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await page.getByRole("button", { name: /Ellis Hart/ }).first().click();
  const chart = page.locator(".individual-chart");
  await expect(chart.getByRole("heading", { name: "Ellis Hart", exact: true })).toBeVisible();
  return chart;
}

async function drawSignature(page: Page) {
  const pad = page.getByLabel("Draw your signature");
  const box = await pad.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + 16, box!.y + 40);
  await page.mouse.down();
  await page.mouse.move(box!.x + 90, box!.y + 70);
  await page.mouse.up();
}

test("RN/DPM/HM see clinical dates that reset on upload, and RN signs first", async ({
  page,
}, testInfo) => {
  const shot = (name: string) =>
    `${process.env.WALKTHROUGH_DIR || testInfo.outputDir}/${name}`;
  await signIn(page, "sarah.mitchell");
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  const jodieCard = page.getByRole("button", { name: /Ellis Hart/ }).first();
  await expect(jodieCard).toContainText("Vision exam");
  await expect(jodieCard).toContainText("Annual physical");
  await expect(jodieCard).not.toContainText("Dental exam");
  await page.screenshot({
    path: shot("individuals_renewal_dates.png"),
    fullPage: true,
  });

  const chart = await openEllis(page);
  await expect(chart.getByRole("heading", { name: "Upcoming clinical renewals" })).toBeVisible();
  await expect(chart.getByRole("tab", { name: "Must acknowledge" })).toBeVisible();
  await expect(chart.getByRole("tab", { name: "Checked in plan" })).toBeVisible();
  await expect(chart.getByRole("tab")).toHaveCount(2);

  const vision = chart.locator(".renewal-card").filter({ hasText: "Vision exam" });
  const dental = chart.locator(".renewal-card").filter({ hasText: "Dental exam" });
  const dentalBefore = await dental.locator("p").first().innerText();
  await vision.getByLabel("Evidence type").selectOption("doctor_notes");
  await vision.getByLabel("Document title").fill("Optometry notes");
  await vision.getByRole("button", { name: "Upload and reset date" }).click();
  await expect(vision).toContainText("Optometry notes");
  await expect(vision).toContainText("Next due Sep 12");
  await expect(dental.locator("p").first()).toHaveText(dentalBefore);
  await vision.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: shot("vision_date_reset.png"),
  });

  const delegation = chart.locator(".plan-stack .obligation-card:not(.training-card)").filter({
    hasText: "RN delegation of specified nursing task",
  });
  await delegation.getByRole("button", { name: "Turn delegation on" }).click();
  await expect(delegation).toContainText("The delegating RN must sign this form first");
  await expect(delegation.getByRole("button", { name: "Sign as delegating RN" })).toHaveCount(0);
  await expect(delegation.getByRole("button", { name: /^Sign$/ })).toHaveCount(0);
  await delegation.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: shot("waiting_for_rn.png"),
  });
  await chart.getByRole("button", { name: "Back to individuals" }).click();

  await signOut(page);
  await signIn(page, "alex.morgan");
  await page.getByRole("button", { name: "Individuals", exact: true }).click();
  await expect(page.getByRole("button", { name: /Ellis Hart/ }).first()).not.toContainText(
    "Annual physical",
  );
  const dspChart = await openEllis(page);
  await expect(dspChart.getByRole("heading", { name: "Upcoming clinical renewals" })).toHaveCount(0);
  const dspDelegation = dspChart.locator(".plan-stack .obligation-card:not(.training-card)").filter({
    hasText: "RN delegation of specified nursing task",
  });
  await expect(dspDelegation).toContainText("Waiting for RN");
  await expect(dspDelegation.getByRole("button", { name: /^Sign$/ })).toHaveCount(0);
  await dspChart.getByRole("button", { name: "Back to individuals" }).click();

  await signOut(page);
  await signIn(page, "cameron.price");
  const rnChart = await openEllis(page);
  await expect(rnChart.getByRole("heading", { name: "Upcoming clinical renewals" })).toBeVisible();
  const rnDelegation = rnChart.locator(".plan-stack .obligation-card:not(.training-card)").filter({
    hasText: "RN delegation of specified nursing task",
  });
  await rnDelegation.getByRole("button", { name: "Adopt signature", exact: true }).click();
  const adoption = page.getByRole("dialog", { name: "Adopt your electronic signature" });
  await adoption.getByRole("tab", { name: "Type", exact: true }).nth(0).click();
  await adoption.getByRole("tab", { name: "Type", exact: true }).nth(1).click();
  await adoption.getByRole("checkbox").check();
  await adoption.getByRole("button", { name: "Adopt signature", exact: true }).click();
  await rnDelegation.getByRole("button", { name: "Sign as Cameron Price", exact: true }).click();
  await page.getByLabel("Account password").fill("Evergreen!demo1");
  await page.getByRole("button", { name: "Confirm and sign", exact: true }).click();
  await expect(rnDelegation).toContainText("Delegating RN signed");
  await rnDelegation.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: shot("rn_signed.png"),
  });
  await rnChart.getByRole("button", { name: "Back to individuals" }).click();

  await signOut(page);
  await signIn(page, "alex.morgan");
  const after = await openEllis(page);
  const afterDelegation = after.locator(".plan-stack .obligation-card:not(.training-card)").filter({
    hasText: "RN delegation of specified nursing task",
  });
  await expect(afterDelegation).toContainText("Delegating RN signed");
  await expect(afterDelegation.getByRole("button", { name: "Review" })).toBeVisible();
  await afterDelegation.getByRole("button", { name: "Review" }).click();
  await expect(afterDelegation.getByRole("button", { name: /^Sign$/ })).toBeEnabled();
});
