/**
 * Performance — Employee Hub tab (New Hire Binder build 3, 2026-10-30).
 *
 * The employee file's performance records: performance reviews and
 * corrective actions on one timeline per staff member. Filing belongs
 * to HR/administrators and the subject's HM/PM chain; the subject reads
 * their own file, acknowledges with a typed signature (or, for a
 * corrective action, declines to sign before a named witness), and may
 * attach ONE response note to an acknowledged review. Peers never see
 * these records; auditors read-only. Records are append-only — a
 * correction is filed as a new record superseding the earlier one.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, PenLine, Printer, Scale, Star } from "lucide-react";
import { todayIso } from "../../data/chart";
import type { HrStore } from "../../data/hrStore";
import { hasPermission } from "../../data/permissions";
import {
  CORRECTIVE_ACTION_ACK_LABELS,
  CORRECTIVE_ACTION_LEVELS,
  CORRECTIVE_ACTION_OUTCOME_LABELS,
  CORRECTIVE_ACTION_OUTCOMES,
  PERFORMANCE_RATINGS,
  PERFORMANCE_REVIEW_STATE_LABELS,
  canFilePerformanceRecords,
  canSetCorrectiveActionOutcome,
  canViewPerformanceRecords,
  performanceTimeline,
  type CorrectiveActionOutcome,
  type PerformanceReview,
  type PerformanceTimelineEntry,
  type PerformanceViewer,
  type StaffCorrectiveAction,
} from "../../data/performanceRecords";
import type { SessionUser } from "../../data/types";
import type { HubStaffEntry } from "./EmployeeHubPage";

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${fmtDate(iso)} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function PerformanceTab({
  session,
  store,
  staffList,
  initialSubjectId,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  /** Open on this staff member (the binder's Performance jump). */
  initialSubjectId?: string;
}) {
  const isAuditor = session.roleKey === "auditor";
  const viewer: PerformanceViewer = useMemo(
    () => ({
      userId: session.userId,
      roleKey: session.roleKey,
      siteId: session.siteId,
      canViewTeam: hasPermission(session, "hub.view_team"),
    }),
    [session],
  );

  const viewableStaff = useMemo(
    () =>
      staffList.filter((s) =>
        canViewPerformanceRecords(viewer, { userId: s.userId, siteId: s.siteId }),
      ),
    [staffList, viewer],
  );

  const [subjectId, setSubjectId] = useState(
    initialSubjectId ?? session.userId,
  );
  const subject = useMemo<HubStaffEntry>(
    () =>
      staffList.find((s) => s.userId === subjectId) ?? {
        userId: session.userId,
        fullName: session.fullName,
        email: "",
        roleKey: session.roleKey,
        siteId: session.siteId,
      },
    [staffList, subjectId, session],
  );
  const subjectRef = { userId: subject.userId, siteId: subject.siteId };
  const canView = canViewPerformanceRecords(viewer, subjectRef);
  const canFile = canFilePerformanceRecords(viewer, subjectRef);
  const isSelf = subjectId === session.userId;

  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [actions, setActions] = useState<StaffCorrectiveAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);
  const [reviewForm, setReviewForm] = useState({
    reviewDate: todayIso(),
    periodStart: "",
    periodEnd: "",
    rating: "Meets expectations" as PerformanceReview["rating"],
    strengths: "",
    growthAreas: "",
    goals: "",
    supersedesId: "",
  });
  const [actionForm, setActionForm] = useState({
    actionDate: todayIso(),
    level: "Verbal warning" as StaffCorrectiveAction["level"],
    description: "",
    expectations: "",
    followUpDate: "",
    supersedesId: "",
  });

  /** Per-record interaction state, keyed by record id. */
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [witness, setWitness] = useState("");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");
  const [outcomeId, setOutcomeId] = useState<string | null>(null);
  const [outcomeChoice, setOutcomeChoice] =
    useState<CorrectiveActionOutcome>("resolved");
  const [outcomeNote, setOutcomeNote] = useState("");

  const [printEntry, setPrintEntry] = useState<PerformanceTimelineEntry | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        const [reviewRows, actionRows] = await Promise.all([
          store.listPerformanceReviews(subjectId),
          store.listStaffCorrectiveActions(subjectId),
        ]);
        if (cancelled) return;
        setReviews(reviewRows);
        setActions(actionRows);
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load the performance file."));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store, subjectId, reloadKey]);

  const reload = () => setReloadKey((k) => k + 1);

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await fn();
      reload();
    } catch (err) {
      setError(errMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  };

  const fileReview = () =>
    run(async () => {
      await store.filePerformanceReview({
        staffId: subjectId,
        reviewDate: reviewForm.reviewDate,
        periodStart: reviewForm.periodStart,
        periodEnd: reviewForm.periodEnd,
        reviewerName: session.fullName,
        rating: reviewForm.rating,
        strengths: reviewForm.strengths,
        growthAreas: reviewForm.growthAreas,
        goals: reviewForm.goals,
        supersedesId: reviewForm.supersedesId || null,
      });
      setShowReviewForm(false);
      setReviewForm((f) => ({
        ...f,
        strengths: "",
        growthAreas: "",
        goals: "",
        supersedesId: "",
      }));
    }, "Could not file the review.");

  const fileAction = () =>
    run(async () => {
      await store.fileStaffCorrectiveAction({
        staffId: subjectId,
        actionDate: actionForm.actionDate,
        issuerName: session.fullName,
        level: actionForm.level,
        description: actionForm.description,
        expectations: actionForm.expectations,
        followUpDate: actionForm.followUpDate || null,
        supersedesId: actionForm.supersedesId || null,
      });
      setShowActionForm(false);
      setActionForm((f) => ({
        ...f,
        description: "",
        expectations: "",
        followUpDate: "",
        supersedesId: "",
      }));
    }, "Could not file the corrective action.");

  const signReview = (review: PerformanceReview) =>
    run(async () => {
      await store.acknowledgePerformanceReview(review.id, signature);
      setSigningId(null);
      setSignature("");
    }, "Could not record the acknowledgment.");

  const saveResponse = (review: PerformanceReview) =>
    run(async () => {
      await store.addPerformanceReviewResponse(review.id, responseDraft);
      setRespondingId(null);
      setResponseDraft("");
    }, "Could not save the response.");

  const signAction = (action: StaffCorrectiveAction) =>
    run(async () => {
      await store.acknowledgeStaffCorrectiveAction(action.id, {
        kind: "signed",
        signatureName: signature,
      });
      setSigningId(null);
      setSignature("");
    }, "Could not record the acknowledgment.");

  const declineAction = (action: StaffCorrectiveAction) =>
    run(async () => {
      await store.acknowledgeStaffCorrectiveAction(action.id, {
        kind: "declined",
        witnessName: witness,
      });
      setDeclineId(null);
      setWitness("");
    }, "Could not record the declined signature.");

  const saveOutcome = (action: StaffCorrectiveAction) =>
    run(async () => {
      await store.setStaffCorrectiveActionOutcome(
        action.id,
        outcomeChoice,
        outcomeNote,
        session.fullName,
      );
      setOutcomeId(null);
      setOutcomeNote("");
    }, "Could not update the outcome.");

  const printRecord = (entry: PerformanceTimelineEntry) => {
    setPrintEntry(entry);
    document.body.dataset.performancePrint = "1";
    const clear = () => {
      delete document.body.dataset.performancePrint;
      window.removeEventListener("afterprint", clear);
    };
    window.addEventListener("afterprint", clear);
    window.setTimeout(() => window.print(), 60);
    window.setTimeout(clear, 60_000);
  };

  const timeline = useMemo(
    () => performanceTimeline(reviews, actions),
    [reviews, actions],
  );
  const supersededBy = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reviews) {
      if (r.supersedesId) map.set(r.supersedesId, r.reviewDate);
    }
    for (const a of actions) {
      if (a.supersedesId) map.set(a.supersedesId, a.actionDate);
    }
    return map;
  }, [reviews, actions]);
  const recordDateById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of reviews) map.set(r.id, r.reviewDate);
    for (const a of actions) map.set(a.id, a.actionDate);
    return map;
  }, [reviews, actions]);

  const renderReview = (review: PerformanceReview) => (
    <li className="hub-list-item performance-entry" key={`review-${review.id}`}>
      <div className="hub-item-main">
        <span className="hub-item-title">
          <Star size={15} /> Performance review — {review.rating}
        </span>
        <span className="hub-item-sub">
          Review date {fmtDate(review.reviewDate)} · Period{" "}
          {fmtDate(review.periodStart)} – {fmtDate(review.periodEnd)} · Filed by{" "}
          {review.reviewerName}
        </span>
        {review.supersedesId && (
          <span className="hub-item-sub">
            Corrects the review dated{" "}
            {fmtDate(recordDateById.get(review.supersedesId) ?? "")}
          </span>
        )}
        {supersededBy.has(review.id) && (
          <span className="hub-item-sub">
            Superseded by a newer review dated{" "}
            {fmtDate(supersededBy.get(review.id) ?? "")} — this record stays on
            file unchanged
          </span>
        )}
        <div className="performance-fields">
          <p>
            <strong>Strengths.</strong> {review.strengths}
          </p>
          <p>
            <strong>Growth areas.</strong> {review.growthAreas}
          </p>
          <p>
            <strong>Goals.</strong> {review.goals}
          </p>
        </div>
        {review.state === "acknowledged" ? (
          <span className="hub-item-sub">
            Acknowledged by {review.ackSignatureName} on{" "}
            {fmtDateTime(review.ackAt)}.
          </span>
        ) : (
          <span className="hub-item-sub">Not yet acknowledged.</span>
        )}
        {review.responseNote && (
          <div className="performance-response">
            <strong>{subject.fullName}'s response</strong> ·{" "}
            {fmtDateTime(review.responseAt)}
            <p>{review.responseNote}</p>
          </div>
        )}
        {isSelf && review.state === "filed" && signingId !== review.id && (
          <div className="binder-actions">
            <button
              className="hub-btn primary"
              disabled={busy}
              onClick={() => {
                setSigningId(review.id);
                setSignature("");
              }}
            >
              <PenLine size={15} /> Acknowledge this review
            </button>
          </div>
        )}
        {isSelf && review.state === "filed" && signingId === review.id && (
          <div className="hub-inline-form">
            <label>
              Type your full name to acknowledge
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={session.fullName}
                autoComplete="name"
              />
            </label>
            <div className="hub-form-actions">
              <button
                className="hub-btn primary"
                disabled={busy || !signature.trim()}
                onClick={() => signReview(review)}
              >
                <Check size={16} /> Sign acknowledgment
              </button>
              <button className="hub-btn" onClick={() => setSigningId(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {isSelf &&
          review.state === "acknowledged" &&
          !review.responseNote &&
          respondingId !== review.id && (
            <div className="binder-actions">
              <button
                className="hub-btn"
                disabled={busy}
                onClick={() => {
                  setRespondingId(review.id);
                  setResponseDraft("");
                }}
              >
                <PenLine size={15} /> Add your response (one note)
              </button>
            </div>
          )}
        {isSelf && respondingId === review.id && (
          <div className="hub-inline-form">
            <label>
              Your response — it is added to the record and cannot be edited
              <textarea
                value={responseDraft}
                onChange={(e) => setResponseDraft(e.target.value)}
                rows={3}
              />
            </label>
            <div className="hub-form-actions">
              <button
                className="hub-btn primary"
                disabled={busy || !responseDraft.trim()}
                onClick={() => saveResponse(review)}
              >
                <Check size={16} /> Add response
              </button>
              <button className="hub-btn" onClick={() => setRespondingId(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <span className="performance-badges">
        <span className={review.state === "acknowledged" ? "badge on-track" : "badge due-soon"}>
          {PERFORMANCE_REVIEW_STATE_LABELS[review.state]}
        </span>
        <button
          className="hub-btn"
          onClick={() => printRecord({ kind: "review", date: review.reviewDate, review })}
        >
          <Printer size={15} /> Print
        </button>
      </span>
    </li>
  );

  const renderAction = (action: StaffCorrectiveAction) => (
    <li className="hub-list-item performance-entry" key={`action-${action.id}`}>
      <div className="hub-item-main">
        <span className="hub-item-title">
          <Scale size={15} /> Corrective action — {action.level}
        </span>
        <span className="hub-item-sub">
          {fmtDate(action.actionDate)} · Issued by {action.issuerName}
          {action.followUpDate
            ? ` · Follow-up ${fmtDate(action.followUpDate)}`
            : ""}
        </span>
        {action.supersedesId && (
          <span className="hub-item-sub">
            Corrects the action dated{" "}
            {fmtDate(recordDateById.get(action.supersedesId) ?? "")}
          </span>
        )}
        {supersededBy.has(action.id) && (
          <span className="hub-item-sub">
            Superseded by a newer action dated{" "}
            {fmtDate(supersededBy.get(action.id) ?? "")} — this record stays on
            file unchanged
          </span>
        )}
        <div className="performance-fields">
          <p>
            <strong>What happened.</strong> {action.description}
          </p>
          <p>
            <strong>What must change.</strong> {action.expectations}
          </p>
        </div>
        {action.ackState === "signed" && (
          <span className="hub-item-sub">
            Signed by {action.ackSignatureName} on {fmtDateTime(action.ackAt)}.
          </span>
        )}
        {action.ackState === "declined" && (
          <span className="hub-item-sub">
            Declined to sign on {fmtDate(action.ackAt)} — witnessed by{" "}
            {action.witnessName}.
          </span>
        )}
        {action.ackState === "pending" && (
          <span className="hub-item-sub">Not yet acknowledged.</span>
        )}
        <span className="hub-item-sub">
          Outcome: {CORRECTIVE_ACTION_OUTCOME_LABELS[action.outcome]}
          {action.outcome !== "open" && action.outcomeNote
            ? ` — ${action.outcomeNote} (${action.outcomeByName}, ${fmtDate(action.outcomeAt)})`
            : ""}
        </span>
        {isSelf && action.ackState === "pending" && signingId !== action.id && declineId !== action.id && (
          <div className="binder-actions">
            <button
              className="hub-btn primary"
              disabled={busy}
              onClick={() => {
                setSigningId(action.id);
                setSignature("");
              }}
            >
              <PenLine size={15} /> Sign acknowledgment
            </button>
            <button
              className="hub-btn"
              disabled={busy}
              onClick={() => {
                setDeclineId(action.id);
                setWitness("");
              }}
            >
              Decline to sign
            </button>
          </div>
        )}
        {isSelf && signingId === action.id && (
          <div className="hub-inline-form">
            <label>
              Type your full name to acknowledge
              <input
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder={session.fullName}
                autoComplete="name"
              />
            </label>
            <div className="hub-form-actions">
              <button
                className="hub-btn primary"
                disabled={busy || !signature.trim()}
                onClick={() => signAction(action)}
              >
                <Check size={16} /> Sign acknowledgment
              </button>
              <button className="hub-btn" onClick={() => setSigningId(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {isSelf && declineId === action.id && (
          <div className="hub-inline-form">
            <label>
              Name of the staff member who witnessed the decline
              <input
                value={witness}
                onChange={(e) => setWitness(e.target.value)}
                placeholder="Witness's full name"
              />
            </label>
            <div className="hub-form-actions">
              <button
                className="hub-btn primary"
                disabled={busy || !witness.trim()}
                onClick={() => declineAction(action)}
              >
                <Check size={16} /> Record decline
              </button>
              <button className="hub-btn" onClick={() => setDeclineId(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {!isSelf &&
          canSetCorrectiveActionOutcome(viewer, action) &&
          outcomeId !== action.id && (
            <div className="binder-actions">
              <button
                className="hub-btn"
                disabled={busy}
                onClick={() => {
                  setOutcomeId(action.id);
                  setOutcomeChoice(
                    action.outcome === "open" ? "resolved" : action.outcome,
                  );
                  setOutcomeNote("");
                }}
              >
                Update outcome
              </button>
            </div>
          )}
        {!isSelf && outcomeId === action.id && (
          <div className="hub-inline-form">
            <div className="hub-form">
              <label>
                Outcome
                <select
                  value={outcomeChoice}
                  onChange={(e) =>
                    setOutcomeChoice(e.target.value as CorrectiveActionOutcome)
                  }
                >
                  {CORRECTIVE_ACTION_OUTCOMES.filter((o) => o !== "open").map(
                    (o) => (
                      <option key={o} value={o}>
                        {CORRECTIVE_ACTION_OUTCOME_LABELS[o]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Note — how was this outcome reached?
                <input
                  value={outcomeNote}
                  onChange={(e) => setOutcomeNote(e.target.value)}
                />
              </label>
            </div>
            <div className="hub-form-actions">
              <button
                className="hub-btn primary"
                disabled={busy || !outcomeNote.trim()}
                onClick={() => saveOutcome(action)}
              >
                <Check size={16} /> Save outcome
              </button>
              <button className="hub-btn" onClick={() => setOutcomeId(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
      <span className="performance-badges">
        <span className="badge overdue">{action.level}</span>
        <span className={action.ackState === "pending" ? "badge due-soon" : "badge on-track"}>
          {CORRECTIVE_ACTION_ACK_LABELS[action.ackState]}
        </span>
        <span className={action.outcome === "open" ? "badge due-soon" : "badge on-track"}>
          Outcome: {CORRECTIVE_ACTION_OUTCOME_LABELS[action.outcome]}
        </span>
        <button
          className="hub-btn"
          onClick={() => printRecord({ kind: "action", date: action.actionDate, action })}
        >
          <Printer size={15} /> Print
        </button>
      </span>
    </li>
  );

  return (
    <div>
      <section className="hub-card performance-screen" aria-label="Performance records">
        <div className="hub-row">
          <div>
            <h2>Performance</h2>
            <p className="hub-sub">
              {isSelf
                ? "Your performance reviews and corrective actions."
                : `${subject.fullName}'s performance reviews and corrective actions.`}{" "}
              Records are permanent: a correction is filed as a new record,
              never an edit.
            </p>
          </div>
          {viewableStaff.length > 1 && (
            <label className="binder-subject">
              Staff member
              <select
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                {viewableStaff.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.fullName}
                    {s.userId === session.userId ? " (you)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {error && (
          <div className="hub-error" role="alert">
            {error}
          </div>
        )}

        {!canView ? (
          <p>
            {subject.fullName}'s performance file is visible to them, their
            management chain, HR, and auditors only.
          </p>
        ) : loading ? (
          <p>Loading performance file…</p>
        ) : (
          <>
            {canFile && (
              <div className="binder-actions performance-file-actions">
                <button
                  className="hub-btn primary"
                  disabled={busy}
                  onClick={() => {
                    setShowReviewForm((v) => !v);
                    setShowActionForm(false);
                  }}
                >
                  <Star size={15} /> File a performance review
                </button>
                <button
                  className="hub-btn"
                  disabled={busy}
                  onClick={() => {
                    setShowActionForm((v) => !v);
                    setShowReviewForm(false);
                  }}
                >
                  <Scale size={15} /> File a corrective action
                </button>
              </div>
            )}
            {isAuditor && <p className="binder-awaiting">Read-only — auditor view</p>}

            {showReviewForm && canFile && (
              <div className="hub-inline-form">
                <h3>Performance review — {subject.fullName}</h3>
                <div className="hub-form">
                  <label>
                    Review date
                    <input
                      type="date"
                      value={reviewForm.reviewDate}
                      onChange={(e) =>
                        setReviewForm((f) => ({ ...f, reviewDate: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Period start
                    <input
                      type="date"
                      value={reviewForm.periodStart}
                      onChange={(e) =>
                        setReviewForm((f) => ({ ...f, periodStart: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Period end
                    <input
                      type="date"
                      value={reviewForm.periodEnd}
                      onChange={(e) =>
                        setReviewForm((f) => ({ ...f, periodEnd: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Rating
                    <select
                      value={reviewForm.rating}
                      onChange={(e) =>
                        setReviewForm((f) => ({
                          ...f,
                          rating: e.target.value as PerformanceReview["rating"],
                        }))
                      }
                    >
                      {PERFORMANCE_RATINGS.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Corrects an earlier review (optional)
                    <select
                      value={reviewForm.supersedesId}
                      onChange={(e) =>
                        setReviewForm((f) => ({ ...f, supersedesId: e.target.value }))
                      }
                    >
                      <option value="">No — this is a new review</option>
                      {reviews.map((r) => (
                        <option key={r.id} value={r.id}>
                          Review dated {fmtDate(r.reviewDate)} — {r.rating}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="hub-form performance-textareas">
                  <label>
                    Strengths
                    <textarea
                      value={reviewForm.strengths}
                      onChange={(e) =>
                        setReviewForm((f) => ({ ...f, strengths: e.target.value }))
                      }
                      rows={3}
                    />
                  </label>
                  <label>
                    Growth areas
                    <textarea
                      value={reviewForm.growthAreas}
                      onChange={(e) =>
                        setReviewForm((f) => ({ ...f, growthAreas: e.target.value }))
                      }
                      rows={3}
                    />
                  </label>
                  <label>
                    Goals
                    <textarea
                      value={reviewForm.goals}
                      onChange={(e) =>
                        setReviewForm((f) => ({ ...f, goals: e.target.value }))
                      }
                      rows={3}
                    />
                  </label>
                </div>
                <div className="hub-form-actions">
                  <button
                    className="hub-btn primary"
                    disabled={busy}
                    onClick={fileReview}
                  >
                    <Check size={16} /> File review
                  </button>
                  <button className="hub-btn" onClick={() => setShowReviewForm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {showActionForm && canFile && (
              <div className="hub-inline-form">
                <h3>Corrective action — {subject.fullName}</h3>
                <div className="hub-form">
                  <label>
                    Action date
                    <input
                      type="date"
                      value={actionForm.actionDate}
                      onChange={(e) =>
                        setActionForm((f) => ({ ...f, actionDate: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Level
                    <select
                      value={actionForm.level}
                      onChange={(e) =>
                        setActionForm((f) => ({
                          ...f,
                          level: e.target.value as StaffCorrectiveAction["level"],
                        }))
                      }
                    >
                      {CORRECTIVE_ACTION_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Follow-up date (required for a PIP)
                    <input
                      type="date"
                      value={actionForm.followUpDate}
                      onChange={(e) =>
                        setActionForm((f) => ({ ...f, followUpDate: e.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Corrects an earlier action (optional)
                    <select
                      value={actionForm.supersedesId}
                      onChange={(e) =>
                        setActionForm((f) => ({ ...f, supersedesId: e.target.value }))
                      }
                    >
                      <option value="">No — this is a new action</option>
                      {actions.map((a) => (
                        <option key={a.id} value={a.id}>
                          {fmtDate(a.actionDate)} — {a.level}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="hub-form performance-textareas">
                  <label>
                    What happened
                    <textarea
                      value={actionForm.description}
                      onChange={(e) =>
                        setActionForm((f) => ({ ...f, description: e.target.value }))
                      }
                      rows={3}
                    />
                  </label>
                  <label>
                    What must change
                    <textarea
                      value={actionForm.expectations}
                      onChange={(e) =>
                        setActionForm((f) => ({ ...f, expectations: e.target.value }))
                      }
                      rows={3}
                    />
                  </label>
                </div>
                <div className="hub-form-actions">
                  <button
                    className="hub-btn primary"
                    disabled={busy}
                    onClick={fileAction}
                  >
                    <Check size={16} /> File corrective action
                  </button>
                  <button className="hub-btn" onClick={() => setShowActionForm(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {timeline.length === 0 ? (
              <p>
                No performance reviews or corrective actions on file for{" "}
                {subject.fullName} yet.
              </p>
            ) : (
              <ul className="hub-list">
                {timeline.map((entry) =>
                  entry.kind === "review"
                    ? renderReview(entry.review)
                    : renderAction(entry.action),
                )}
              </ul>
            )}
          </>
        )}
      </section>

      {printEntry && (
        <article className="performance-print" aria-hidden="true">
          {printEntry.kind === "review" ? (
            <>
              <h1>Performance Review</h1>
              <p>
                <strong>Staff member:</strong> {subject.fullName}
                <br />
                <strong>Review date:</strong> {fmtDate(printEntry.review.reviewDate)}
                <br />
                <strong>Review period:</strong>{" "}
                {fmtDate(printEntry.review.periodStart)} –{" "}
                {fmtDate(printEntry.review.periodEnd)}
                <br />
                <strong>Reviewer:</strong> {printEntry.review.reviewerName}
                <br />
                <strong>Rating:</strong> {printEntry.review.rating}
              </p>
              <h2>Strengths</h2>
              <p>{printEntry.review.strengths}</p>
              <h2>Growth areas</h2>
              <p>{printEntry.review.growthAreas}</p>
              <h2>Goals</h2>
              <p>{printEntry.review.goals}</p>
              {printEntry.review.state === "acknowledged" ? (
                <p>
                  Acknowledged by {printEntry.review.ackSignatureName} on{" "}
                  {fmtDateTime(printEntry.review.ackAt)}.
                </p>
              ) : (
                <p>Acknowledgment: not yet signed.</p>
              )}
              {printEntry.review.responseNote && (
                <>
                  <h2>Staff member's response</h2>
                  <p>{printEntry.review.responseNote}</p>
                </>
              )}
            </>
          ) : (
            <>
              <h1>Corrective Action — {printEntry.action.level}</h1>
              <p>
                <strong>Staff member:</strong> {subject.fullName}
                <br />
                <strong>Action date:</strong> {fmtDate(printEntry.action.actionDate)}
                <br />
                <strong>Issued by:</strong> {printEntry.action.issuerName}
                {printEntry.action.followUpDate && (
                  <>
                    <br />
                    <strong>Follow-up date:</strong>{" "}
                    {fmtDate(printEntry.action.followUpDate)}
                  </>
                )}
              </p>
              <h2>What happened</h2>
              <p>{printEntry.action.description}</p>
              <h2>What must change</h2>
              <p>{printEntry.action.expectations}</p>
              {printEntry.action.ackState === "signed" && (
                <p>
                  Signed by {printEntry.action.ackSignatureName} on{" "}
                  {fmtDateTime(printEntry.action.ackAt)}.
                </p>
              )}
              {printEntry.action.ackState === "declined" && (
                <p>
                  Declined to sign on {fmtDate(printEntry.action.ackAt)} —
                  witnessed by {printEntry.action.witnessName}.
                </p>
              )}
              {printEntry.action.ackState === "pending" && (
                <p>Acknowledgment: not yet signed.</p>
              )}
              <p>
                Outcome: {CORRECTIVE_ACTION_OUTCOME_LABELS[printEntry.action.outcome]}
                {printEntry.action.outcomeNote
                  ? ` — ${printEntry.action.outcomeNote}`
                  : ""}
              </p>
            </>
          )}
          <p className="performance-print-mark">
            <em>Digital record generated by Complyrer.</em>
          </p>
        </article>
      )}
    </div>
  );
}
