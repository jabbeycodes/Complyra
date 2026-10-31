import { defineConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
process.env.WALKTHROUGH_DIR ??= resolve("playwright-report/screenshots");
mkdirSync(process.env.WALKTHROUGH_DIR, { recursive: true });
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  use: {
    baseURL: "http://127.0.0.1:5174",
    viewport: { width: 1440, height: 1050 },
    headless: true,
  },
  webServer: [
    {
      // Serve the production build, not the Vite dev server. Under the
      // dev server every navigation re-transforms the whole module
      // graph on demand; with CI's --workers=2 on a small runner that
      // made first paints take seconds-to-minutes and flaked dozens of
      // specs at their first interaction (sign-in fields, drawer
      // clicks, "element is not stable" loops). The Verify workflow
      // already builds the app before e2e; building here too keeps a
      // local `npm run test:e2e` self-contained and testing the same
      // bundle users get. The blank Supabase env (demo/LocalApi mode)
      // is baked in at build time via this env block.
      command: "npm run build && npm run preview -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 300_000,
      env: {
        ...process.env,
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_ANON_KEY: "",
      },
    },
    {
      command: "node scripts/serve-marketing.mjs",
      url: "http://127.0.0.1:4175",
      reuseExistingServer: false,
    },
  ],
  reporter: "list",
});
