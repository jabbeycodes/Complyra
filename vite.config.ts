import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import demoRequestHandler from "./api/demo-request.js";

const LEGAL_PAGES = ["privacy", "terms", "security"] as const;

/** Copy marketing pages into /public so they exist on the Git-linked app host. */
function syncMarketingPages() {
  mkdirSync(resolve("public"), { recursive: true });
  for (const page of LEGAL_PAGES) {
    const from = resolve("marketing", page, "index.html");
    if (existsSync(from)) cpSync(from, resolve("public", `${page}.html`));
  }
  const css = resolve("marketing", "legal.css");
  if (existsSync(css)) cpSync(css, resolve("public", "legal.css"));
  const homepage = resolve("marketing", "index.html");
  if (existsSync(homepage)) cpSync(homepage, resolve("public", "site.html"));
}

function marketingPrettyUrls(): Plugin {
  const rewrite = (url = "") => {
    const path = url.split("?")[0];
    if (path === "/privacy" || path === "/privacy/") return "/privacy.html";
    if (path === "/terms" || path === "/terms/") return "/terms.html";
    if (path === "/security" || path === "/security/") return "/security.html";
    if (path === "/site" || path === "/site/") return "/site.html";
    return url;
  };
  const attach = (server: { middlewares: { use: Function } }) => {
    server.middlewares.use(
      (req: { url?: string }, res: unknown, next: (err?: unknown) => void) => {
        const path = req.url?.split("?")[0];
        if (path === "/api/demo-request") {
          Promise.resolve(demoRequestHandler(req, res)).catch(next);
          return;
        }
        if (req.url) req.url = rewrite(req.url);
        next();
      },
    );
  };
  return {
    name: "marketing-pretty-urls",
    configureServer(server) {
      attach(server);
    },
    configurePreviewServer(server) {
      attach(server);
    },
  };
}

syncMarketingPages();

export default defineConfig({ plugins: [react(), marketingPrettyUrls()] });
