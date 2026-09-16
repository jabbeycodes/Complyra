/**
 * Missed-punch review — managers approve or deny pending
 * hr_missed_punch_reports with an optional note. Approving hands the
 * report to the store, which creates the punch rows and writes the
 * correction-ledger entry; denying closes the report with the manager's
 * note. Decided reports stay visible below as an audit trail.
 *
 * Report shape is Worker 1's HrMissedPunchReport (matches the migration:
 * work_date, claimed_in_at/out_at, reviewed_by/at/note); Worker 3's exact
 * method names are consumed through adaptKioskStore, which normalizes.
 *
 * `initialReports` seeds the first render (tests / SSR).
 */
import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Empty } from "../../components";
import type { HrMissedPunchReport } from "../../data/hr";
import type { HrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import {
  adaptKioskStore,
  isKioskStoreAvailable,
} from "./kioskContracts";
import type { HubStaffEntry } from "./EmployeeHubPage";

function fmtDateTime(iso: string): string {
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function fmtDate(stamp: string): string {
  const d = new Date(stamp.length <= 10 ? `${stamp}T12:00:00` : stamp);
  return Number.isNaN(d.getTime())
    ? stamp
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

/** "Clock in → 8:05 AM" / "Clock out → 4:02 PM" from the claimed times. */
function claimedLabel(r: HrMissedPunchReport): string {
  const parts: string[] = [];
  if (r.claimedInAt) parts.push(`Clock in → ${fmtDateTime(r.claimedInAt)}`);
  if (r.claimedOutAt) parts.push(`Clock out → ${fmtDateTime(r.claimedOutAt)}`);
  return parts.join(" · ") || "No claimed time";
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function MissedPunchReview({
  session,
  store,
  staffList,
  initialReports,
  onChanged,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  initialReports?: HrMissedPunchReport[];
  onChanged?: () => void;
}) {
  const kiosk = useMemo(() => adaptKioskStore(store), [store]);
  const available = isKioskStoreAvailable(store);
  const [reports, setReports] = useState<HrMissedPunchReport[]>(initialReports ?? []);
  const [loading, setLoading] = useState(!initialReports && available);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");

  const staffName = (userId: string): string =>
    staffList.find((s) => s.userId === userId)?.fullName ?? "Unknown staff";

  const reviewerName = (userId: string | null): string =>
    userId ? staffName(userId) : "Unknown reviewer";

  const load = () => {
    if (!available) return;
    setLoading(true);
    setError("");
    kiosk
      .listMissedPunchReports({})
      .then((r) => {
        setReports(r);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load missed-punch reports."));
        setLoading(false);
      });
  };

  useEffect(load, [kiosk, available]);

  const pending = reports.filter((r) => r.status === "pending");
  const decided = reports.filter((r) => r.status !== "pending");

  const decide = async (report: HrMissedPunchReport, approve: boolean) => {
    setBusy(true);
    setError("");
    try {
      const updated = await kiosk.decideMissedPunchReport(
        report.id,
        approve,
        decisionNote.trim() ? decisionNote.trim() : undefined,
      );
      setReports((prev) => prev.map((r) => (r.id === report.id ? updated : r)));
      setDecidingId(null);
      setDecisionNote("");
      onChanged?.();
    } catch (err) {
      setError(errMessage(err, "Could not decide the report."));
    } finally {
      setBusy(false);
    }
  };

  if (!available) {
    return (
      <section className="hub-card" aria-label="Missed-punch review" style={{ marginTop: 16 }}>
        <h2>Missed-punch review</h2>
        <p className="hub-sub">
          The kiosk time clock is still being set up — missed-punch reports
          will appear here once it's live.
        </p>
      </section>
    );
  }

  void session;

  return (
    <section className="hub-card" aria-label="Missed-punch review" style={{ marginTop: 16 }}>
      <h2>Missed-punch review</h2>
      <p className="hub-sub">
        Staff-reported missed punches. Approving creates the punch rows;
        denying closes the report with your note.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading reports…</p>
      ) : pending.length === 0 ? (
        <Empty title="No pending reports" text="All missed-punch reports have been decided." mark="check" />
      ) : (
        <ul className="hub-list">
          {pending.map((r) => (
            <li className="hub-list-item" key={r.id}>
              <div className="hub-item-main">
                <span className="hub-item-title">
                  {staffName(r.staffId)} · {claimedLabel(r)}
                </span>
                <span className="hub-item-sub">
                  Work date {fmtDate(r.workDate)} · {r.reason || "No reason given."}
                </span>
                {decidingId === r.id ? (
                  <div className="hub-inline-form" style={{ marginTop: 8 }}>
                    <label>
                      Note (optional)
                      <input
                        value={decisionNote}
                        onChange={(e) => setDecisionNote(e.target.value)}
                        placeholder="Verified against the house log"
                      />
                    </label>
                    <div className="hub-form-actions">
                      <button className="hub-btn primary" disabled={busy} onClick={() => decide(r, true)}>
                        <Check size={16} /> Approve — create punches
                      </button>
                      <button className="hub-btn danger" disabled={busy} onClick={() => decide(r, false)}>
                        <X size={16} /> Deny
                      </button>
                      <button className="hub-btn" onClick={() => setDecidingId(null)}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <button className="hub-btn" onClick={() => setDecidingId(r.id)}>
                      Decide
                    </button>
                  </div>
                )}
              </div>
              <span className="hub-status pending">{r.status}</span>
            </li>
          ))}
        </ul>
      )}
      {decided.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>Decided ({decided.length})</h3>
          <ul className="hub-list">
            {decided.map((r) => (
              <li className="hub-list-item" key={r.id}>
                <div className="hub-item-main">
                  <span className="hub-item-title">
                    {staffName(r.staffId)} · {claimedLabel(r)}
                  </span>
                  <span className="hub-item-sub">
                    {r.reviewNote ? `${r.reviewNote} · ` : ""}
                    {reviewerName(r.reviewedBy)}
                    {r.reviewedAt ? ` · ${fmtDateTime(r.reviewedAt)}` : ""}
                  </span>
                </div>
                <span className={`hub-status ${r.status === "approved" ? "approved" : "denied"}`}>
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
