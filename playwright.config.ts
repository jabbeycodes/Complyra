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
      command: "npm run dev -- --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
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
