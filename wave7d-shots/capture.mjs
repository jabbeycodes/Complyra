// Wave 7D screenshot + count evidence (not part of the test suites).
// Usage: node wave7d-shots.mjs <baseUrl> <outDir> <label>
// Signs in to the Evergreen demo as the administrator, picks Cedar
// House on the mobile shell, and records: the greeting task sentence,
// the bottom-nav Tasks badge, and the My Tasks row count — the three
// numbers batches 61/65 found in disagreement.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [baseUrl, outDir, label] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
});
if (process.env.SHOT_NOW !== "none") {
  await page.clock.setFixedTime(
    new Date(process.env.SHOT_NOW ?? "2026-09-12T13:30:00.000Z"),
  );
}
await page.goto(baseUrl);
const username = process.env.SHOT_USER ?? "sarah.mitchell";
const homeName = process.env.SHOT_HOME ?? "Cedar House";
await page.getByLabel("Provider code").fill("EVERGREEN-MO");
await page.getByLabel("Username").fill(username);
await page
  .getByLabel("Password", { exact: true })
  .fill("Evergreen!demo1");
await page.getByRole("button", { name: "Sign in" }).click();
// Multi-home users land on the home picker; single-home users go
// straight to their home. Handle both.
const picker = page.getByText("Select your home");
const homeHeading = page.getByRole("heading", { name: /Today at/ });
await Promise.race([
  picker.waitFor({ timeout: 60_000 }),
  homeHeading.waitFor({ timeout: 60_000 }),
]);
if (await picker.isVisible()) {
  await page.getByRole("button", { name: new RegExp(homeName) }).click();
}
await page
  .getByRole("heading", { name: `Today at ${homeName}` })
  .waitFor({ timeout: 60_000 });
await page.waitForTimeout(1500);

const greeting = await page.evaluate(() => {
  const text = document.body.innerText.replace(/\s+/g, " ");
  const match = text.match(
    /\d+ of your \d+ tasks are at [A-Za-z ]+ House|\d+ tasks? due for you/,
  );
  return match ? match[0] : "(no task sentence found)";
});
const badge = await page.evaluate(() => {
  const el = document.querySelector(".msh-nav-badge");
  return el ? el.textContent.trim() : "(no badge)";
});
await page.screenshot({ path: `${outDir}/${label}-home-390.png` });

// My Tasks: count the rendered rows.
await page.getByRole("button", { name: "Tasks", exact: true }).click();
await page.getByText("Your due and priority work").waitFor({ timeout: 30_000 });
await page.waitForTimeout(500);
const taskRows = await page.evaluate(
  () => document.querySelectorAll(".msh-list .msh-row").length,
);
const taskTitles = await page.evaluate(() =>
  [...document.querySelectorAll(".msh-list .msh-row strong")].map((el) =>
    el.textContent.trim(),
  ),
);
await page.screenshot({ path: `${outDir}/${label}-tasks-390.png` });

console.log(
  JSON.stringify({ label, greeting, badge, taskRows, taskTitles }, null, 2),
);
await browser.close();
