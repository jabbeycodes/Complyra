import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { zonedWallTimeMs } from "../../../src/data/dueItems.ts";
import { AGENCY_TIME_ZONE, agencyClock, noticesForAgency } from "../../../src/data/operatingReminders.ts";
import { operatingRulesFrom, type EffectiveRule } from "../../../src/data/rules.ts";

/**
 * sweep-operating-reminders — missing Shift notes, unmarked doses, and
 * open PRN follow-ups when nobody has the app open.
 *
 * The signed-in bell uses the same notice list. This job judges yesterday
 * and the dose clock in America/Chicago. It inserts through
 * queue_system_notice, which only the service role can call.
 *
 * Authorization matches delegation-ack-sweep: the platform verifies the JWT,
 * then the caller must present the service role key or be an active
 * administrator or compliance admin.
 *
 * Deployed to Complyra. A cron job calls it only when the project URL and
 * service key are in Vault. The job command reads those secrets at run time
 * and does not store the key in the schedule. There is no phone push.
 * Redeploy from a single bundle: Deno cannot follow the extensionless
 * imports in src/.
 *
 * Returns { notices_queued, agencies, actor }.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

function jwtRole(bearer: string): string | null {
  const parts = bearer.split(".");
  if (parts.length !== 3) return null;
  try {
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

async function rulesFor(admin: SupabaseClient, agencyId: string) {
  const { data, error } = await admin.rpc("effective_rules", {
    p_agency_id: agencyId,
    p_site_id: null,
  });
  if (error || !data) return operatingRulesFrom(null);
  return operatingRulesFrom(
    (data as Array<Record<string, unknown>>).map(
      (row): EffectiveRule => ({
        key: String(row.key),
        value: row.value as EffectiveRule["value"],
        lock: (row.lock as EffectiveRule["lock"]) ?? "agency",
        source: (row.source as EffectiveRule["source"]) ?? "default",
      }),
    ),
  );
}

async function sweepAgency(admin: SupabaseClient, agencyId: string) {
  const now = new Date();
  const clock = agencyClock(now);
  const rules = await rulesFor(admin, agencyId);
  const { data: siteRows, error: siteError } = await admin
    .from("sites")
    .select("id, name")
    .eq("agency_id", agencyId);
  if (siteError || !siteRows?.length) return 0;
  const siteIds = siteRows.map((row) => String(row.id));
  const { data: factRows } = await admin
    .from("site_facts")
    .select("site_id, facts")
    .eq("agency_id", agencyId)
    .in("site_id", siteIds);
  const factsBySite = new Map(
    (factRows ?? []).map((row) => [String(row.site_id), row.facts]),
  );
  const { data: membershipRows } = await admin
    .from("memberships")
    .select("user_id, role_key, role, site_id, expires_on")
    .eq("agency_id", agencyId);
  const memberships = (membershipRows ?? []).map((row) => ({
    userId: String(row.user_id),
    role: String(row.role_key ?? row.role ?? ""),
    siteId: row.site_id ? String(row.site_id) : null,
    expiresOn: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
  }));
  const { data: peopleRows } = await admin
    .from("individuals")
    .select("id, full_name, site_id")
    .eq("agency_id", agencyId);
  const people = (peopleRows ?? [])
    .filter((row) => row.site_id)
    .map((row) => ({
      id: String(row.id),
      name: String(row.full_name ?? ""),
      siteId: String(row.site_id),
    }));
  const peopleIds = people.map((person) => person.id);
  const profileIds = [...new Set(memberships.map((row) => row.userId))];
  const { data: profileRows } = profileIds.length
    ? await admin.from("profiles").select("id, full_name").in("id", profileIds)
    : { data: [] };
  const { data: noteRows } = peopleIds.length
    ? await admin
        .from("shift_notes")
        .select("individual_id, staff_user_id, shift, note_date, hr_shift_id")
        .eq("agency_id", agencyId)
        .in("individual_id", peopleIds)
        .eq("note_date", clock.yesterday)
        .is("deleted_at", null)
    : { data: [] };
  const { data: aloneRows } = peopleIds.length
    ? await admin
        .from("alone_time_windows")
        .select("id, agency_id, individual_id, recurrence, weekday, on_date, start_time, end_time, note, created_by, created_by_name, created_at, updated_at, deleted_at")
        .eq("agency_id", agencyId)
        .is("deleted_at", null)
        .in("individual_id", peopleIds)
    : { data: [] };
  const { data: medRows } = peopleIds.length
    ? await admin
        .from("medications")
        .select("id, name, individual_id, kind, strength")
        .eq("agency_id", agencyId)
        .in("individual_id", peopleIds)
    : { data: [] };
  const medIds = (medRows ?? []).map((row) => String(row.id));
  const { data: inventoryRows } = medIds.length
    ? await admin
        .from("med_inventory")
        .select("medication_id, dose_times")
        .eq("agency_id", agencyId)
        .in("medication_id", medIds)
    : { data: [] };
  const { data: markRows } = medIds.length
    ? await admin
        .from("med_dose_marks")
        .select("medication_id, dose_date, dose_time, status")
        .eq("agency_id", agencyId)
        .eq("dose_date", clock.today)
        .in("medication_id", medIds)
    : { data: [] };
  const { data: events } = await admin
    .from("audit_events")
    .select("action, target_id, actor_id, created_at")
    .eq("agency_id", agencyId)
    .in("action", ["medication.prn", "medication.prn_followup", "medication.prn_effectiveness"])
    .order("created_at", { ascending: false })
    .limit(500);
  const dayStart = new Date(zonedWallTimeMs(clock.yesterday, 0, AGENCY_TIME_ZONE)).toISOString();
  const dayEnd = new Date(zonedWallTimeMs(clock.yesterday, 36 * 60, AGENCY_TIME_ZONE)).toISOString();
  const { data: shiftRows, error: shiftError } = await admin
    .from("hr_shifts")
    .select("id, site_id, staff_id, starts_at, ends_at")
    .eq("agency_id", agencyId)
    .in("site_id", siteIds)
    .in("status", ["scheduled", "published"])
    .not("staff_id", "is", null)
    .lt("starts_at", dayEnd)
    .gt("ends_at", dayStart);
  const shiftStaffIds = [...new Set((shiftRows ?? []).map((row) => String(row.staff_id)))];
  const missingStaff = shiftStaffIds.filter((id) => !(profileRows ?? []).some((row) => String(row.id) === id));
  const { data: extraProfiles } = missingStaff.length
    ? await admin.from("profiles").select("id, full_name").in("id", missingStaff)
    : { data: [] };
  const shiftNames = new Map(
    [...(profileRows ?? []), ...(extraProfiles ?? [])].map((row) => [String(row.id), String(row.full_name ?? "Staff")]),
  );
  const scheduledShifts = shiftError
    ? []
    : (shiftRows ?? []).map((row) => ({
        id: String(row.id),
        siteId: String(row.site_id),
        staffUserId: String(row.staff_id),
        staffName: shiftNames.get(String(row.staff_id)) ?? "Staff",
        startsAt: String(row.starts_at),
        endsAt: String(row.ends_at),
      }));
  const notices = noticesForAgency({
    now,
    rules,
    sites: siteRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      facts: factsBySite.get(String(row.id)) ?? {},
    })),
    memberships,
    profiles: (profileRows ?? []).map((row) => ({
      id: String(row.id),
      fullName: String(row.full_name ?? ""),
    })),
    individuals: people,
    notes: (noteRows ?? []).map((row) => ({
      individualId: String(row.individual_id),
      staffUserId: String(row.staff_user_id ?? ""),
      shift: String(row.shift ?? ""),
      noteDate: String(row.note_date ?? ""),
      hrShiftId: row.hr_shift_id ? String(row.hr_shift_id) : null,
    })),
    scheduledShifts,
    aloneTime: (aloneRows ?? []).map((row) => ({
      id: String(row.id),
      agencyId: String(row.agency_id),
      individualId: String(row.individual_id),
      recurrence: row.recurrence ?? "once",
      weekday: row.weekday === null || row.weekday === undefined ? null : Number(row.weekday),
      onDate: row.on_date ? String(row.on_date).slice(0, 10) : null,
      startTime: String(row.start_time ?? "").slice(0, 5),
      endTime: String(row.end_time ?? "").slice(0, 5),
      note: String(row.note ?? ""),
      createdBy: row.created_by ? String(row.created_by) : null,
      createdByName: String(row.created_by_name ?? ""),
      createdAt: String(row.created_at ?? ""),
      updatedAt: String(row.updated_at ?? ""),
      deletedAt: row.deleted_at ? String(row.deleted_at) : null,
    })),
    medications: (medRows ?? []).map((row) => ({
      id: String(row.id),
      name: String(row.name ?? ""),
      individualId: String(row.individual_id),
      kind: String(row.kind ?? ""),
      strength: String(row.strength ?? ""),
    })),
    doseTimes: (inventoryRows ?? []).map((row) => ({
      medicationId: String(row.medication_id),
      doseTimes: Array.isArray(row.dose_times) ? row.dose_times.map(String) : [],
    })),
    marks: (markRows ?? []).map((row) => ({
      medicationId: String(row.medication_id),
      doseDate: String(row.dose_date ?? ""),
      doseTime: String(row.dose_time ?? ""),
      status: String(row.status ?? ""),
    })),
    prnEvents: (events ?? []).map((row) => ({
      action: String(row.action),
      targetId: row.target_id ? String(row.target_id) : null,
      actorId: row.actor_id ? String(row.actor_id) : null,
      createdAt: String(row.created_at),
    })),
  });
  let queued = 0;
  for (const notice of notices) {
    if (!notice.userId) continue;
    const { data, error } = await admin.rpc("queue_system_notice", {
      p_agency_id: agencyId,
      p_user_id: notice.userId,
      p_role_key: null,
      p_type: notice.type,
      p_title: notice.title,
      p_body: notice.body,
      p_deep_link: notice.deepLink,
      p_entity_id: notice.entityId,
      p_dedupe_key: notice.dedupeKey,
    });
    if (!error) queued += Number(data ?? 0);
  }
  if (!shiftError) {
    const liveIds = [...new Set(
      notices
        .filter((notice) => notice.type === "documentation.missing_note")
        .map((notice) => {
          const rest = notice.dedupeKey.slice("documentation.missing_note:".length);
          const parts = rest.split(":");
          return parts.slice(0, -2).join(":");
        }),
    )];
    await admin.rpc("retire_stale_missing_note_notices", {
      p_agency_id: agencyId,
      p_service_date: clock.yesterday,
      p_individual_ids: peopleIds,
      p_live_ids: liveIds,
    });
  }
  return queued;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST" && req.method !== "GET") return fail("Method not allowed", 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !service) return fail("Server is not configured", 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";
  if (!bearer) return fail("Missing authorization", 401);

  const admin = createClient(url, service);
  let authorized = false;
  let actor = "service_role";
  // The gateway already checked the signature. Hosted functions now hold a
  // secret key that is not the same string as the service-role JWT, so the
  // cron sends the JWT and we accept it when its role claim is service_role.
  if (bearer === service || jwtRole(bearer) === "service_role") {
    authorized = true;
  } else {
    const caller = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await caller.auth.getUser();
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
  if (!authorized) return fail("Not authorized: service_role or an admin member is required.", 403);

  let agencyId: string | null = null;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body && typeof body.agency_id === "string") agencyId = body.agency_id;
    } catch {
      agencyId = null;
    }
  }
  const { data: agencies, error } = agencyId
    ? await admin.from("agencies").select("id").eq("id", agencyId).eq("status", "active")
    : await admin.from("agencies").select("id").eq("status", "active");
  if (error || !agencies) return fail("Could not load agencies", 500);

  let noticesQueued = 0;
  for (const agency of agencies) {
    noticesQueued += await sweepAgency(admin, String(agency.id));
  }
  return json({ notices_queued: noticesQueued, agencies: agencies.length, actor });
});
