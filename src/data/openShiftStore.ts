/**
 * Open-shift store: hosted (Supabase RPCs) and local demo implementations.
 *
 * Hosted: every write goes through a SECURITY DEFINER function in
 * 20260925150000_open_shifts.sql, which locks the posting so two staff can
 * never take the same last slot, and re-checks training, conflicts, time off
 * and the weekly hour limit on the server.
 *
 * Local demo: postings are shared across demo accounts in this browser.
 * Every demo staff member is treated as trained at every site, and conflicts
 * and hours only count shifts awarded through open shifts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "./index";
import {
  evaluatePickup,
  isOpenForResponses,
  permanentWeeklyHours,
  validateOpenShiftInput,
  type HrOpenShift,
  type HrOpenShiftResponse,
  type OpenShiftInput,
} from "./openShifts";

export type OpenShiftRespondResult = "picked_up" | "requested" | "declined";

export interface OpenShiftStore {
  listOpenShifts(): Promise<HrOpenShift[]>;
  listResponses(): Promise<HrOpenShiftResponse[]>;
  postOpenShift(input: OpenShiftInput): Promise<string>;
  respond(openShiftId: string, response: "pick_up" | "decline"): Promise<OpenShiftRespondResult>;
  decideBid(responseId: string, approve: boolean): Promise<"approved" | "denied">;
  cancelOpenShift(openShiftId: string): Promise<void>;
}

function mapOpenShift(row: Record<string, unknown>): HrOpenShift {
  return {
    id: String(row.id),
    agencyId: String(row.agency_id),
    siteId: String(row.site_id),
    kind: row.kind as HrOpenShift["kind"],
    audience: row.audience as HrOpenShift["audience"],
    title: String(row.title ?? ""),
    startsAt: (row.starts_at as string | null) ?? null,
    endsAt: (row.ends_at as string | null) ?? null,
    days: Array.isArray(row.days) ? (row.days as number[]).map(Number) : [],
    windowStart: (row.window_start as string | null) ?? null,
    windowEnd: (row.window_end as string | null) ?? null,
    effectiveFrom: (row.effective_from as string | null) ?? null,
    weeklyHours: Number(row.weekly_hours ?? 0),
    notes: String(row.notes ?? ""),
    slots: Number(row.slots ?? 1),
    filledCount: Number(row.filled_count ?? 0),
    pickupMode: row.pickup_mode as HrOpenShift["pickupMode"],
    status: row.status as HrOpenShift["status"],
    postedBy: String(row.posted_by),
    postedByName: String(row.posted_by_name ?? ""),
    createdAt: String(row.created_at),
  };
}

function mapResponse(row: Record<string, unknown>): HrOpenShiftResponse {
  return {
    id: String(row.id),
    openShiftId: String(row.open_shift_id),
    staffId: String(row.staff_id),
    staffName: String(row.staff_name ?? ""),
    response: row.response as HrOpenShiftResponse["response"],
    decision: (row.decision as HrOpenShiftResponse["decision"]) ?? null,
    trainedAtSite: Boolean(row.trained_at_site),
    wouldBeOvertime: Boolean(row.would_be_overtime),
    weekHoursBefore: Number(row.week_hours_before ?? 0),
    respondedAt: String(row.responded_at),
  };
}

/** Database messages are already written for staff; drop the transport prefix. */
function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

class SupabaseOpenShiftStore implements OpenShiftStore {
  constructor(private client: SupabaseClient, private agencyId: string) {}

  async listOpenShifts(): Promise<HrOpenShift[]> {
    const { data, error } = await this.client
      .from("hr_open_shifts")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("created_at", { ascending: false })
      .limit(200);
    fail(error);
    return (data ?? []).map((r) => mapOpenShift(r as Record<string, unknown>));
  }

  async listResponses(): Promise<HrOpenShiftResponse[]> {
    const { data, error } = await this.client
      .from("hr_open_shift_responses")
      .select("*")
      .eq("agency_id", this.agencyId)
      .order("responded_at", { ascending: true })
      .limit(1000);
    fail(error);
    return (data ?? []).map((r) => mapResponse(r as Record<string, unknown>));
  }

  async postOpenShift(input: OpenShiftInput): Promise<string> {
    const problems = validateOpenShiftInput(input);
    if (problems.length) throw new Error(problems.join(" "));
    const { data, error } = await this.client.rpc("post_open_shift", {
      p_site_id: input.siteId,
      p_kind: input.kind,
      p_title: input.title.trim(),
      p_starts_at: input.kind === "temporary" ? input.startsAt : null,
      p_ends_at: input.kind === "temporary" ? input.endsAt : null,
      p_days: input.kind === "permanent" ? input.days ?? [] : [],
      p_window_start: input.kind === "permanent" ? input.windowStart : null,
      p_window_end: input.kind === "permanent" ? input.windowEnd : null,
      p_effective_from: input.kind === "permanent" ? input.effectiveFrom : null,
      p_notes: input.notes ?? "",
      p_slots: input.slots ?? 1,
      p_pickup_mode: input.pickupMode ?? "approval",
      p_audience: input.audience,
    });
    fail(error);
    return String(data);
  }

  async respond(openShiftId: string, response: "pick_up" | "decline"): Promise<OpenShiftRespondResult> {
    const { data, error } = await this.client.rpc("respond_open_shift", {
      p_open_shift_id: openShiftId,
      p_response: response,
    });
    fail(error);
    return data as OpenShiftRespondResult;
  }

  async decideBid(responseId: string, approve: boolean): Promise<"approved" | "denied"> {
    const { data, error } = await this.client.rpc("decide_open_shift_request", {
      p_response_id: responseId,
      p_approve: approve,
    });
    fail(error);
    return data as "approved" | "denied";
  }

  async cancelOpenShift(openShiftId: string): Promise<void> {
    const { error } = await this.client.rpc("cancel_open_shift", { p_open_shift_id: openShiftId });
    fail(error);
  }
}

/* ------------------------------ local demo ------------------------------ */

const LOCAL_KEY = "complyra.openShifts.v1";

interface LocalAward {
  staffId: string;
  startsAt: string;
  endsAt: string;
  weeklyHours: number;
  kind: "temporary" | "permanent";
}

interface LocalOpenShiftBucket {
  shifts: HrOpenShift[];
  responses: HrOpenShiftResponse[];
  awards: LocalAward[];
}

export interface LocalOpenShiftActor {
  agencyId: string;
  userId: string;
  fullName: string;
  /** Mirrors hub.manage_schedule (site postings, decisions). */
  canManageSchedule: boolean;
  /** HR or administrator with hub.manage_staffing (agency-wide postings). */
  canPostAgencyWide: boolean;
}

/** Shared by every demo account in this page, so postings reach other staff. */
const localMemory = new Map<string, LocalOpenShiftBucket>();

export class LocalOpenShiftStore implements OpenShiftStore {
  constructor(private actor: LocalOpenShiftActor, private now: () => Date = () => new Date()) {}

  private load(): LocalOpenShiftBucket {
    let bucket = localMemory.get(this.actor.agencyId) ?? { shifts: [], responses: [], awards: [] };
    try {
      // Re-read storage each time so other demo accounts' changes show up.
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(LOCAL_KEY) : null;
      if (raw) {
        const root = JSON.parse(raw) as Record<string, LocalOpenShiftBucket>;
        bucket = root[this.actor.agencyId] ?? bucket;
      }
    } catch {
      // Unavailable or corrupt storage: keep the in-memory copy.
    }
    localMemory.set(this.actor.agencyId, bucket);
    return bucket;
  }

  private save(bucket: LocalOpenShiftBucket): void {
    localMemory.set(this.actor.agencyId, bucket);
    try {
      if (typeof localStorage === "undefined") return;
      const raw = localStorage.getItem(LOCAL_KEY);
      const root = raw ? (JSON.parse(raw) as Record<string, LocalOpenShiftBucket>) : {};
      root[this.actor.agencyId] = bucket;
      localStorage.setItem(LOCAL_KEY, JSON.stringify(root));
    } catch {
      // Keep the in-memory copy.
    }
  }

  private canManage(shift: HrOpenShift): boolean {
    return shift.audience === "agency" ? this.actor.canPostAgencyWide : this.actor.canManageSchedule;
  }

  async listOpenShifts(): Promise<HrOpenShift[]> {
    return [...this.load().shifts].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listResponses(): Promise<HrOpenShiftResponse[]> {
    const bucket = this.load();
    return bucket.responses.filter((r) => {
      if (r.staffId === this.actor.userId) return true;
      const shift = bucket.shifts.find((s) => s.id === r.openShiftId);
      return !!shift && this.canManage(shift);
    });
  }

  async postOpenShift(input: OpenShiftInput): Promise<string> {
    const problems = validateOpenShiftInput(input, this.now());
    if (problems.length) throw new Error(problems.join(" "));
    if (input.audience === "agency" ? !this.actor.canPostAgencyWide : !this.actor.canManageSchedule) {
      throw new Error(input.audience === "agency"
        ? "Only HR can post agency-wide openings."
        : "You can post open shifts only for sites you manage.");
    }
    const bucket = this.load();
    const permanent = input.kind === "permanent";
    const shift: HrOpenShift = {
      id: `os-${crypto.randomUUID().slice(0, 8)}`,
      agencyId: this.actor.agencyId,
      siteId: input.siteId,
      kind: input.kind,
      audience: input.audience,
      title: input.title.trim(),
      startsAt: permanent ? null : input.startsAt ?? null,
      endsAt: permanent ? null : input.endsAt ?? null,
      days: permanent ? [...new Set(input.days ?? [])].sort((a, b) => a - b) : [],
      windowStart: permanent ? input.windowStart ?? null : null,
      windowEnd: permanent ? input.windowEnd ?? null : null,
      effectiveFrom: permanent ? input.effectiveFrom ?? null : null,
      weeklyHours: permanent
        ? permanentWeeklyHours(input.days ?? [], input.windowStart ?? "00:00", input.windowEnd ?? "00:00")
        : 0,
      notes: input.notes ?? "",
      slots: input.slots ?? 1,
      filledCount: 0,
      pickupMode: permanent ? "approval" : input.pickupMode ?? "approval",
      status: "open",
      postedBy: this.actor.userId,
      postedByName: this.actor.fullName,
      createdAt: this.now().toISOString(),
    };
    bucket.shifts.push(shift);
    this.save(bucket);
    return shift.id;
  }

  private evaluate(bucket: LocalOpenShiftBucket, shift: HrOpenShift, staffId: string) {
    const awards = bucket.awards.filter((a) => a.staffId === staffId);
    return evaluatePickup({
      shift,
      trainedAtSite: true,
      existingShifts: awards
        .filter((a) => a.kind === "temporary")
        .map((a) => ({ startsAt: a.startsAt, endsAt: a.endsAt, status: "published" as const })),
      recurringHours: awards.filter((a) => a.kind === "permanent").reduce((sum, a) => sum + a.weeklyHours, 0),
    });
  }

  private fill(bucket: LocalOpenShiftBucket, shift: HrOpenShift, staffId: string): void {
    bucket.awards.push({
      staffId,
      startsAt: shift.startsAt ?? "",
      endsAt: shift.endsAt ?? "",
      weeklyHours: shift.weeklyHours,
      kind: shift.kind,
    });
    shift.filledCount += 1;
    if (shift.filledCount >= shift.slots) shift.status = "filled";
  }

  async respond(openShiftId: string, response: "pick_up" | "decline"): Promise<OpenShiftRespondResult> {
    const bucket = this.load();
    const shift = bucket.shifts.find((s) => s.id === openShiftId);
    if (!shift) throw new Error("This open shift isn't available to you.");
    if (!isOpenForResponses(shift, this.now())) throw new Error("This shift is no longer open.");
    const existing = bucket.responses.find((r) => r.openShiftId === shift.id && r.staffId === this.actor.userId);
    if (existing && (existing.response === "picked_up" || existing.decision === "approved")) {
      throw new Error("You already have this shift.");
    }
    const upsert = (patch: Partial<HrOpenShiftResponse> & Pick<HrOpenShiftResponse, "response">) => {
      const row: HrOpenShiftResponse = {
        id: existing?.id ?? `osr-${crypto.randomUUID().slice(0, 8)}`,
        openShiftId: shift.id,
        staffId: this.actor.userId,
        staffName: this.actor.fullName,
        decision: null,
        trainedAtSite: true,
        wouldBeOvertime: false,
        weekHoursBefore: 0,
        respondedAt: this.now().toISOString(),
        ...patch,
      };
      bucket.responses = bucket.responses.filter((r) => r.id !== row.id).concat(row);
    };
    if (response === "decline") {
      upsert({ response: "declined" });
      this.save(bucket);
      return "declined";
    }
    const evaluation = this.evaluate(bucket, shift, this.actor.userId);
    if (evaluation.blocker) throw new Error(evaluation.blocker);
    if (!evaluation.direct) {
      upsert({ response: "requested", wouldBeOvertime: evaluation.wouldBeOvertime, weekHoursBefore: evaluation.weekHours });
      this.save(bucket);
      return "requested";
    }
    this.fill(bucket, shift, this.actor.userId);
    upsert({ response: "picked_up", weekHoursBefore: evaluation.weekHours });
    this.save(bucket);
    return "picked_up";
  }

  async decideBid(responseId: string, approve: boolean): Promise<"approved" | "denied"> {
    const bucket = this.load();
    const bid = bucket.responses.find((r) => r.id === responseId);
    const shift = bid && bucket.shifts.find((s) => s.id === bid.openShiftId);
    if (!bid || !shift) throw new Error("Bid not found.");
    if (!this.canManage(shift)) throw new Error("Only a manager of this posting can decide bids.");
    if (bid.response !== "requested" || bid.decision) throw new Error("This bid has already been handled.");
    if (!approve) {
      bid.decision = "denied";
      this.save(bucket);
      return "denied";
    }
    if (!isOpenForResponses(shift, this.now())) throw new Error("This shift is no longer open.");
    const evaluation = this.evaluate(bucket, shift, bid.staffId);
    if (evaluation.blocker) throw new Error(evaluation.blocker);
    this.fill(bucket, shift, bid.staffId);
    bid.decision = "approved";
    this.save(bucket);
    return "approved";
  }

  async cancelOpenShift(openShiftId: string): Promise<void> {
    const bucket = this.load();
    const shift = bucket.shifts.find((s) => s.id === openShiftId);
    if (!shift || !this.canManage(shift)) throw new Error("Only a manager of this posting can cancel it.");
    if (shift.status !== "open") throw new Error("Only open postings can be cancelled.");
    shift.status = "cancelled";
    this.save(bucket);
  }
}

export function createOpenShiftStore(actor: LocalOpenShiftActor): OpenShiftStore {
  const client = createSupabaseBrowserClient();
  if (client) return new SupabaseOpenShiftStore(client, actor.agencyId);
  return new LocalOpenShiftStore(actor);
}
