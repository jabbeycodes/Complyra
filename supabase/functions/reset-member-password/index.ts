import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

function tempPassword() {
  return `Reset!${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

// P0-4 (2026-09-13): mirrors the client `canGrantRole` in
// src/data/permissions.ts — callers may only reset passwords for roles they
// could grant. Without this, a DPM could reset the administrator's password
// and take over the account.
function canResetPasswordFor(callerRoleKey: string, targetRoleKey: string): boolean {
  if (targetRoleKey === "administrator") return callerRoleKey === "administrator";
  if (targetRoleKey === "compliance_admin") {
    return callerRoleKey === "administrator" || callerRoleKey === "compliance_admin";
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing authorization" }, 401);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) {
    return json({ error: "Server is not configured" }, 500);
  }

  const caller = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, service);
  const {
    data: { user },
    error: userError,
  } = await caller.auth.getUser();
  if (userError || !user) return json({ error: "Not signed in" }, 401);

  const { data: membership } = await admin
    .from("memberships")
    .select("agency_id, role_key, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return json({ error: "Not a member of an agency." }, 403);

  const { data: callerRole } = await admin
    .from("agency_roles")
    .select("permissions")
    .eq("agency_id", membership.agency_id)
    .eq("template_key", membership.role_key ?? membership.role)
    .maybeSingle();
  if (!callerRole?.permissions?.["members.reset_password"]) {
    return json({ error: "You do not have permission to reset passwords." }, 403);
  }

  const body = await req.json();
  const userId = String(body.userId ?? "");
  if (!userId) return json({ error: "Choose a staff member." }, 400);

  const { data: target } = await admin
    .from("memberships")
    .select("user_id, agency_id, role_key, role")
    .eq("user_id", userId)
    .eq("agency_id", membership.agency_id)
    .maybeSingle();
  if (!target) return json({ error: "Staff member not found." }, 404);

  const callerRoleKey = String(membership.role_key ?? membership.role ?? "");
  const targetRoleKey = String(target.role_key ?? target.role ?? "");
  if (!canResetPasswordFor(callerRoleKey, targetRoleKey)) {
    return json({ error: "You cannot reset that staff member's password." }, 403);
  }

  const password = tempPassword();
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { must_change_password: true },
  });
  if (updateError) return json({ error: updateError.message }, 400);

  await admin
    .from("profiles")
    .update({ must_change_password: true })
    .eq("id", userId);

  const { data: profile } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();

  await admin.from("audit_events").insert({
    agency_id: membership.agency_id,
    actor_id: user.id,
    action: "member.password_reset",
    target_type: "profile",
    target_id: userId,
    detail: `Temporary password issued for ${profile?.full_name ?? "staff"}`,
  });

  return json({ tempPassword: password });
});
