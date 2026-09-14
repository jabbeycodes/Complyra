/**
 * Marketing demo requests. Primary path is this POST — not mailto.
 * If RESEND_API_KEY is set, email hello@ (or DEMO_REQUEST_TO).
 * Otherwise the structured log is the operator inbox until mail is wired.
 */
export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const input = typeof req.body === "string" ? safeJson(req.body) : req.body ?? {};
  if (typeof input.company_website === "string" && input.company_website.trim()) {
    res.status(200).json({ ok: true });
    return;
  }

  const name = String(input.name ?? "").trim();
  const email = String(input.email ?? "").trim().toLowerCase();
  const agency = String(input.agency ?? "").trim();
  const interest = String(input.interest ?? "").trim() || "Audit readiness";

  if (name.length < 2 || name.length > 120) {
    res.status(400).json({ error: "Enter your name." });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 180) {
    res.status(400).json({ error: "Enter a work email." });
    return;
  }
  if (agency.length < 2 || agency.length > 180) {
    res.status(400).json({ error: "Enter the agency name." });
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
      res.status(502).json({ error: "Could not send the request. Try again." });
      return;
    }
  }

  res.status(200).json({ ok: true });
}

function safeJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
