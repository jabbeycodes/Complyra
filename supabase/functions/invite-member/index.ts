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

function internalEmail(username: string, agencyCode: string) {
  return `${username.toLowerCase()}@${agencyCode.toLowerCase()}.complyra.user`;
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
    .select("agency_id, role")
    .eq("user_id", user.id)
    .maybeSingle();
  if (
    !membership ||
    !["administrator", "compliance_admin"].includes(membership.role)
  ) {
    return json({ error: "Only administrators can add members." }, 403);
  }

  const body = await req.json();
  const username = String(body.username ?? "")
    .trim()
    .toLowerCase();
  const tempPassword = String(body.tempPassword ?? "");
  const fullName = String(body.fullName ?? "").trim();
  const role = String(body.role ?? "dsp");
  const jobTitle = String(body.jobTitle ?? "DSP").trim();
  const siteId = body.siteId ? String(body.siteId) : null;

  if (!/^[a-z0-9.]{3,40}$/.test(username)) {
    return json(
      { error: "Username must be 3–40 characters: letters, numbers, or dots." },
      400,
    );
  }
  if (tempPassword.length < 8) {
    return json({ error: "Temporary password must be at least 8 characters." }, 400);
  }
  if (!fullName) return json({ error: "Enter the staff member’s name." }, 400);
  if (!["administrator", "compliance_admin", "manager", "dsp"].includes(role)) {
    return json({ error: "Choose a valid role." }, 400);
  }

  const { data: agency } = await admin
    .from("agencies")
    .select("id, agency_code")
    .eq("id", membership.agency_id)
    .single();
  if (!agency) return json({ error: "Agency not found." }, 404);

  const { data: taken } = await admin.rpc("username_taken", {
    p_agency_id: agency.id,
    p_username: username,
  });
  if (taken) {
    return json({ error: "That username is already used in this agency." }, 409);
  }

  const email = internalEmail(username, agency.agency_code);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
      username,
      job_title: jobTitle,
      home_agency_id: agency.id,
      must_change_password: true,
    },
  });
  if (createError || !created.user) {
    return json(
      { error: createError?.message ?? "Could not create the account." },
      400,
    );
  }

  await admin
    .from("profiles")
    .update({
      username,
      full_name: fullName,
      job_title: jobTitle,
      home_agency_id: agency.id,
      must_change_password: true,
    })
    .eq("id", created.user.id);

  const { error: memberError } = await admin.from("memberships").insert({
    agency_id: agency.id,
    user_id: created.user.id,
    role,
    site_id: siteId,
  });
  if (memberError) {
    return json({ error: memberError.message }, 400);
  }

  await admin.from("audit_events").insert({
    agency_id: agency.id,
    actor_id: user.id,
    action: "member.invited",
    target_type: "profile",
    target_id: created.user.id,
    detail: `${fullName} invited as ${role} · username ${username}`,
  });

  return json({
    username,
    agencyCode: agency.agency_code,
    fullName,
    role,
  });
});
