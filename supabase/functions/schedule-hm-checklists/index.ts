import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildSchedulerChecklistItems } from "./items.ts";

/**
 * schedule-hm-checklists — the Sunday HM-checklist scheduler.
 *
 * Runs Sundays ~06:00 (see the pg_cron / external-cron notes in migration
 * 20260914020000_checklist_scheduler.sql). Each run:
 *   1. Creates the upcoming week's checklist row (week_start = next Monday)
 *      for every program site with an assigned, active house manager —
 *      derived from memberships (role_key = 'house_manager', site_id set,
 *      not expired), the same source the client-side rollover uses.
 *      INSERT ... ON CONFLICT DO NOTHING on
 *      hm_weekly_checklists_site_week_uniq makes the run idempotent.
 *   2. Flags late checklists via the SQL function flag_late_checklists()
 *      (submitted_at null AND due_at < now() -> late = true). This is also
 *      the catch-up path: even if a Sunday creation run is missed, lateness
 *      is still computed on the next run.
 *   3. Queues notifications for newly created checklists
 *      (type 'checklist.assigned') and newly flagged late ones
 *      (type 'checklist.late'), with dedupe_key per event so reruns never
 *      duplicate.
 *
 * Authorization: the platform verifies the JWT (verify_jwt = true in
 * supabase/config.toml). Inside, the caller must EITHER present the
 * service_role key (external cron) OR be an active admin member
 * (administrator / compliance_admin).
 *
 * Returns { created, already_existed, newly_late, notifications_queued,
 *           week_start, warnings }.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SCHEDULER_UNIQUE_CONSTRAINT = "hm_weekly_checklists_site_week_uniq";
const HM_ROLE_KEY = "house_manager";
const ADMIN_ROLE_KEYS = ["administrator", "compliance_admin"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function fail(message: string, status: number, code?: string) {
  return json(code ? { error: message, code } : { error: message }, status);
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIsoDate(dt);
}

/**
 * The next Monday strictly after `iso`. The cron runs Sundays, so this is
 * tomorrow; on any other day it is the Monday of the upcoming week (a Monday
 * run targets the week after, never re-creating the current week).
 * Mirrors src/data/hmChecklist.ts nextMondayIso.
 */
function nextMondayIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const delta = dow === 1 ? 7 : (8 - dow) % 7;
  return addDaysIso(iso, delta);
}

/** due_at for a Monday week_start: Sunday 23:59 UTC. */
function dueAtIsoForWeekStart(weekStart: string): string {
  return `${addDaysIso(weekStart, 6)}T23:59:00.000Z`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Sep 14 – Sep 20, 2026" label for a Sunday-opened week. */
function weekRangeLabel(weekOfSunday: string): string {
  const end = addDaysIso(weekOfSunday, 6);
  const [, sm, sd] = weekOfSunday.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}, ${ey}`;
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
      const today = toIsoDate(new Date());
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

  const warnings: string[] = [];
  const today = toIsoDate(new Date());
  const weekStart = nextMondayIso(today); // upcoming week, Monday-based
  const weekOf = addDaysIso(weekStart, -1); // Sunday opening the same week
  const dueAt = dueAtIsoForWeekStart(weekStart);
  const weekLabel = weekRangeLabel(weekOf);

  // -- 1) Create the upcoming week's rows (idempotent upsert) -----------------
  const { data: assignments, error: assignError } = await admin
    .from("memberships")
    .select("agency_id, user_id, site_id, expires_on")
    .eq("role_key", HM_ROLE_KEY)
    .not("site_id", "is", null);
  if (assignError) {
    console.error("schedule-hm-checklists: membership lookup failed", assignError.message);
    return fail("Could not load HM assignments.", 500);
  }

  // Site names for notification copy.
  const siteIds = [
    ...new Set(
      ((assignments ?? []) as Array<Record<string, unknown>>).map(
        (m) => m.site_id as string,
      ),
    ),
  ];
  const siteNames = new Map<string, string>();
  if (siteIds.length > 0) {
    const { data: sites } = await admin
      .from("sites")
      .select("id, name")
      .in("id", siteIds);
    for (const s of (sites ?? []) as Array<Record<string, unknown>>) {
      siteNames.set(s.id as string, (s.name as string) ?? "home");
    }
  }

  let created = 0;
  let alreadyExisted = 0;
  const createdRows: Array<{
    id: string;
    agency_id: string;
    assigned_to_user_id: string;
    site_id: string;
  }> = [];

  for (const m of (assignments ?? []) as Array<Record<string, unknown>>) {
    const expiresOn = m.expires_on as string | null;
    if (expiresOn && expiresOn < today) continue; // expired membership
    const row = {
      agency_id: m.agency_id as string,
      site_id: m.site_id as string,
      week_of: weekOf,
      week_start: weekStart,
      due_at: dueAt,
      assigned_to_user_id: m.user_id as string,
      assigned_by_user_id: null,
      status: "open",
      items: buildSchedulerChecklistItems(),
      service_logs: [],
      late: false,
      late_flagged_at: null,
      submitted_at: null,
    };
    const { data: inserted, error: insertError } = await admin
      .from("hm_weekly_checklists")
      .upsert(row, {
        onConflict: SCHEDULER_UNIQUE_CONSTRAINT,
        ignoreDuplicates: true,
      })
      .select("id, agency_id, assigned_to_user_id, site_id");
    if (insertError) {
      console.error(
        "schedule-hm-checklists: upsert failed",
        row.site_id,
        insertError.message,
      );
      warnings.push(`upsert failed for site ${row.site_id}: ${insertError.message}`);
      continue;
    }
    const rows = (inserted ?? []) as Array<{
      id: string;
      agency_id: string;
      assigned_to_user_id: string;
      site_id: string;
    }>;
    if (rows.length > 0) {
      created += rows.length;
      createdRows.push(...rows);
    } else {
      alreadyExisted += 1;
    }
  }

  // -- 2) Flag late checklists (also the catch-up path) ------------------------
  type Flagged = {
    checklist_id: string;
    agency_id: string;
    assigned_to_user_id: string;
    site_id: string;
  };
  let flagged: Flagged[] = [];
  const { data: flaggedData, error: flagError } = await admin.rpc(
    "flag_late_checklists",
  );
  if (flagError) {
    // Fallback: run the equivalent update directly if the SQL function is
    // missing (e.g. migration not yet applied).
    console.error(
      "schedule-hm-checklists: flag_late_checklists RPC failed, falling back to direct update:",
      flagError.message,
    );
    warnings.push(`flag_late_checklists RPC failed (${flagError.message}); used direct update fallback.`);
    const nowIso = new Date().toISOString();
    const { data: directFlagged, error: directError } = await admin
      .from("hm_weekly_checklists")
      .update({ late: true, late_flagged_at: nowIso })
      .is("submitted_at", null)
      .not("due_at", "is", null)
      .lt("due_at", nowIso)
      .eq("late", false)
      .select("id, agency_id, assigned_to_user_id, site_id");
    if (directError) {
      console.error("schedule-hm-checklists: direct late-flag update failed", directError.message);
      warnings.push(`direct late-flag update failed: ${directError.message}`);
    } else {
      flagged = ((directFlagged ?? []) as Array<Record<string, unknown>>).map(
        (r) => ({
          checklist_id: r.id as string,
          agency_id: r.agency_id as string,
          assigned_to_user_id: r.assigned_to_user_id as string,
          site_id: r.site_id as string,
        }),
      );
    }
  } else {
    flagged = (flaggedData ?? []) as Flagged[];
  }

  // -- 3) Queue notifications (dedupe_key: reruns never duplicate) --------------
  type NotificationRow = {
    agency_id: string;
    user_id: string | null;
    role_key: string | null;
    type: string;
    title: string;
    body: string;
    deep_link: string;
    entity_type: string;
    entity_id: string;
    dedupe_key: string;
  };
  const notifications: NotificationRow[] = [];
  for (const r of createdRows) {
    const siteName = siteNames.get(r.site_id) ?? "home";
    notifications.push({
      agency_id: r.agency_id,
      user_id: null,
      role_key: HM_ROLE_KEY,
      type: "checklist.assigned",
      title: "New weekly checklist assigned",
      body: `Your weekly checklist for ${siteName} · week of ${weekLabel} is ready. Due Sunday 11:59 PM UTC.`,
      deep_link: "/weekly-checklist",
      entity_type: "hm_weekly_checklist",
      entity_id: r.id,
      dedupe_key: `checklist.assigned:${r.id}`,
    });
  }
  for (const f of flagged) {
    const siteName = siteNames.get(f.site_id) ?? "home";
    notifications.push({
      agency_id: f.agency_id,
      user_id: f.assigned_to_user_id,
      role_key: null,
      type: "checklist.late",
      title: "Weekly checklist past due",
      body: `The weekly checklist for ${siteName} is past due. Submit it as soon as possible.`,
      deep_link: "/weekly-checklist",
      entity_type: "hm_weekly_checklist",
      entity_id: f.checklist_id,
      dedupe_key: `checklist.late:${f.checklist_id}`,
    });
  }

  let notificationsQueued = 0;
  if (notifications.length > 0) {
    const { data: queued, error: notifyError } = await admin
      .from("notifications")
      .upsert(notifications, {
        onConflict: "dedupe_key",
        ignoreDuplicates: true,
      })
      .select("id");
    if (notifyError) {
      console.error("schedule-hm-checklists: notification insert failed", notifyError.message);
      warnings.push(`notification insert failed: ${notifyError.message}`);
    } else {
      notificationsQueued = (queued ?? []).length;
    }
  }

  console.log(
    "schedule-hm-checklists: run by",
    actor,
    { weekStart, created, alreadyExisted, newlyLate: flagged.length, notificationsQueued },
  );

  return json({
    created,
    already_existed: alreadyExisted,
    newly_late: flagged.length,
    notifications_queued: notificationsQueued,
    week_start: weekStart,
    warnings,
  });
});
