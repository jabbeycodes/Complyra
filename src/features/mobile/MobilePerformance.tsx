import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "../../data/types";
import type { HrStore } from "../../data/hrStore";
import {
  CORRECTIVE_ACTION_ACK_LABELS,
  CORRECTIVE_ACTION_OUTCOME_LABELS,
  PERFORMANCE_REVIEW_STATE_LABELS,
  performanceTimeline,
  type PerformanceReview,
  type StaffCorrectiveAction,
} from "../../data/performanceRecords";

/**
 * Mobile Performance — the signed-in staff member's own performance
 * file (PR #159 rules): reviews and corrective actions on one
 * timeline. The subject reads their own file, acknowledges a review
 * with a typed signature, adds the ONE response note an acknowledged
 * review allows, and signs a corrective action — or declines to sign
 * before a named witness (both terminal, exactly as the desktop
 * Performance tab enforces through the same HrStore methods). Filing
 * and outcomes stay with HR/managers on the desktop hub; peers never
 * see these records, and this view only ever loads the signed-in
 * user's own.
 */
export default function MobilePerformance({
  store,
  session,
  onBack,
}: {
  store: HrStore;
  session: SessionUser;
  onBack: () => void;
}) {
  const [reviews, setReviews] = useState<PerformanceReview[]>([]);
  const [actions, setActions] = useState<StaffCorrectiveAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [witness, setWitness] = useState("");
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [responseDraft, setResponseDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [reviewRows, actionRows] = await Promise.all([
        store.listPerformanceReviews(session.userId),
        store.listStaffCorrectiveActions(session.userId),
      ]);
      setReviews(reviewRows);
      setActions(actionRows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your performance file.");
    } finally {
      setLoading(false);
    }
  }, [store, session.userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const timeline = useMemo(
    () => performanceTimeline(reviews, actions),
    [reviews, actions],
  );

  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setBusy(true);
    setError("");
    try {
      await action();
      setSigningId(null);
      setSignature("");
      setDeclineId(null);
      setWitness("");
      setRespondingId(null);
      setResponseDraft("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ My Hub
      </button>
      <h3 className="msh-pass-title">Performance</h3>
      <p className="msh-section-note">
        Your performance reviews and corrective actions. Records are
        append-only — a correction is filed as a new record.
      </p>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="msh-empty">Loading your performance file…</p>
      ) : timeline.length === 0 ? (
        <p className="msh-empty">No performance records on your file yet.</p>
      ) : (
        <div className="msh-list">
          {timeline.map((entry) =>
            entry.kind === "review" ? (
              <div key={entry.review.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>Performance review · {entry.review.rating}</strong>
                  <small className="msh-status-text">
                    {PERFORMANCE_REVIEW_STATE_LABELS[entry.review.state]} ·{" "}
                    {entry.review.reviewDate} · by {entry.review.reviewerName}
                  </small>
                  <small>
                    Period {entry.review.periodStart} – {entry.review.periodEnd}
                  </small>
                  {entry.review.strengths && (
                    <small>Strengths: {entry.review.strengths}</small>
                  )}
                  {entry.review.growthAreas && (
                    <small>Growth areas: {entry.review.growthAreas}</small>
                  )}
                  {entry.review.goals && <small>Goals: {entry.review.goals}</small>}
                  {entry.review.ackSignatureName && (
                    <small>
                      Acknowledged by {entry.review.ackSignatureName} on{" "}
                      {entry.review.ackAt?.slice(0, 10)}.
                    </small>
                  )}
                  {entry.review.responseNote && (
                    <small>Your response: {entry.review.responseNote}</small>
                  )}
                  {entry.review.state === "filed" &&
                    (signingId === entry.review.id ? (
                      <>
                        <label className="msh-field">
                          <span>Type your full name to acknowledge</span>
                          <input
                            type="text"
                            value={signature}
                            onChange={(event) => setSignature(event.target.value)}
                            autoComplete="name"
                          />
                        </label>
                        <span className="msh-row-actions">
                          <button
                            type="button"
                            className="msh-chip-button"
                            disabled={busy || !signature.trim()}
                            onClick={() =>
                              void run(
                                () =>
                                  store.acknowledgePerformanceReview(
                                    entry.review.id,
                                    signature,
                                  ),
                                "Could not record the acknowledgment.",
                              )
                            }
                          >
                            Acknowledge
                          </button>
                          <button
                            type="button"
                            className="msh-chip-button"
                            onClick={() => setSigningId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      </>
                    ) : (
                      <span className="msh-row-actions">
                        <button
                          type="button"
                          className="msh-chip-button"
                          onClick={() => {
                            setSigningId(entry.review.id);
                            setSignature("");
                          }}
                        >
                          Acknowledge review
                        </button>
                      </span>
                    ))}
                  {entry.review.state === "acknowledged" &&
                    !entry.review.responseNote &&
                    (respondingId === entry.review.id ? (
                      <>
                        <label className="msh-field">
                          <span>Your response (one note)</span>
                          <input
                            type="text"
                            value={responseDraft}
                            onChange={(event) => setResponseDraft(event.target.value)}
                          />
                        </label>
                        <span className="msh-row-actions">
                          <button
                            type="button"
                            className="msh-chip-button"
                            disabled={busy || !responseDraft.trim()}
                            onClick={() =>
                              void run(
                                () =>
                                  store.addPerformanceReviewResponse(
                                    entry.review.id,
                                    responseDraft,
                                  ),
                                "Could not save the response.",
                              )
                            }
                          >
                            Save response
                          </button>
                          <button
                            type="button"
                            className="msh-chip-button"
                            onClick={() => setRespondingId(null)}
                          >
                            Cancel
                          </button>
                        </span>
                      </>
                    ) : (
                      <span className="msh-row-actions">
                        <button
                          type="button"
                          className="msh-chip-button"
                          onClick={() => {
                            setRespondingId(entry.review.id);
                            setResponseDraft("");
                          }}
                        >
                          Add your response
                        </button>
                      </span>
                    ))}
                </span>
              </div>
            ) : (
              <div key={entry.action.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>Corrective action · {entry.action.level}</strong>
                  <small className="msh-status-text">
                    {CORRECTIVE_ACTION_ACK_LABELS[entry.action.ackState]} ·{" "}
                    {entry.action.actionDate} · issued by {entry.action.issuerName}
                  </small>
                  <small>What happened: {entry.action.description}</small>
                  <small>What must change: {entry.action.expectations}</small>
                  {entry.action.followUpDate && (
                    <small>Follow-up date: {entry.action.followUpDate}</small>
                  )}
                  <small>
                    Outcome: {CORRECTIVE_ACTION_OUTCOME_LABELS[entry.action.outcome]}
                    {entry.action.outcomeNote ? ` — ${entry.action.outcomeNote}` : ""}
                  </small>
                  {entry.action.ackState === "signed" && (
                    <small>
                      Signed by {entry.action.ackSignatureName} on{" "}
                      {entry.action.ackAt?.slice(0, 10)}.
                    </small>
                  )}
                  {entry.action.ackState === "declined" && (
                    <small>
                      Declined to sign; witness {entry.action.witnessName}.
                    </small>
                  )}
                  {entry.action.ackState === "pending" && (
                    <>
                      {signingId === entry.action.id && (
                        <>
                          <label className="msh-field">
                            <span>Type your full name to sign</span>
                            <input
                              type="text"
                              value={signature}
                              onChange={(event) => setSignature(event.target.value)}
                              autoComplete="name"
                            />
                          </label>
                          <span className="msh-row-actions">
                            <button
                              type="button"
                              className="msh-chip-button"
                              disabled={busy || !signature.trim()}
                              onClick={() =>
                                void run(
                                  () =>
                                    store.acknowledgeStaffCorrectiveAction(
                                      entry.action.id,
                                      { kind: "signed", signatureName: signature },
                                    ),
                                  "Could not record the acknowledgment.",
                                )
                              }
                            >
                              Sign
                            </button>
                            <button
                              type="button"
                              className="msh-chip-button"
                              onClick={() => setSigningId(null)}
                            >
                              Cancel
                            </button>
                          </span>
                        </>
                      )}
                      {declineId === entry.action.id && (
                        <>
                          <label className="msh-field">
                            <span>Witness name (required to decline)</span>
                            <input
                              type="text"
                              value={witness}
                              onChange={(event) => setWitness(event.target.value)}
                            />
                          </label>
                          <span className="msh-row-actions">
                            <button
                              type="button"
                              className="msh-chip-button"
                              disabled={busy || !witness.trim()}
                              onClick={() =>
                                void run(
                                  () =>
                                    store.acknowledgeStaffCorrectiveAction(
                                      entry.action.id,
                                      { kind: "declined", witnessName: witness },
                                    ),
                                  "Could not record the declined signature.",
                                )
                              }
                            >
                              Decline to sign
                            </button>
                            <button
                              type="button"
                              className="msh-chip-button"
                              onClick={() => setDeclineId(null)}
                            >
                              Cancel
                            </button>
                          </span>
                        </>
                      )}
                      {signingId !== entry.action.id && declineId !== entry.action.id && (
                        <span className="msh-row-actions">
                          <button
                            type="button"
                            className="msh-chip-button"
                            onClick={() => {
                              setSigningId(entry.action.id);
                              setSignature("");
                            }}
                          >
                            Sign
                          </button>
                          <button
                            type="button"
                            className="msh-chip-button"
                            onClick={() => {
                              setDeclineId(entry.action.id);
                              setWitness("");
                            }}
                          >
                            Decline to sign
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </span>
              </div>
            ),
          )}
        </div>
      )}
      <p className="msh-section-note">Digital record generated by Complyrer.</p>
    </div>
  );
}
