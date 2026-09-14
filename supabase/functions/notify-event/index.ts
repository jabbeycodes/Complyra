import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * notify-event — the server-side authority for the notification engine.
 *
 * POST body:
 *   {
 *     agency_id: string,          // uuid, required
 *     user_id?: string | null,    // targeted member (exactly one of user_id / role_key)
 *     role_key?: string | null,   // broadcast role, e.g. "house_manager"
 *     type: NotificationType,     // required, one of the 10 known types
 *     title: string,              // required
 *     body: string,               // required
 *     deep_link: string,          // required, app route like "/checklists/<id>"
 *     entity_type?: string | null,
 *     entity_id?: string | null,
 *     dedupe_key?: string | null  // optional; duplicate dedupe_keys return 200 without inserting
 *   }
 *
 * The caller must hold an ACTIVE membership in the named agency (fail
 * closed — expired memberships do not pass). The insert is performed with
 * the service role key because the notifications table intentionally has no
 * authenticated insert policy; the JWT here is authority for *what* to
 * write, the service key is only the transport.
 *
 * verify_jwt = true is set in supabase/config.toml for this function.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number, code?: string) {
  return json(code ? { error: message, code } : { error: message }, status);
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOTIFICATION_TYPES = [
  "training.assigned",
  "training.due_soon",
  "training.overdue",
  "certificate.expiring",
  "certificate.expired",
  "med.low_stock",
  "checklist.assigned",
  "checklist.late",
  "checklist.missed",
  "checklist.submitted",
  "rating.changed",
  "review.changed",
  "recognition.hm_winner",
  "recognition.dsp_winner",
];

function isWellFormedDeepLink(deepLink: string): boolean {
  return (
    deepLink.startsWith("/") &&
    !deepLink.includes("://") &&
    !deepLink.includes(" ")
  );
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }
  if (req.method !== "POST") {
    return fail("Method not allowed", 405, "method_not_allowed");
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return fail("Missing authorization", 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return fail("Server is not configured", 500);
  }

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, service);

  const {
    data: { user },
    error: userError,
  } = await caller.auth.getUser();
  if (userError || !user) return fail("Not signed in", 401);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body.", 400);
  }

  const agencyId =
    typeof body.agency_id === "string" ? body.agency_id.trim() : "";
  if (!UUID_RE.test(agencyId)) {
    return fail("agency_id must be a UUID.", 400, "invalid_agency");
  }

  const type = typeof body.type === "string" ? body.type.trim() : "";
  if (!NOTIFICATION_TYPES.includes(type)) {
    return fail("Unknown notification type.", 400, "invalid_type");
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return fail("title is required.", 400, "invalid_title");
  const notifBody = typeof body.body === "string" ? body.body.trim() : "";
  if (!notifBody) return fail("body is required.", 400, "invalid_body");
  const deepLink =
    typeof body.deep_link === "string" ? body.deep_link.trim() : "";
  if (!deepLink || !isWellFormedDeepLink(deepLink)) {
    return fail("deep_link must be an app route like /checklists/abc.", 400, "invalid_deep_link");
  }

  const userId =
    typeof body.user_id === "string" && body.user_id.trim()
      ? body.user_id.trim()
      : null;
  const roleKey =
    typeof body.role_key === "string" && body.role_key.trim()
      ? body.role_key.trim()
      : null;
  if (userId && !UUID_RE.test(userId)) {
    return fail("user_id must be a UUID.", 400, "invalid_user");
  }
  if (!userId && !roleKey) {
    return fail("Exactly one of user_id or role_key is required.", 400, "invalid_target");
  }

  // The caller must hold an ACTIVE membership in this agency.
  const today = new Date().toISOString().slice(0, 10);
  const { data: membership } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("agency_id", agencyId)
    .or(`expires_on.is.null,expires_on.gte.${today}`)
    .limit(1);
  if (!membership || membership.length === 0) {
    return fail("No active agency membership for this account.", 403);
  }

  const dedupeKey =
    typeof body.dedupe_key === "string" && body.dedupe_key.trim()
      ? body.dedupe_key.trim()
      : null;

  // Deduping: the same event must not produce a second notification.
  if (dedupeKey) {
    const { data: existing } = await admin
      .from("notifications")
      .select("id")
      .eq("agency_id", agencyId)
      .eq("dedupe_key", dedupeKey)
      .limit(1);
    if (existing && existing.length > 0) {
      return json({ deduped: true, id: (existing[0] as { id: string }).id }, 200);
    }
  }

  const entityType =
    typeof body.entity_type === "string" && body.entity_type.trim()
      ? body.entity_type.trim()
      : null;
  const entityId =
    typeof body.entity_id === "string" && body.entity_id.trim()
      ? body.entity_id.trim()
      : null;

  const { data: inserted, error: insertError } = await admin
    .from("notifications")
    .insert({
      agency_id: agencyId,
      user_id: userId,
      role_key: roleKey,
      type,
      title,
      body: notifBody,
      deep_link: deepLink,
      entity_type: entityType,
      entity_id: entityId,
      dedupe_key: dedupeKey,
    })
    .select("id")
    .single();

  if (insertError) {
    // A lost race on the dedupe index is a success, not a failure.
    if (insertError.code === "23505") {
      return json({ deduped: true }, 200);
    }
    return fail("Could not create notification.", 500);
  }

  return json({ id: (inserted as { id: string }).id }, 201);
});
