import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import handler from "../marketing/api/demo-request.js";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..", "marketing");
const port = Number(process.env.PORT || 4175);

const pretty = {
  "/": "index.html",
  "/privacy": "privacy/index.html",
  "/terms": "terms/index.html",
  "/security": "security/index.html",
  "/robots.txt": "robots.txt",
  "/sitemap.xml": "sitemap.xml",
  "/legal.css": "legal.css",
  "/favicon.svg": "favicon.svg",
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}

createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/api/demo-request") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try {
      req.body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
        : {};
    } catch {
      send(res, 400, JSON.stringify({ error: "Invalid JSON" }), {
        "Content-Type": "application/json; charset=utf-8",
      });
      return;
    }
    const fake = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) {
        this.headers[key] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        send(res, this.statusCode, JSON.stringify(payload), {
          "Content-Type": "application/json; charset=utf-8",
          ...this.headers,
        });
      },
      end() {
        send(res, this.statusCode, "", this.headers);
      },
    };
    await handler(req, fake);
    return;
  }

  const relative = pretty[url.pathname] ?? decodeURIComponent(url.pathname).replace(/^\//, "");
  const file = normalize(join(root, relative));
  if (!file.startsWith(root)) {
    send(res, 403, "Forbidden");
    return;
  }
  try {
    const info = await stat(file);
    const target = info.isDirectory() ? join(file, "index.html") : file;
    const body = await readFile(target);
    send(res, 200, body, {
      "Content-Type": types[extname(target)] || "application/octet-stream",
    });
  } catch {
    send(res, 404, "Not found");
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`marketing site on http://127.0.0.1:${port}`);
});
