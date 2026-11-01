// Wave 7D desktop evidence: Overview "Your work" count on the demo.
// Usage: node wave7d-desktop.mjs <baseUrl> <outDir> <label>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [baseUrl, outDir, label] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
await page.goto(baseUrl);
await page.getByLabel("Provider code").fill("EVERGREEN-MO");
await page.getByLabel("Username").fill("sarah.mitchell");
await page.getByLabel("Password", { exact: true }).fill("Evergreen!demo1");
await page.getByRole("button", { name: "Sign in" }).click();
await page.getByText("Your work").waitFor({ timeout: 60_000 });
await page.waitForTimeout(1000);
const count = await page.evaluate(() => {
  const heading = [...document.querySelectorAll("h2")].find((h) =>
    h.textContent.includes("Your work"),
  );
  return heading ? heading.textContent.replace(/\s+/g, " ").trim() : "(not found)";
});
const rows = await page.evaluate(
  () => document.querySelectorAll(".personal-queue-row").length,
);
await page.screenshot({ path: `${outDir}/${label}-overview-desktop.png` });
console.log(JSON.stringify({ label, count, rows }, null, 2));
await browser.close();
