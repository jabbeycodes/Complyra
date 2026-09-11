import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SLUG = /^[a-z0-9]{2,20}$/;
const USERNAME = /^[a-z0-9.]{3,40}$/;
const STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ","NM",
  "NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT","VA","WA",
  "WV","WI","WY",
]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return json({ error: "Server is not configured" }, 500);

  const admin = createClient(url, service);
  const body = await req.json();
  const name = String(body.name ?? "").trim();
  const slug = String(body.slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const stateCode = String(body.stateCode ?? "").trim().toUpperCase();
  const adminFullName = String(body.adminFullName ?? "").trim();
  const username = String(body.adminUsername ?? "").trim().toLowerCase();
  const tempPassword = String(body.adminTempPassword ?? "");
  const provisionedBy = body.provisionedBy === "platform" ? "platform" : "self";

  if (!name) return json({ error: "Enter the agency name." }, 400);
  if (!SLUG.test(slug)) {
    return json({ error: "Agency code should be 2–20 letters or numbers, then the state." }, 400);
  }
  if (!STATES.has(stateCode)) return json({ error: "Choose the agency’s home state." }, 400);
  if (!adminFullName) return json({ error: "Enter the first administrator’s name." }, 400);
  if (!USERNAME.test(username)) {
    return json({ error: "Username must be 3–40 characters: letters, numbers, or dots." }, 400);
  }
  if (tempPassword.length < 8) {
    return json({ error: "Temporary password must be at least 8 characters." }, 400);
  }

  const agencyCode = `${slug}-${stateCode.toLowerCase()}`;
  const { data: existing } = await admin
    .from("agencies")
    .select("id")
    .eq("agency_code", agencyCode)
    .maybeSingle();
  if (existing) {
    return json(
      { error: "That agency code is already in use. Try a different short name." },
      409,
    );
  }

  const { data: agency, error: agencyError } = await admin
    .from("agencies")
    .insert({
      name,
      agency_code: agencyCode,
      state_code: stateCode,
      provisioned_by: provisionedBy,
    })
    .select("id, agency_code")
    .single();
  if (agencyError || !agency) {
    return json({ error: agencyError?.message ?? "Could not create the agency." }, 400);
  }

  const email = `${username}@${agencyCode}.complyra.user`;
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: {
      full_name: adminFullName,
      username,
      job_title: "Agency administrator",
      home_agency_id: agency.id,
      must_change_password: true,
    },
  });
  if (createError || !created.user) {
    await admin.from("agencies").delete().eq("id", agency.id);
    return json({ error: createError?.message ?? "Could not create the administrator." }, 400);
  }

  await admin
    .from("profiles")
    .update({
      username,
      full_name: adminFullName,
      job_title: "Agency administrator",
      home_agency_id: agency.id,
      must_change_password: true,
    })
    .eq("id", created.user.id);

  const { error: memberError } = await admin.from("memberships").insert({
    agency_id: agency.id,
    user_id: created.user.id,
    role: "administrator",
    site_id: null,
  });
  if (memberError) {
    return json({ error: memberError.message }, 400);
  }

  await admin.from("audit_events").insert({
    agency_id: agency.id,
    actor_id: created.user.id,
    action: "agency.created",
    target_type: "agency",
    target_id: agency.id,
    detail: `${name} created as ${agencyCode} · ${provisionedBy}`,
  });

  return json({
    agencyCode,
    username,
    fullName: adminFullName,
  });
});
