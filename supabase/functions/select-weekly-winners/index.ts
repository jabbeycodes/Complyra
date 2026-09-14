import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * select-weekly-winners — the Sunday recognition scheduler.
 *
 * Runs alongside schedule-hm-checklists (see the pg_cron / external-cron
 * notes in migration 20260914020000_checklist_scheduler.sql). Each run:
 *   1. Scores every active house manager and DSP in each agency for the
 *      target week (default: the most recent week whose Monday-4pm checklist
 *      deadline has passed — the Sunday 06:05 UTC run scores the week that
 *      ended seven days earlier).
 *   2. Picks exactly one winner per category (deterministic: highest score,
 *      exact ties break by user id).
 *   3. Inserts the winner into recognition_winners (highlights only — never
 *      scores) and every candidate's breakdown into
 *      recognition_score_snapshots.
 *   4. Queues celebration notifications: one personal row for the winner plus
 *      role broadcasts (dedupe_key per event so reruns never duplicate).
 *
 * Winners only: the public surface is the winner + positive highlights. Raw
 * scores and full candidate lists live only in recognition_score_snapshots,
 * which RLS restricts to recognition.manage holders.
 *
 * Scoring inputs and weights are documented in docs/recognition-scoring.md.
 * The math mirrors src/recognition/scoring.ts (kept in sync by hand; the
 * edge runtime cannot import the Vite bundle).
 *
 * Idempotent: INSERT ... ON CONFLICT DO NOTHING on
 * recognition_winners_unique means a rerun for an already-decided week
 * changes nothing and reports already_decided.
 *
 * Authorization: the service_role key (external cron) OR a member holding
 * recognition.manage (administrator, compliance_admin, DPM, program_manager
 * per the canonical templates; per-agency customized templates are honored).
 * JWT callers are scoped to the agencies where they hold the permission.
 *
 * Body (all optional): { week_start?: "YYYY-MM-DD" (a Monday),
 *                        agency_id?: "<uuid>" }
 *
 * Returns { week_start, agencies: [{ agency_id, hm_winner, dsp_winner,
 *           already_decided }], warnings }.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const HM_ROLE_KEY = "house_manager";
const DSP_ROLE_KEY = "dsp";

// Weights — must match src/recognition/scoring.ts HM_WEIGHTS / DSP_WEIGHTS.
const HM_W = {
  weeklyChecklistsOnTime: 35,
  monthlyChecksOnTime: 20,
  siteComplianceStanding: 25,
  dspSatisfaction: 20,
};
const DSP_W = {
  trainingAndCredentials: 30,
  documentationTimeliness: 25,
  reliability: 20,
  hmReview: 25,
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

type Row = Record<string, unknown>;
const str = (v: unknown): string => String(v ?? "");
const num = (v: unknown): number => (typeof v === "number" ? v : Number(v ?? 0));

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return toIsoDate(dt);
}
/** Monday of the week containing `iso` (mirrors recognition_week_start). */
function mondayOfWeekIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // Sun=0
  const isoDow = dow === 0 ? 7 : dow; // Mon=1..Sun=7
  return addDaysIso(iso, -(isoDow - 1));
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
function weekRangeLabel(weekStart: string): string {
  const end = addDaysIso(weekStart, 6);
  const [, sm, sd] = weekStart.split("-").map(Number);
  const [, em, ed] = end.split("-").map(Number);
  return `${MONTHS[sm - 1]} ${sd} – ${MONTHS[em - 1]} ${ed}`;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
/** Nothing due -> neutral half weight (absence of work is not a demerit). */
function onTimePoints(due: number, onTime: number, weight: number): number {
  if (due <= 0) return weight / 2;
  return clamp01(onTime / due) * weight;
}
/** Null average (no ratings yet) -> neutral half weight. */
function ratingPoints(avg: number | null, weight: number): number {
  if (avg === null || !Number.isFinite(avg)) return weight / 2;
  const c = Math.min(5, Math.max(1, avg));
  return ((c - 1) / 4) * weight;
}
function sharePoints(share: number, weight: number): number {
  return clamp01(share) * weight;
}
function avg(nums: number[]): number | null {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
/**
 * Positive-only highlight labels for a winner's breakdown.
 * MUST match buildHighlights() in src/recognition/scoring.ts.
 */
function buildHighlights(
  category: "hm_of_the_week" | "dsp_of_the_week",
  breakdown: Row,
): string[] {
  const highlights: string[] = [];
  const entries: Array<[string, string, number]> =
    category === "hm_of_the_week"
      ? [
          ["weeklyChecklistsOnTime", "Weekly checklists completed on time", HM_W.weeklyChecklistsOnTime],
          ["monthlyChecksOnTime", "Monthly checks completed on time", HM_W.monthlyChecksOnTime],
          ["siteComplianceStanding", "Strong site compliance standing", HM_W.siteComplianceStanding],
          ["dspSatisfaction", "High team satisfaction", HM_W.dspSatisfaction],
        ]
      : [
          ["trainingAndCredentials", "Training and credentials current", DSP_W.trainingAndCredentials],
          ["documentationTimeliness", "Documentation completed on time", DSP_W.documentationTimeliness],
          ["reliability", "Consistent and reliable", DSP_W.reliability],
          ["hmReview", "High marks from their house manager", DSP_W.hmReview],
        ];
  for (const [key, label, weight] of entries) {
    const points = num(breakdown[key]);
    if (weight > 0 && points / weight >= 0.8) highlights.push(label);
  }
  return highlights;
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

  // -- Authorization: service_role key OR a member holding ---------------
  // -- recognition.manage (administrator, compliance_admin, DPM, program
  // -- manager per the canonical templates). JWT callers are scoped to the
  // -- agencies where they hold the permission.
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearer = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : "";
  if (!bearer) return fail("Missing authorization", 401);

  const admin = createClient(url, service);
  const today = toIsoDate(new Date());
  let authorized = false;
  let actor = "service_role";
  // Agencies this caller may run selection for (service_role: unrestricted).
  let managedAgencyIds: string[] | null = null;
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
      const { data: mrows } = await admin
        .from("memberships")
        .select("agency_id, role_key, expires_on")
        .eq("user_id", user.id);
      const active = ((mrows ?? []) as Row[]).filter((m) => {
        const exp = m.expires_on as string | null;
        return !exp || exp >= today;
      });
      const roleKeys = [...new Set(active.map((m) => str(m.role_key)))];
      const agencyByRole = new Map<string, Set<string>>();
      for (const m of active) {
        const a = str(m.agency_id);
        const r = str(m.role_key);
        if (!agencyByRole.has(a)) agencyByRole.set(a, new Set());
        agencyByRole.get(a)!.add(r);
      }
      if (roleKeys.length > 0) {
        // Per-agency customized templates first, canonical matrix as fallback.
        const { data: customRows } = await admin
          .from("agency_roles")
          .select("agency_id, template_key, permissions")
          .in("template_key", roleKeys);
        const { data: matrixRows } = await admin
          .from("role_permission_matrix")
          .select("role_key, permissions")
          .in("role_key", roleKeys);
        const matrixManage = new Set(
          ((matrixRows ?? []) as Row[])
            .filter((r) => (r.permissions as Row)?.["recognition.manage"] === true)
            .map((r) => str(r.role_key)),
        );
        const managed = new Set<string>();
        for (const [agencyId, roles] of agencyByRole) {
          let ok = false;
          let customized = false;
          for (const r of (customRows ?? []) as Row[]) {
            if (str(r.agency_id) === agencyId && roles.has(str(r.template_key))) {
              customized = true; // per-agency template overrides the canonical one
              if ((r.permissions as Row)?.["recognition.manage"] === true) {
                ok = true;
                break;
              }
            }
          }
          if (!ok && !customized) {
            for (const role of roles) {
              if (matrixManage.has(role)) {
                ok = true;
                break;
              }
            }
          }
          if (ok) managed.add(agencyId);
        }
        if (managed.size > 0) {
          authorized = true;
          actor = user.id;
          managedAgencyIds = [...managed];
        }
      }
    }
  }
  if (!authorized) {
    return fail("Not authorized: service_role or recognition.manage is required.", 403);
  }

  const warnings: string[] = [];

  // -- Target week ------------------------------------------------------------
  let body: Row = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as Row;
    } catch {
      body = {};
    }
  }
  const rawWeek = typeof body.week_start === "string" ? body.week_start : null;
  // Default: the most recent week whose Monday-4pm checklist deadline has
  // passed (mirrors defaultRecognitionWeekStart in src/recognition/scoring.ts).
  // The Sunday 06:05 UTC scheduler run therefore scores the week that ended
  // seven days earlier.
  const defaultWeek = (() => {
    const t = Date.now();
    let monday = mondayOfWeekIso(today);
    while (new Date(`${addDaysIso(monday, 7)}T22:00:00Z`).getTime() > t) {
      monday = addDaysIso(monday, -7);
    }
    return monday;
  })();
  const weekStart = rawWeek && /^\d{4}-\d{2}-\d{2}$/.test(rawWeek)
    ? mondayOfWeekIso(rawWeek)
    : defaultWeek;
  const monthKey = weekStart.slice(0, 7);
  const weekLabel = weekRangeLabel(weekStart);
  // Checklist weeks are Sunday-keyed; the recognition Monday's checklist week
  // is the Sunday just before it, due the following Monday 4pm local
  // (approximated as Monday 22:00 UTC).
  const checklistSunday = addDaysIso(weekStart, -1);
  const checklistDeadline = `${addDaysIso(weekStart, 7)}T22:00:00Z`;
  const agencyFilter = typeof body.agency_id === "string" ? body.agency_id : null;

  // -- Agencies ----------------------------------------------------------------
  let agencyQuery = admin.from("agencies").select("id").eq("status", "active");
  if (agencyFilter) {
    if (managedAgencyIds && !managedAgencyIds.includes(agencyFilter)) {
      return fail("Not authorized for that agency.", 403);
    }
    agencyQuery = agencyQuery.eq("id", agencyFilter);
  } else if (managedAgencyIds) {
    agencyQuery = agencyQuery.in("id", managedAgencyIds);
  }
  const { data: agencies, error: agencyError } = await agencyQuery;
  if (agencyError) {
    console.error("select-weekly-winners: agency lookup failed", agencyError.message);
    return fail("Could not load agencies.", 500);
  }

  const results: Array<Row> = [];

  for (const agencyRow of (agencies ?? []) as Row[]) {
    const agencyId = str(agencyRow.id);

    // Skip weeks already decided (idempotency) — but still report them.
    const { data: existing } = await admin
      .from("recognition_winners")
      .select("category, winner_id")
      .eq("agency_id", agencyId)
      .eq("week_start", weekStart);
    const decided = new Map(
      ((existing ?? []) as Row[]).map((r) => [str(r.category), str(r.winner_id)]),
    );

    // -- People ----------------------------------------------------------------
    const { data: memberships } = await admin
      .from("memberships")
      .select("user_id, role_key, site_id, expires_on")
      .eq("agency_id", agencyId);
    const activeMembers = ((memberships ?? []) as Row[]).filter((m) => {
      const exp = m.expires_on as string | null;
      return !exp || exp >= today;
    });
    const hms = activeMembers.filter((m) => m.role_key === HM_ROLE_KEY);
    const dsps = activeMembers.filter((m) => m.role_key === DSP_ROLE_KEY);

    const userIds = [...new Set(activeMembers.map((m) => str(m.user_id)))];
    const names = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);
      for (const p of (profiles ?? []) as Row[]) {
        names.set(str(p.id), str(p.full_name) || "Staff member");
      }
    }
    const nameOf = (id: string) => names.get(id) ?? "Staff member";

    // -- Shared inputs -----------------------------------------------------------
    // Weekly checklists for the target week. Checklist rows are Sunday-keyed
    // (week_of); the recognition week's checklist week is checklistSunday.
    // On-time means submitted by the Monday-4pm deadline (checklistDeadline).
    const { data: checklists } = await admin
      .from("hm_weekly_checklists")
      .select("assigned_to_user_id, submitted_at")
      .eq("agency_id", agencyId)
      .eq("week_of", checklistSunday);
    const checklistsByHm = new Map<string, Row[]>();
    for (const c of (checklists ?? []) as Row[]) {
      const k = str(c.assigned_to_user_id);
      if (!checklistsByHm.has(k)) checklistsByHm.set(k, []);
      checklistsByHm.get(k)!.push(c);
    }

    // Monthly due days (default 7th).
    const { data: dueRow } = await admin
      .from("agency_monthly_due")
      .select("equipment_day, drill_day, safety_day")
      .eq("agency_id", agencyId)
      .maybeSingle();
    const dueDay = (v: unknown) =>
      typeof v === "number" && v >= 1 && v <= 28 ? v : 7;
    const monthlyDue = {
      equipment: `${monthKey}-${String(dueDay((dueRow as Row | null)?.equipment_day)).padStart(2, "0")}`,
      drills: `${monthKey}-${String(dueDay((dueRow as Row | null)?.drill_day)).padStart(2, "0")}`,
      safety: `${monthKey}-${String(dueDay((dueRow as Row | null)?.safety_day)).padStart(2, "0")}`,
    };

    // Monthly check records for the target month.
    const { data: drills } = await admin
      .from("emergency_drills")
      .select("site_id, date")
      .eq("agency_id", agencyId)
      .eq("month_key", monthKey);
    const { data: safetyReports } = await admin
      .from("home_safety_reports")
      .select("site_id, lines, created_at")
      .eq("agency_id", agencyId)
      .eq("month_key", monthKey);
    // Equipment: logs joined to equipment -> individual -> site.
    const { data: equipment } = await admin
      .from("adaptive_equipment")
      .select("id, individual_id")
      .eq("agency_id", agencyId)
      .eq("active", true);
    const individualIds = [...new Set(((equipment ?? []) as Row[]).map((e) => str(e.individual_id)))];
    const individualSite = new Map<string, string>();
    if (individualIds.length > 0) {
      const { data: individuals } = await admin
        .from("individuals")
        .select("id, site_id")
        .in("id", individualIds);
      for (const i of (individuals ?? []) as Row[]) {
        individualSite.set(str(i.id), str(i.site_id));
      }
    }
    const equipmentIds = ((equipment ?? []) as Row[]).map((e) => str(e.id));
    const equipmentLogs = new Map<string, string | null>(); // equipmentId -> checked_on
    if (equipmentIds.length > 0) {
      const { data: logs } = await admin
        .from("equipment_month_logs")
        .select("equipment_id, checked_on")
        .eq("agency_id", agencyId)
        .eq("month_key", monthKey)
        .in("equipment_id", equipmentIds);
      for (const l of (logs ?? []) as Row[]) {
        equipmentLogs.set(str(l.equipment_id), (l.checked_on as string | null) ?? null);
      }
    }

    // DSP satisfaction: current ratings about each HM.
    const { data: dspRatings } = await admin
      .from("dsp_hm_ratings")
      .select("hm_id, rating")
      .eq("agency_id", agencyId);
    const ratingsByHm = new Map<string, number[]>();
    for (const r of (dspRatings ?? []) as Row[]) {
      const k = str(r.hm_id);
      if (!ratingsByHm.has(k)) ratingsByHm.set(k, []);
      ratingsByHm.get(k)!.push(num(r.rating));
    }

    // HM reviews of DSPs (current).
    const { data: hmReviews } = await admin
      .from("hm_dsp_reviews")
      .select("dsp_id, rating")
      .eq("agency_id", agencyId);
    const reviewsByDsp = new Map<string, number[]>();
    for (const r of (hmReviews ?? []) as Row[]) {
      const k = str(r.dsp_id);
      if (!reviewsByDsp.has(k)) reviewsByDsp.set(k, []);
      reviewsByDsp.get(k)!.push(num(r.rating));
    }

    // Training lines (DSP): initialed / total.
    const dspIds = dsps.map((m) => str(m.user_id));
    const trainingByDsp = new Map<string, { done: number; total: number }>();
    const certsByDsp = new Map<string, { valid: number; total: number }>();
    const ackByDsp = new Map<string, { signed: number; onTime: number; total: number }>();
    if (dspIds.length > 0) {
      const { data: training } = await admin
        .from("training_checklists")
        .select("staff_user_id, items")
        .eq("agency_id", agencyId)
        .in("staff_user_id", dspIds);
      for (const t of (training ?? []) as Row[]) {
        const k = str(t.staff_user_id);
        const items = Array.isArray(t.items) ? (t.items as Row[]) : [];
        const entry = trainingByDsp.get(k) ?? { done: 0, total: 0 };
        for (const item of items) {
          entry.total += 1;
          if (item.initialedAt) entry.done += 1;
        }
        trainingByDsp.set(k, entry);
      }
      const { data: certs } = await admin
        .from("staff_certificates")
        .select("user_id, expires_on")
        .eq("agency_id", agencyId)
        .in("user_id", dspIds);
      for (const c of (certs ?? []) as Row[]) {
        const k = str(c.user_id);
        const entry = certsByDsp.get(k) ?? { valid: 0, total: 0 };
        entry.total += 1;
        if (str(c.expires_on) >= today) entry.valid += 1;
        certsByDsp.set(k, entry);
      }
      // Acknowledgment rows: reliability (signed at all) + timeliness.
      // Only packets due during the target week count: documentation and
      // reliability are week-windowed, not lifetime.
      const { data: ackRows } = await admin
        .from("acknowledgment_rows")
        .select("user_id, signed_at, packet_id")
        .eq("agency_id", agencyId)
        .in("user_id", dspIds);
      const packetIds = [...new Set(((ackRows ?? []) as Row[]).map((r) => str(r.packet_id)))];
      const packetWindow = new Map<string, string>(); // packet_id -> due date
      if (packetIds.length > 0) {
        const { data: packets } = await admin
          .from("acknowledgment_packets")
          .select("id, starts_on, ends_on")
          .in("id", packetIds);
        const weekEnd = addDaysIso(weekStart, 6);
        for (const p of (packets ?? []) as Row[]) {
          const endsOn = str(p.ends_on);
          const dueDate = endsOn || addDaysIso(str(p.starts_on), 14);
          if (dueDate >= weekStart && dueDate <= weekEnd) {
            packetWindow.set(str(p.id), dueDate);
          }
        }
      }
      for (const r of (ackRows ?? []) as Row[]) {
        const dueDate = packetWindow.get(str(r.packet_id));
        if (!dueDate) continue; // packet not due this week — not scored
        const k = str(r.user_id);
        const entry = ackByDsp.get(k) ?? { signed: 0, onTime: 0, total: 0 };
        entry.total += 1;
        const signedAt = str(r.signed_at);
        if (signedAt) {
          entry.signed += 1;
          if (signedAt.slice(0, 10) <= dueDate) entry.onTime += 1;
        }
        ackByDsp.set(k, entry);
      }
    }

    // Site staff compliance (for HM siteComplianceStanding): DSPs at the site.
    const staffBySite = new Map<string, string[]>();
    for (const m of activeMembers) {
      if (m.role_key !== DSP_ROLE_KEY || !m.site_id) continue;
      const k = str(m.site_id);
      if (!staffBySite.has(k)) staffBySite.set(k, []);
      staffBySite.get(k)!.push(str(m.user_id));
    }
    const staffTrainingSigned = new Set<string>();
    const staffCertState = new Map<string, { valid: number; expired: number }>();
    const allStaffIds = [...new Set([...staffBySite.values()].flat())];
    if (allStaffIds.length > 0) {
      const { data: st } = await admin
        .from("training_checklists")
        .select("staff_user_id")
        .eq("agency_id", agencyId)
        .not("staff_signed_at", "is", null)
        .in("staff_user_id", allStaffIds);
      for (const r of (st ?? []) as Row[]) staffTrainingSigned.add(str(r.staff_user_id));
      const { data: sc } = await admin
        .from("staff_certificates")
        .select("user_id, expires_on")
        .eq("agency_id", agencyId)
        .in("user_id", allStaffIds);
      for (const c of (sc ?? []) as Row[]) {
        const k = str(c.user_id);
        const entry = staffCertState.get(k) ?? { valid: 0, expired: 0 };
        if (str(c.expires_on) >= today) entry.valid += 1;
        else entry.expired += 1;
        staffCertState.set(k, entry);
      }
    }
    function siteComplianceShare(siteIds: string[]): number {
      const staff = [...new Set(siteIds.flatMap((s) => staffBySite.get(s) ?? []))];
      if (staff.length === 0) return 0.5; // neutral: no assigned staff
      let sum = 0;
      for (const id of staff) {
        const trainingLeg = staffTrainingSigned.has(id) ? 1 : 0;
        const cert = staffCertState.get(id);
        const certLeg = !cert || cert.valid + cert.expired === 0
          ? 0.5
          : cert.expired > 0
            ? 0
            : 1;
        sum += (trainingLeg + certLeg) / 2;
      }
      return sum / staff.length;
    }

    // -- Score HMs ---------------------------------------------------------------
    type Candidate = { id: string; score: number; breakdown: Row };
    const hmCandidates: Candidate[] = [];
    const hmSiteIds = new Map<string, string[]>();
    for (const m of hms) {
      const id = str(m.user_id);
      const sites = m.site_id ? [str(m.site_id)] : [];
      hmSiteIds.set(id, sites);

      const lists = checklistsByHm.get(id) ?? [];
      const due = lists.length;
      const onTime = lists.filter((c) => {
        const submitted = str(c.submitted_at);
        return submitted && submitted <= checklistDeadline;
      }).length;

      // Monthly checks: 3 kinds per site.
      let monthlyChecksDue = 0;
      let monthlyChecksOnTime = 0;
      for (const siteId of sites) {
        // drills
        monthlyChecksDue += 1;
        const drill = ((drills ?? []) as Row[]).find(
          (d) => str(d.site_id) === siteId && str(d.date),
        );
        if (drill && str(drill.date) <= monthlyDue.drills) monthlyChecksOnTime += 1;
        // safety
        monthlyChecksDue += 1;
        const safety = ((safetyReports ?? []) as Row[]).find(
          (s) => str(s.site_id) === siteId &&
            Array.isArray(s.lines) && (s.lines as unknown[]).length > 0,
        );
        if (safety && str(safety.created_at).slice(0, 10) <= monthlyDue.safety) {
          monthlyChecksOnTime += 1;
        }
        // equipment: every active item at the site checked this month
        monthlyChecksDue += 1;
        const siteEquipment = ((equipment ?? []) as Row[]).filter(
          (e) => individualSite.get(str(e.individual_id)) === siteId,
        );
        if (siteEquipment.length === 0) {
          monthlyChecksDue -= 1; // nothing to check: not a demerit
        } else {
          // Complete only when every active item was checked this month;
          // on time only when every check beat the monthly due date.
          const allOnTime = siteEquipment.every((e) => {
            const checkedOn = equipmentLogs.get(str(e.id));
            return !!checkedOn && checkedOn <= monthlyDue.equipment;
          });
          if (allOnTime) monthlyChecksOnTime += 1;
        }
      }

      const breakdown = {
        weeklyChecklistsOnTime: round2(onTimePoints(due, onTime, HM_W.weeklyChecklistsOnTime)),
        monthlyChecksOnTime: round2(onTimePoints(monthlyChecksDue, monthlyChecksOnTime, HM_W.monthlyChecksOnTime)),
        siteComplianceStanding: round2(sharePoints(siteComplianceShare(sites), HM_W.siteComplianceStanding)),
        dspSatisfaction: round2(ratingPoints(avg(ratingsByHm.get(id) ?? []), HM_W.dspSatisfaction)),
      };
      const score = round2(
        breakdown.weeklyChecklistsOnTime + breakdown.monthlyChecksOnTime +
        breakdown.siteComplianceStanding + breakdown.dspSatisfaction,
      );
      hmCandidates.push({ id, score, breakdown });
    }

    // -- Score DSPs ---------------------------------------------------------------
    const dspCandidates: Candidate[] = [];
    for (const m of dsps) {
      const id = str(m.user_id);
      const training = trainingByDsp.get(id);
      const trainingShare = training && training.total > 0 ? training.done / training.total : 0.5;
      const certs = certsByDsp.get(id);
      const credentialsShare = certs && certs.total > 0 ? certs.valid / certs.total : 0.5;
      const ack = ackByDsp.get(id);
      const documentationTimelinessShare =
        ack && ack.signed > 0 ? ack.onTime / ack.signed : 0.5;
      const reliabilityShare =
        ack && ack.total > 0 ? ack.signed / ack.total : 0.5;
      // THERAP-EXDF-EXTENSION: when the Therap External Data Feed is
      // provisioned, blend expected-vs-submitted T-Log coverage into
      // documentationTimelinessShare here (see docs/recognition-scoring.md).
      const breakdown = {
        trainingAndCredentials: round2(
          sharePoints(trainingShare, DSP_W.trainingAndCredentials / 2) +
          sharePoints(credentialsShare, DSP_W.trainingAndCredentials / 2),
        ),
        documentationTimeliness: round2(
          sharePoints(documentationTimelinessShare, DSP_W.documentationTimeliness),
        ),
        reliability: round2(sharePoints(reliabilityShare, DSP_W.reliability)),
        hmReview: round2(ratingPoints(avg(reviewsByDsp.get(id) ?? []), DSP_W.hmReview)),
      };
      const score = round2(
        breakdown.trainingAndCredentials + breakdown.documentationTimeliness +
        breakdown.reliability + breakdown.hmReview,
      );
      dspCandidates.push({ id, score, breakdown });
    }

    function pickBest(candidates: Candidate[]): Candidate | null {
      if (candidates.length === 0) return null;
      let best = candidates[0];
      for (const c of candidates.slice(1)) {
        if (c.score > best.score || (c.score === best.score && c.id < best.id)) {
          best = c;
        }
      }
      return best;
    }

    const hmWinner = decided.has("hm_of_the_week")
      ? null
      : pickBest(hmCandidates);
    const dspWinner = decided.has("dsp_of_the_week")
      ? null
      : pickBest(dspCandidates);

    // -- Persist snapshots (managers/admins only via RLS) -------------------------
    const snapshotRows: Row[] = [];
    for (const c of hmCandidates) {
      snapshotRows.push({
        agency_id: agencyId,
        week_start: weekStart,
        category: "hm_of_the_week",
        candidate_id: c.id,
        score: c.score,
        score_breakdown: c.breakdown,
      });
    }
    for (const c of dspCandidates) {
      snapshotRows.push({
        agency_id: agencyId,
        week_start: weekStart,
        category: "dsp_of_the_week",
        candidate_id: c.id,
        score: c.score,
        score_breakdown: c.breakdown,
      });
    }
    if (snapshotRows.length > 0) {
      const { error: snapError } = await admin
        .from("recognition_score_snapshots")
        .upsert(snapshotRows, {
          onConflict: "agency_id,week_start,category,candidate_id",
          ignoreDuplicates: true,
        });
      if (snapError) {
        console.error("select-weekly-winners: snapshot upsert failed", snapError.message);
        warnings.push(`snapshot upsert failed for agency ${agencyId}: ${snapError.message}`);
      }
    }

    // -- Persist winners (idempotent) ----------------------------------------------
    // Winners store highlights ONLY — no scores — so the public table can
    // never leak a ranking. Scores stay in recognition_score_snapshots.
    const winnerRows: Row[] = [];
    if (hmWinner) {
      winnerRows.push({
        agency_id: agencyId,
        week_start: weekStart,
        category: "hm_of_the_week",
        winner_id: hmWinner.id,
        highlights: buildHighlights("hm_of_the_week", hmWinner.breakdown),
      });
    }
    if (dspWinner) {
      winnerRows.push({
        agency_id: agencyId,
        week_start: weekStart,
        category: "dsp_of_the_week",
        winner_id: dspWinner.id,
        highlights: buildHighlights("dsp_of_the_week", dspWinner.breakdown),
      });
    }
    const decidedNow: Array<{ category: string; winner: Candidate }> = [];
    if (winnerRows.length > 0) {
      const { data: inserted, error: winnerError } = await admin
        .from("recognition_winners")
        .upsert(winnerRows, {
          onConflict: "agency_id,week_start,category",
          ignoreDuplicates: true,
        })
        .select("category, winner_id");
      if (winnerError) {
        console.error("select-weekly-winners: winner upsert failed", winnerError.message);
        warnings.push(`winner upsert failed for agency ${agencyId}: ${winnerError.message}`);
      } else {
        for (const r of (inserted ?? []) as Row[]) {
          const category = str(r.category);
          const winner = category === "hm_of_the_week" ? hmWinner : dspWinner;
          if (winner && str(r.winner_id) === winner.id) {
            decidedNow.push({ category, winner });
          }
        }
      }
    }

    // -- Celebration notifications --------------------------------------------------
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
    for (const { category, winner } of decidedNow) {
      const isHm = category === "hm_of_the_week";
      const type = isHm ? "recognition.hm_winner" : "recognition.dsp_winner";
      const kindLabel = isHm ? "House Manager" : "DSP";
      const winnerName = nameOf(winner.id);
      // Personal celebration for the winner.
      notifications.push({
        agency_id: agencyId,
        user_id: winner.id,
        role_key: null,
        type,
        title: `You're ${kindLabel} of the Week`,
        body: `Congratulations, ${winnerName}. Your work stood out for the week of ${weekLabel}.`,
        deep_link: "/recognition",
        entity_type: "recognition_winner",
        entity_id: `${type}:${weekStart}`,
        dedupe_key: `${type}:${weekStart}:${winner.id}`,
      });
      // Team broadcasts: the winner's peers and the agency admins hear it too.
      for (const roleKey of ["administrator", isHm ? "dsp" : "house_manager"]) {
        notifications.push({
          agency_id: agencyId,
          user_id: null,
          role_key: roleKey,
          type,
          title: `${kindLabel} of the Week`,
          body: `${winnerName} is ${kindLabel} of the Week for the week of ${weekLabel}.`,
          deep_link: "/recognition",
          entity_type: "recognition_winner",
          entity_id: `${type}:${weekStart}`,
          dedupe_key: `${type}:${weekStart}:${roleKey}`,
        });
      }
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
        console.error("select-weekly-winners: notification insert failed", notifyError.message);
        warnings.push(`notification insert failed: ${notifyError.message}`);
      } else {
        notificationsQueued = (queued ?? []).length;
      }
    }

    results.push({
      agency_id: agencyId,
      hm_winner: hmWinner
        ? { id: hmWinner.id, full_name: nameOf(hmWinner.id) }
        : decided.has("hm_of_the_week")
          ? {
              id: decided.get("hm_of_the_week"),
              full_name: nameOf(decided.get("hm_of_the_week") ?? ""),
              already_decided: true,
            }
          : null,
      dsp_winner: dspWinner
        ? { id: dspWinner.id, full_name: nameOf(dspWinner.id) }
        : decided.has("dsp_of_the_week")
          ? {
              id: decided.get("dsp_of_the_week"),
              full_name: nameOf(decided.get("dsp_of_the_week") ?? ""),
              already_decided: true,
            }
          : null,
      already_decided: decidedNow.length === 0 && decided.size > 0,
      candidates_scored: hmCandidates.length + dspCandidates.length,
      notifications_queued: notificationsQueued,
    });
  }

  console.log("select-weekly-winners: run by", actor, {
    weekStart,
    agencies: results.length,
  });

  return json({ week_start: weekStart, agencies: results, warnings });
});
