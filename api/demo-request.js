/**
 * Demo requests for the app Vercel host (`/api/demo-request`).
 * Keep in sync with marketing/api/demo-request.js (marketing-only project).
 *
 * If RESEND_API_KEY is set, email hello@ (or DEMO_REQUEST_TO).
 * Otherwise the structured log is the operator inbox until mail is wired.
 */
export default async function handler(req, res) {
  setHeader(res, "Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    send(res, 204);
    return;
  }
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const input = await readBody(req);
  if (typeof input.company_website === "string" && input.company_website.trim()) {
    sendJson(res, 200, { ok: true });
    return;
  }

  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const agency = String(input.agency ?? "").trim();
  const interest = String(input.interest ?? "").trim() || "Audit readiness";

  if (name.length < 2 || name.length > 120) {
    sendJson(res, 400, { error: "Enter your name." });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) {
    sendJson(res, 400, { error: "Enter a work email." });
    return;
  }
  if (agency.length < 2 || agency.length > 180) {
    sendJson(res, 400, { error: "Enter the agency name." });
    return;
  }

  const payload = {
    type: "demo_request",
    name,
    email,
    agency,
    interest,
    receivedAt: new Date().toISOString(),
  };
  console.log(JSON.stringify(payload));

  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DEMO_REQUEST_TO || "hello@complyrer.com";
  if (apiKey) {
    const mail = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.DEMO_REQUEST_FROM || "ComplyRer <hello@complyrer.com>",
        to: [to],
        reply_to: email,
        subject: `Demo request — ${agency}`,
        text: [
          `Name: ${name}`,
          `Work email: ${email}`,
          `Agency: ${agency}`,
          `Priority: ${interest}`,
          `Received: ${payload.receivedAt}`,
        ].join("\n"),
      }),
    });
    if (!mail.ok) {
      const detail = await mail.text();
      console.error("demo_request_mail_failed", mail.status, detail.slice(0, 500));
      sendJson(res, 502, { error: "Could not send the request. Try again." });
      return;
    }
  }

  sendJson(res, 200, { ok: true });
}

async function readBody(req) {
  if (typeof req.body === "string") return safeJson(req.body);
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (!req[Symbol.asyncIterator]) return {};
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? safeJson(raw) : {};
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function setHeader(res, key, value) {
  if (typeof res.setHeader === "function") res.setHeader(key, value);
}

function sendJson(res, status, payload) {
  setHeader(res, "Content-Type", "application/json; charset=utf-8");
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(payload);
    return;
  }
  res.statusCode = status;
  res.end(JSON.stringify(payload));
}

function send(res, status) {
  if (typeof res.status === "function") {
    res.status(status).end();
    return;
  }
  res.statusCode = status;
  res.end();
}
