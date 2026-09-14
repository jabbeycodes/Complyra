import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const LEGAL_PAGES = ["privacy", "terms", "security"] as const;

/** Copy marketing legal pages into /public so they exist on the app host too. */
function syncMarketingLegalPages() {
  mkdirSync(resolve("public"), { recursive: true });
  for (const page of LEGAL_PAGES) {
    const from = resolve("marketing", page, "index.html");
    if (existsSync(from)) cpSync(from, resolve("public", `${page}.html`));
  }
  const css = resolve("marketing", "legal.css");
  if (existsSync(css)) cpSync(css, resolve("public", "legal.css"));
}

function legalPrettyUrls(): Plugin {
  const rewrite = (url = "") => {
    const path = url.split("?")[0];
    if (path === "/privacy" || path === "/privacy/") return "/privacy.html";
    if (path === "/terms" || path === "/terms/") return "/terms.html";
    if (path === "/security" || path === "/security/") return "/security.html";
    return url;
  };
  return {
    name: "legal-pretty-urls",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) req.url = rewrite(req.url);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url) req.url = rewrite(req.url);
        next();
      });
    },
  };
}

syncMarketingLegalPages();

export default defineConfig({ plugins: [react(), legalPrettyUrls()] });
