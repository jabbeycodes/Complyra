import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * delegation-ack-sweep — the delegation acknowledgment overdue sweeper.
 *
 * Intended schedule: daily (e.g. 07:00 local). Each run calls the
 * public.sweep_delegation_ack_overdue() RPC, which:
 *   1. Finds published training materials older than 7 days with unsigned
 *      site staff.
 *   2. Queues 'delegation.ack_overdue' notifications to each overdue staff
 *      member and a per-assignment summary to managers
 *      (delegation.activate holders) at the site.
 *   3. Is dedupe-safe: reruns never duplicate or double-count. The RPC
 *      returns the number of notifications ACTUALLY inserted.
 *
 * Authorization: the platform verifies the JWT (verify_jwt = true in
 * supabase/config.toml). Inside, the caller must EITHER present the
 * service_role key (external cron / pg_cron) OR be an active admin member
 * (administrator / compliance_admin).
 *
 * NOT DEPLOYED. Built on the lifepath/delegation-templates branch for
 * Joshua's later explicit production approval.
 *
 * Returns { notifications_queued, actor }.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ADMIN_ROLE_KEYS = ["administrator", "compliance_admin"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number) {
  return json({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "GET") {
    return fail("Method not allowed", 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return fail("Server is not configured", 500);
  }

  // -- Authorization: service_role key OR an active admin member --------------
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (!bearer) return fail("Missing authorization", 401);

  const admin = createClient(url, service);
  let authorized = false;
  let actor = "service_role";
  if (bearer === service) {
    authorized = true;
  } else {
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (user) {
      const today = new Date().toISOString().slice(0, 10);
      const { data: membership } = await admin
        .from("memberships")
        .select("id")
        .eq("user_id", user.id)
        .in("role_key", ADMIN_ROLE_KEYS)
        .or(`expires_on.is.null,expires_on.gte.${today}`)
        .limit(1);
      if (membership && membership.length > 0) {
        authorized = true;
        actor = user.id;
      }
    }
  }
  if (!authorized) {
    return fail("Not authorized: service_role or an admin member is required.", 403);
  }

  // -- Run the sweep ----------------------------------------------------------
  const { data, error } = await admin.rpc("sweep_delegation_ack_overdue");
  if (error) {
    return fail(`Sweep failed: ${error.message}`, 500);
  }
  return json({ notifications_queued: data ?? 0, actor });
});
