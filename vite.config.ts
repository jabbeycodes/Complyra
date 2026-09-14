import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

/** Copy marketing legal pages into /public so /privacy /terms /security also work on the app host. */
function syncMarketingLegalPages() {
  const pages = ["privacy", "terms", "security"];
  for (const page of pages) {
    const from = resolve("marketing", page);
    if (!existsSync(from)) continue;
    const to = resolve("public", page);
    mkdirSync(resolve("public"), { recursive: true });
    cpSync(from, to, { recursive: true });
  }
  for (const file of ["legal.css", "favicon.svg"]) {
    const from = resolve("marketing", file);
    if (existsSync(from) && file === "legal.css") {
      cpSync(from, resolve("public", file));
    }
  }
}

syncMarketingLegalPages();

export default defineConfig({ plugins: [react()] });
