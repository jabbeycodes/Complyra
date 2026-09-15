import { test, expect } from "./fixtures";

const marketing = "http://127.0.0.1:4175";
const app = "http://127.0.0.1:5174";

test.describe("marketing legal pages", () => {
  test("Privacy, Terms, and Security render with working footer links", async ({
    page,
  }) => {
    await page.goto(`${marketing}/`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Know before the auditor arrives",
    );

    for (const { path, heading, label } of [
      { path: "/privacy", heading: "Privacy Policy", label: "Privacy" },
      { path: "/terms", heading: "Terms of Service", label: "Terms" },
      { path: "/security", heading: "Security", label: "Security" },
    ]) {
      await page.locator("footer").getByRole("link", { name: label, exact: true }).first().click();
      await expect(page).toHaveURL(`${marketing}${path}`);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
      await expect(
        page.locator("footer").getByRole("link", { name: "Privacy" }).first(),
      ).toBeVisible();
      await expect(
        page.locator("footer").getByRole("link", { name: "Terms" }).first(),
      ).toBeVisible();
      await expect(
        page.locator("footer").getByRole("link", { name: "Security" }).first(),
      ).toBeVisible();
      await page.goto(`${marketing}/`);
    }
  });

  test("desktop and phone footer legal links stay usable", async ({ page }) => {
    for (const width of [1280, 390] as const) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${marketing}/`);
      const privacy = page.locator("footer").getByRole("link", { name: "Privacy" }).first();
      await expect(privacy).toBeVisible();
      await privacy.click();
      await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
    }
  });
});

test.describe("demo request path", () => {
  test("primary Book a demo CTA is the in-page form, not mailto", async ({
    page,
  }) => {
    await page.goto(`${marketing}/`);
    const html = await page.content();
    expect(html).not.toMatch(/mailto:josh@showmeworld\.app/i);
    expect(html).not.toMatch(/mailto:[^"' >]+.*Book a demo/i);

    const cta = page.locator(".hero-actions .button.primary");
    await expect(cta).toHaveAttribute("href", "#contact");
    await cta.click();
    await expect(page.locator("#demo-form")).toBeInViewport();
    await expect(page.getByRole("button", { name: "Book a demo" })).toBeVisible();
  });

  test("demo form posts to the API and shows a next step", async ({ page }) => {
    await page.goto(`${marketing}/#contact`);
    await page.getByLabel("Your name").fill("Jordan Lee");
    await page.getByLabel("Work email").fill("jordan@agency.org");
    await page.getByRole("textbox", { name: "Agency" }).fill("Cedar Ridge Supports");
    await page.getByLabel("What should we look at first?").selectOption("Delegations and signatures");
    await page.getByRole("button", { name: "Book a demo" }).click();
    await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
    await expect(
      page.getByText("jordan@agency.org", { exact: false }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Explore the interactive demo" }),
    ).toHaveAttribute("href", "https://secure.complyrer.com");
    expect(page.url()).not.toMatch(/^mailto:/i);
  });
});

test.describe("app host copies", () => {
  test("login footer opens Privacy, Terms, and Security", async ({ page }) => {
    await page.goto(app);
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Privacy" }).click();
    await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
    await page.goto(`${app}/terms`);
    await expect(page.getByRole("heading", { name: "Terms of Service" })).toBeVisible();
    await page.goto(`${app}/security`);
    await expect(page.getByRole("heading", { name: "Security" })).toBeVisible();
  });

  test("Book a demo on legal pages and login goes to /site#contact, not SPA /#contact", async ({
    page,
  }) => {
    await page.goto(`${app}/privacy`);
    const demo = page.getByRole("link", { name: "Book a demo" }).first();
    await expect(demo).toHaveAttribute("href", "/site#contact");
    await demo.click();
    await expect(page).toHaveURL(/\/site#contact$/);
    await expect(page.locator("#demo-form")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);

    await page.goto(app);
    await expect(
      page.getByRole("navigation", { name: "Legal" }).getByRole("link", { name: "Book a demo" }),
    ).toHaveAttribute("href", "/site#contact");
  });

  test("app host /site#contact submits the marketing demo form", async ({ page }) => {
    await page.goto(`${app}/site#contact`);
    await expect(page.locator("#demo-form")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toHaveCount(0);
    await page.getByLabel("Your name").fill("Jordan Lee");
    await page.getByLabel("Work email").fill("jordan@agency.org");
    await page.getByRole("textbox", { name: "Agency" }).fill("Cedar Ridge Supports");
    await page.getByLabel("What should we look at first?").selectOption("Delegations and signatures");
    await page.getByRole("button", { name: "Book a demo" }).click();
    await expect(page.getByRole("heading", { name: "Request received" })).toBeVisible();
    await expect(page.getByText("jordan@agency.org", { exact: false })).toBeVisible();
  });
});
