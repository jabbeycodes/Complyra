/**
 * create-agency request handling, kept free of Deno and jsr imports so the
 * failure paths run under the unit suite. index.ts wires in the runtime.
 *
 * Finding F-1: every failure now answers `{ error, code }` with a message safe
 * to show an applicant. Database and auth details go to the function log only.
 *   invalid_input (400)  a field needs fixing
 *   code_in_use   (409)  the provider code is taken
 *   server_error  (500)  our fault, safe to try again
 */

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

export const AGENCY_CODE_IN_USE = "That agency code is already in use. Try a different short name.";
export const AGENCY_SETUP_RETRY =
  "We couldn’t finish setting up your agency because of a problem on our side. Please try again in a few minutes.";

const UNIQUE_VIOLATION = "23505";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function invalid(message: string) {
  return json({ error: message, code: "invalid_input" }, 400);
}

function codeInUse() {
  return json({ error: AGENCY_CODE_IN_USE, code: "code_in_use" }, 409);
}

/** Log the detail for us; give the applicant only the safe retry message. */
function serverFailure(step: string, detail?: unknown) {
  const { code, message } = (detail ?? {}) as { code?: unknown; message?: unknown };
  console.error(`create-agency: ${step}`, { code, message });
  return json({ error: AGENCY_SETUP_RETRY, code: "server_error" }, 500);
}

// deno-lint-ignore no-explicit-any
type Client = any;

export interface CreateAgencyDeps {
  env(key: string): string | undefined;
  createClient(url: string, key: string, options?: unknown): Client;
}

export async function handleCreateAgency(req: Request, deps: CreateAgencyDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = deps.env("SUPABASE_URL");
  const service = deps.env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !service) return serverFailure("missing server configuration");
  const admin = deps.createClient(url, service);
  const provisional: Provisional = { agencyId: null, userId: null };
  try {
    return await createAgency(req, deps, admin, url, provisional);
  } catch (err) {
    await undoProvisional(admin, provisional);
    return serverFailure("unexpected failure", err);
  }
}

/** Rows written so far, so a failed setup can't hold the provider code against a retry. */
interface Provisional {
  agencyId: string | null;
  userId: string | null;
}

async function undoProvisional(admin: Client, provisional: Provisional) {
  const { userId, agencyId } = provisional;
  if (userId) await undoStep(provisional, () => admin.auth.admin.deleteUser(userId));
  if (agencyId) await undoStep(provisional, () => admin.from("agencies").delete().eq("id", agencyId));
}

/** Supabase clients usually answer a failure with `{ error }` rather than throwing, so check both. */
async function undoStep(provisional: Provisional, step: () => PromiseLike<{ error?: unknown } | undefined>) {
  let failure: unknown;
  try {
    failure = (await step())?.error;
  } catch (err) {
    failure = err;
  }
  if (failure) {
    console.error("create-agency: rollback failed", {
      ...provisional,
      message: (failure as { message?: unknown }).message,
    });
  }
}

async function createAgency(
  req: Request,
  deps: CreateAgencyDeps,
  admin: Client,
  url: string,
  provisional: Provisional,
): Promise<Response> {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return invalid("The form didn’t come through. Check each field and try again.");
  }
  const name = String(body.name ?? "").trim();
  const slug = String(body.slug ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const stateCode = String(body.stateCode ?? "").trim().toUpperCase();
  const adminFullName = String(body.adminFullName ?? "").trim();
  const username = String(body.adminUsername ?? "").trim().toLowerCase();
  const tempPassword = String(body.adminTempPassword ?? "");
  if (!name) return invalid("Enter the agency name.");
  if (!SLUG.test(slug)) {
    return invalid("Agency code should be 2–20 letters or numbers, then the state.");
  }
  if (!STATES.has(stateCode)) return invalid("Choose the agency’s home state.");
  if (!adminFullName) return invalid("Enter the first administrator’s name.");
  if (!USERNAME.test(username)) {
    return invalid("Username must be 3–40 characters: letters, numbers, or dots.");
  }
  if (tempPassword.length < 8) {
    return invalid("Temporary password must be at least 8 characters.");
  }

  let platformAdmin = false;
  const authHeader = req.headers.get("Authorization");
  const anon = deps.env("SUPABASE_ANON_KEY");
  if (authHeader && anon) {
    const caller = deps.createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await caller.auth.getUser();
    if (user) {
      const { data: profile } = await admin
        .from("profiles")
        .select("platform_admin")
        .eq("id", user.id)
        .maybeSingle();
      platformAdmin = Boolean(profile?.platform_admin);
    }
  }

  const provisionedBy =
    platformAdmin && body.provisionedBy === "platform" ? "platform" : "self";
  const status = provisionedBy === "platform" ? "active" : "pending";
  const agencyCode = `${slug.toUpperCase()}-${stateCode}`;
  const { data: existing } = await admin
    .from("agencies")
    .select("id")
    .eq("agency_code", agencyCode)
    .maybeSingle();
  if (existing) return codeInUse();

  const { data: agency, error: agencyError } = await admin
    .from("agencies")
    .insert({
      name,
      agency_code: agencyCode,
      state_code: stateCode,
      provisioned_by: provisionedBy,
      status,
    })
    .select("id, agency_code")
    .single();
  if (agencyError?.code === UNIQUE_VIOLATION) return codeInUse();
  if (agencyError || !agency) return serverFailure("agency insert failed", agencyError);
  provisional.agencyId = agency.id;

  const email = `${username}@${agencyCode.toLowerCase()}.complyrer.user`;
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
  if (createError || !created?.user) {
    await undoProvisional(admin, provisional);
    if (createError?.code === "weak_password") {
      return invalid("That temporary password is too easy to guess. Choose a stronger one.");
    }
    if (createError?.code === "email_exists") return codeInUse();
    return serverFailure("administrator create failed", createError);
  }

  provisional.userId = created.user.id;

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
    role_key: "administrator",
    site_id: null,
    expires_on: null,
  });
  if (memberError) {
    await undoProvisional(admin, provisional);
    return serverFailure("administrator membership failed", memberError);
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
    status,
  });
}
