/**
 * Open Shifts tab — HMs/PMs post coverage for their program sites (temporary
 * or permanent), HR posts permanent openings to the whole agency, and staff
 * pick up, bid on, or decline. Rules live in src/data/openShifts.ts and the
 * database functions in 20260925150000_open_shifts.sql.
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Send, X } from "lucide-react";
import { Empty } from "../../components";
import type { SessionUser } from "../../data/types";
import {
  DEFAULT_WEEKLY_LIMIT_HOURS,
  describeOpenShiftWhen,
  isOpenForResponses,
  permanentWeeklyHours,
  shiftHours,
  slotsLeft,
  validateOpenShiftInput,
  type HrOpenShift,
  type HrOpenShiftResponse,
  type OpenShiftInput,
  type OpenShiftKind,
  type OpenShiftPickupMode,
} from "../../data/openShifts";
import type { OpenShiftStore } from "../../data/openShiftStore";
import { STAFFING_DAY_LABELS } from "../../data/hr";

interface SiteOption {
  id: string;
  name: string;
}

/** The agency's usual shift times (HMs can still type any time). */
export const SHIFT_PRESETS: { label: string; start: string; end: string }[] = [
  { label: "Day 6:30a–2:30p", start: "06:30", end: "14:30" },
  { label: "Evening 2:30p–10:30p", start: "14:30", end: "22:30" },
  { label: "Overnight 10:30p–6:30a", start: "22:30", end: "06:30" },
  { label: "Short 6:30a–9:30a", start: "06:30", end: "09:30" },
];

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function todayStamp(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local date + "HH:MM" start/end → ISO instants; an earlier end runs to the next day. */
export function temporaryWindow(date: string, start: string, end: string): { startsAt: string; endsAt: string } | null {
  if (!date || !start || !end) return null;
  const s = new Date(`${date}T${start}:00`);
  const e = new Date(`${date}T${end}:00`);
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime())) return null;
  if (e <= s) e.setDate(e.getDate() + 1);
  return { startsAt: s.toISOString(), endsAt: e.toISOString() };
}

/**
 * Best candidates first: within 40 hours, trained at the site, fewest hours
 * already that week, then whoever bid first.
 */
export function rankBids(bids: HrOpenShiftResponse[]): HrOpenShiftResponse[] {
  return [...bids].sort(
    (a, b) =>
      Number(a.wouldBeOvertime) - Number(b.wouldBeOvertime) ||
      Number(b.trainedAtSite) - Number(a.trainedAtSite) ||
      a.weekHoursBefore - b.weekHoursBefore ||
      a.respondedAt.localeCompare(b.respondedAt),
  );
}

const RESPONSE_LABEL: Record<HrOpenShiftResponse["response"], string> = {
  picked_up: "Picked up",
  requested: "Bid sent",
  declined: "Declined",
};

function myStatusLabel(r: HrOpenShiftResponse | undefined): { text: string; cls: string } | null {
  if (!r) return null;
  if (r.decision === "approved") return { text: "Approved: it's yours", cls: "approved" };
  if (r.decision === "denied") return { text: "Not approved", cls: "denied" };
  if (r.response === "requested" && r.wouldBeOvertime) return { text: "Bid sent · past 41 hours, needs approval", cls: "due_soon" };
  return { text: RESPONSE_LABEL[r.response], cls: r.response === "declined" ? "denied" : r.response === "picked_up" ? "approved" : "pending" };
}

function kindLabel(shift: HrOpenShift): string {
  if (shift.kind === "permanent") return shift.audience === "agency" ? "Permanent · agency-wide" : "Permanent";
  return "Temporary";
}

export function OpenShiftsTab({
  session,
  store,
  sites,
  canPostSite,
  canPostAgency,
}: {
  session: SessionUser;
  store: OpenShiftStore;
  sites: SiteOption[];
  canPostSite: boolean;
  canPostAgency: boolean;
}) {
  const [shifts, setShifts] = useState<HrOpenShift[]>([]);
  const [responses, setResponses] = useState<HrOpenShiftResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  // Post form
  const [kind, setKind] = useState<OpenShiftKind>("temporary");
  const [siteId, setSiteId] = useState(session.siteId ?? sites[0]?.id ?? "");
  const [agencyWide, setAgencyWide] = useState(false);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(todayStamp(new Date(Date.now() + 86_400_000)));
  const [start, setStart] = useState("14:30");
  const [end, setEnd] = useState("22:30");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [effectiveFrom, setEffectiveFrom] = useState(todayStamp(new Date(Date.now() + 7 * 86_400_000)));
  const [pickupMode, setPickupMode] = useState<OpenShiftPickupMode>("approval");
  const [slots, setSlots] = useState(1);
  const [notes, setNotes] = useState("");

  const canPost = canPostSite || canPostAgency;
  const siteName = (id: string) => sites.find((s) => s.id === id)?.name ?? "Program site";

  const load = () => {
    setLoading(true);
    Promise.all([store.listOpenShifts(), store.listResponses()])
      .then(([s, r]) => {
        setShifts(s);
        setResponses(r);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load open shifts."));
        setLoading(false);
      });
  };
  useEffect(load, [store]);

  const mine = (shiftId: string) =>
    responses.find((r) => r.openShiftId === shiftId && r.staffId === session.userId);

  const now = new Date();
  const available = shifts.filter(
    (s) => s.postedBy !== session.userId && isOpenForResponses(s, now),
  );
  const managed = shifts.filter(
    (s) => s.postedBy === session.userId || (s.audience === "agency" ? canPostAgency : canPostSite),
  );

  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const message = await fn();
      if (message) setNotice(message);
      load();
    } catch (err) {
      setError(errMessage(err, "Something went wrong. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const respond = (shift: HrOpenShift, response: "pick_up" | "decline") =>
    run(async () => {
      const result = await store.respond(shift.id, response);
      if (result === "picked_up") return `${shift.title} is on your schedule.`;
      if (result === "requested") return `Bid sent for ${shift.title}. Your manager will approve or choose someone else.`;
      return `You declined ${shift.title}.`;
    });

  const draft: OpenShiftInput = useMemo(() => {
    const window = kind === "temporary" ? temporaryWindow(date, start, end) : null;
    return {
      siteId,
      kind,
      audience: kind === "permanent" && agencyWide ? "agency" : "site",
      title,
      startsAt: window?.startsAt ?? null,
      endsAt: window?.endsAt ?? null,
      days,
      windowStart: start,
      windowEnd: end,
      effectiveFrom,
      notes,
      slots,
      pickupMode: kind === "permanent" ? "approval" : pickupMode,
    };
  }, [siteId, kind, agencyWide, title, date, start, end, days, effectiveFrom, notes, slots, pickupMode]);

  const draftHours =
    kind === "temporary"
      ? draft.startsAt && draft.endsAt ? shiftHours(draft.startsAt, draft.endsAt) : 0
      : permanentWeeklyHours(days, start, end);

  const post = () =>
    run(async () => {
      const problems = validateOpenShiftInput(draft);
      if (problems.length) throw new Error(problems.join(" "));
      await store.postOpenShift(draft);
      setTitle("");
      setNotes("");
      return draft.audience === "agency"
        ? "Posted to everyone in the agency. Eligible staff were notified."
        : `Posted. Staff trained at ${siteName(siteId)} were notified.`;
    });

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort((a, b) => a - b)));

  return (
    <section className="hub-card" aria-label="Open shifts">
      <h2>Open Shifts</h2>
      <p className="hub-sub">
        Pick up or bid on coverage your managers post. The work week runs Sunday to Saturday. You can work up
        to {DEFAULT_WEEKLY_LIMIT_HOURS} hours a week (up to an hour over is fine); anything past 41 hours needs
        your manager&rsquo;s approval.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {notice && <div className="hub-status approved" role="status" style={{ marginBottom: 12 }}>{notice}</div>}

      <h3>Available to you</h3>
      {loading ? (
        <p>Loading…</p>
      ) : available.length === 0 ? (
        <Empty title="No open shifts right now" text="When a manager posts coverage you can take, it shows here and you get a notification." mark="quiet" />
      ) : (
        <ul className="hub-list">
          {available.map((s) => {
            const status = myStatusLabel(mine(s.id));
            const mineRow = mine(s.id);
            const taken = mineRow?.response === "picked_up" || mineRow?.decision === "approved";
            const bidPending = mineRow?.response === "requested" && !mineRow.decision;
            return (
              <li className="hub-list-item" key={s.id}>
                <div className="hub-item-main">
                  <span className="hub-item-title">{s.title} · {siteName(s.siteId)}</span>
                  <span className="hub-item-sub">
                    {describeOpenShiftWhen(s)} · {kindLabel(s)} ·{" "}
                    {s.kind === "permanent" || s.pickupMode === "approval" ? "Bid, manager picks" : "First come, first served"} ·{" "}
                    {slotsLeft(s)} of {s.slots} open
                    {s.notes ? ` · ${s.notes}` : ""}
                  </span>
                  {status && <span className={`hub-status ${status.cls}`} style={{ marginTop: 6 }}>{status.text}</span>}
                </div>
                {!taken && (
                  <div className="hub-form-actions" style={{ margin: 0 }}>
                    <button
                      className="hub-btn primary"
                      disabled={busy || bidPending}
                      onClick={() => respond(s, "pick_up")}
                      aria-label={`${s.kind === "permanent" || s.pickupMode === "approval" ? "Bid on" : "Pick up"} ${s.title}`}
                    >
                      <Check size={16} /> {s.kind === "permanent" || s.pickupMode === "approval" ? "Bid" : "Pick up"}
                    </button>
                    {mineRow?.response !== "declined" && (
                      <button className="hub-btn" disabled={busy} onClick={() => respond(s, "decline")} aria-label={`Decline ${s.title}`}>
                        <X size={16} /> Decline
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canPost && (
        <>
          <div className="hub-inline-form" style={{ marginTop: 24, marginBottom: 20 }}>
            <h3>Post coverage</h3>
            <div className="hub-form">
              <label>
                Type
                <select id="open-shift-kind" value={kind} onChange={(e) => setKind(e.target.value as OpenShiftKind)}>
                  <option value="temporary">Temporary: one shift</option>
                  <option value="permanent">Permanent: every week</option>
                </select>
              </label>
              <label>
                Program site
                <select id="open-shift-site" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                  {sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              {kind === "permanent" && canPostAgency && (
                <label>
                  Who can apply
                  <select id="open-shift-audience" value={agencyWide ? "agency" : "site"} onChange={(e) => setAgencyWide(e.target.value === "agency")}>
                    <option value="site">Staff trained at this site</option>
                    <option value="agency">Everyone in the agency</option>
                  </select>
                </label>
              )}
              <label className="hub-form-wide">
                Name
                <input id="open-shift-title" value={title} placeholder="Evening 2:30–10:30" onChange={(e) => setTitle(e.target.value)} />
              </label>
              <div className="hub-form-wide">
                <span className="hub-sub">Usual shifts</span>
                <div className="hub-chip-row" role="group" aria-label="Usual shift times">
                  {SHIFT_PRESETS.map((p) => (
                    <button
                      type="button"
                      key={p.label}
                      className="hub-chip"
                      aria-pressed={start === p.start && end === p.end}
                      onClick={() => {
                        setStart(p.start);
                        setEnd(p.end);
                        if (!title.trim()) setTitle(p.label);
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              {kind === "temporary" ? (
                <label>
                  Date
                  <input id="open-shift-date" type="date" value={date} min={todayStamp()} onChange={(e) => setDate(e.target.value)} />
                </label>
              ) : (
                <label>
                  Starts on
                  <input id="open-shift-effective" type="date" value={effectiveFrom} min={todayStamp()} onChange={(e) => setEffectiveFrom(e.target.value)} />
                </label>
              )}
              <label>
                Start time
                <input id="open-shift-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </label>
              <label>
                End time
                <input id="open-shift-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </label>
              {kind === "permanent" && (
                <div className="hub-form-wide">
                  <span className="hub-sub">Days</span>
                  <div className="hub-chip-row" role="group" aria-label="Days of the week">
                    {STAFFING_DAY_LABELS.map((label, d) => (
                      <button type="button" key={label} className="hub-chip" aria-pressed={days.includes(d)} onClick={() => toggleDay(d)}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {kind === "temporary" && (
                <label>
                  How it&rsquo;s filled
                  <select id="open-shift-mode" value={pickupMode} onChange={(e) => setPickupMode(e.target.value as OpenShiftPickupMode)}>
                    <option value="approval">Bids: I choose who gets it</option>
                    <option value="first_come">First come, first served</option>
                  </select>
                </label>
              )}
              <label>
                Staff needed
                <input id="open-shift-slots" type="number" min={1} max={10} value={slots} onChange={(e) => setSlots(Number(e.target.value))} />
              </label>
              <label className="hub-form-wide">
                Notes (optional)
                <textarea id="open-shift-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <p className="hub-form-wide hub-sub">
                {kind === "temporary"
                  ? `${draftHours || 0} hours. Anyone who would go past 41 hours that week (Sunday–Saturday) sends a bid for your approval instead of taking it.`
                  : `${draftHours} hours a week. Permanent shifts are always bids; approving one adds it to that person's recurring schedule.`}
              </p>
            </div>
            <div className="hub-form-actions">
              <button className="hub-btn primary" disabled={busy} onClick={post}>
                <Send size={16} /> Post shift
              </button>
            </div>
          </div>

          <h3>Your postings</h3>
          {managed.length === 0 ? (
            <Empty title="Nothing posted yet" text="Shifts you post, and who responded, show here." mark="quiet" />
          ) : (
            <ul className="hub-list">
              {managed.map((s) => {
                const rows = responses.filter((r) => r.openShiftId === s.id);
                const bids = rankBids(rows.filter((r) => r.response === "requested" && !r.decision));
                const filled = rows.filter((r) => r.response === "picked_up" || r.decision === "approved");
                const declined = rows.filter((r) => r.response === "declined");
                const open = isOpenForResponses(s, now);
                return (
                  <li className="hub-list-item" key={s.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
                    <div className="hub-item-main">
                      <span className="hub-item-title">{s.title} · {siteName(s.siteId)}</span>
                      <span className="hub-item-sub">
                        {describeOpenShiftWhen(s)} · {kindLabel(s)} · {s.filledCount} of {s.slots} filled
                      </span>
                      <span className={`hub-status ${s.status === "filled" ? "approved" : s.status === "cancelled" || !open ? "denied" : "info"}`} style={{ marginTop: 6 }}>
                        {s.status === "open" && !open ? "Closed: shift started" : s.status === "open" ? "Open" : s.status === "filled" ? "Filled" : "Cancelled"}
                      </span>
                    </div>
                    {filled.length > 0 && (
                      <p className="hub-sub" style={{ margin: "8px 0 0" }}>
                        Assigned: {filled.map((r) => r.staffName).join(", ")}
                      </p>
                    )}
                    {bids.length > 0 && (
                      <ul className="hub-list" style={{ marginTop: 8 }} aria-label={`Bids for ${s.title}`}>
                        {bids.map((b, i) => (
                          <li className="hub-list-item" key={b.id}>
                            <div className="hub-item-main">
                              <span className="hub-item-title">
                                {b.staffName}
                                {i === 0 && !b.wouldBeOvertime ? " · Best fit" : ""}
                              </span>
                              <span className="hub-item-sub">
                                {b.weekHoursBefore}h already {s.kind === "permanent" ? "per week" : "that week"}
                                {b.wouldBeOvertime ? " · past 41 hours: approving allows overtime" : ""}
                                {!b.trainedAtSite ? " · not trained at this site yet" : ""}
                              </span>
                            </div>
                            {open && (
                              <div className="hub-form-actions" style={{ margin: 0 }}>
                                <button className="hub-btn primary" disabled={busy} onClick={() => run(async () => {
                                  await store.decideBid(b.id, true);
                                  return `${b.staffName} has ${s.title}.`;
                                })}>
                                  <Check size={16} /> Approve
                                </button>
                                <button className="hub-btn" disabled={busy} onClick={() => run(async () => {
                                  await store.decideBid(b.id, false);
                                  return `${b.staffName}'s bid was not approved.`;
                                })}>
                                  <X size={16} /> Deny
                                </button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="hub-sub" style={{ margin: "8px 0 0" }}>
                      {declined.length > 0 ? `Declined: ${declined.map((r) => r.staffName).join(", ")}` : "No declines yet."}
                    </p>
                    {s.status === "open" && open && (
                      <div className="hub-form-actions">
                        <button className="hub-btn" disabled={busy} onClick={() => run(async () => {
                          await store.cancelOpenShift(s.id);
                          return `${s.title} was cancelled. Anyone already assigned keeps the shift.`;
                        })}>
                          <X size={16} /> Cancel posting
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
