/**
 * Recognition page — winners-only weekly recognition.
 *
 * Surfaces (all roles see winners; everything else is permission-gated):
 *   - Winners celebration: name, category, week, and positive highlights
 *     only. No scores, no rankings, no candidate lists — the API never
 *     returns them, and nothing here invents them.
 *   - DSPs rate their house manager; HMs review their DSPs (1–5 + plain
 *     language labels, current value pre-filled, per-person save).
 *   - "Feedback about me": the current rating/review about the session
 *     user plus its private change history. No averages, no comparisons.
 *   - Manage (recognition.manage): agency-wide current ratings/reviews
 *     with expandable history, plus an idempotent "run weekly selection".
 */
import { useEffect, useState } from "react";
import { ChevronDown, Trophy } from "lucide-react";
import { PageHeading } from "../../components";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { formatShortDate } from "../../data/hmChecklist";
import { ratingLabel } from "../../recognition/scoring";
import type {
  DspHmRatingWithHistory,
  HmDspReviewWithHistory,
  PublicRecognitionWinner,
  RatingHistoryEntry,
  RecognitionFeedback,
  WeeklyRecognitionResult,
} from "../../recognition/recognition";
import "./recognition.css";

const RATINGS = [1, 2, 3, 4, 5];

function categoryLabel(category: PublicRecognitionWinner["category"]): string {
  return category === "hm_of_the_week"
    ? "House Manager of the Week"
    : "DSP of the Week";
}

function weekLabel(weekStart: string): string {
  return `Week of ${formatShortDate(weekStart)}`;
}

/** 1–5 segmented control. Touch targets are 44px+; label reads aloud. */
function RatingControl({
  name,
  value,
  onChange,
}: {
  name: string;
  value: number | null;
  onChange: (rating: number) => void;
}) {
  return (
    <div className="recognition-rating-group">
      <div
        className="recognition-rating-segment"
        role="radiogroup"
        aria-label={name}
      >
        {RATINGS.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            className={`recognition-rating-option ${
              value === r ? "selected" : ""
            }`}
            onClick={() => onChange(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <p className="recognition-rating-label" aria-live="polite">
        {value !== null ? `${value} — ${ratingLabel(value)}` : "Not rated yet"}
      </p>
    </div>
  );
}

function HistoryList({ history }: { history: RatingHistoryEntry[] }) {
  if (history.length === 0) return <p className="muted">No changes yet.</p>;
  const sorted = [...history].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return (
    <ul className="recognition-history-list">
      {sorted.map((entry) => (
        <li key={entry.id}>
          {entry.oldRating === null ? (
            <span>
              First rating: <strong>{entry.newRating}</strong>
            </span>
          ) : (
            <span>
              {formatShortDate(entry.createdAt.slice(0, 10))}:{" "}
              <strong>{entry.oldRating}</strong> →{" "}
              <strong>{entry.newRating}</strong>
              {entry.changedByName ? ` by ${entry.changedByName}` : ""}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * One row of current feedback about the session user: the current value in
 * plain language plus its private history. No averages, no comparisons.
 */
function FeedbackAboutMeRow({
  current,
  history,
}: {
  current: number;
  history: RatingHistoryEntry[];
}) {
  return (
    <div className="recognition-aboutme-row">
      <p className="recognition-aboutme-current">
        Current: <strong>{current}</strong> · {ratingLabel(current)}
      </p>
      <HistoryList history={history} />
    </div>
  );
}

export default function RecognitionPage() {
  const { api, session } = useData();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [winners, setWinners] = useState<PublicRecognitionWinner[]>([]);

  // Partners the session user may rate/review (the only rateable people).
  const [partners, setPartners] = useState<
    Array<{ userId: string; fullName: string; roleKey: string }>
  >([]);
  const [pendingRatings, setPendingRatings] = useState<
    Record<string, number | null>
  >({});
  const [savedRatings, setSavedRatings] = useState<Record<string, number | null>>(
    {},
  );
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [savedNote, setSavedNote] = useState<Record<string, boolean>>({});

  const [aboutMeRatings, setAboutMeRatings] = useState<DspHmRatingWithHistory[]>(
    [],
  );
  const [aboutMeReviews, setAboutMeReviews] = useState<HmDspReviewWithHistory[]>(
    [],
  );

  const [feedback, setFeedback] = useState<RecognitionFeedback | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [runResult, setRunResult] = useState<WeeklyRecognitionResult | null>(
    null,
  );
  const [running, setRunning] = useState(false);

  const canRateHm = session ? can(session, "recognition.rate_hm") : false;
  const canReviewDsp = session
    ? can(session, "recognition.review_dsp")
    : false;
  const canManage = session ? can(session, "recognition.manage") : false;
  const isHm = session?.roleKey === "house_manager";
  const isDsp = session?.roleKey === "dsp";
  const ratesOrReviews = canRateHm || canReviewDsp;

  async function loadWinners() {
    const rows = await api.listRecognitionWinners({ limit: 20 });
    // Current week first, then previous weeks.
    setWinners(
      [...rows].sort(
        (a, b) =>
          b.weekStart.localeCompare(a.weekStart) ||
          b.category.localeCompare(a.category),
      ),
    );
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!session) return;
      try {
        await loadWinners();
        if (ratesOrReviews) {
          const list = await api.listRecognitionPartners();
          if (!alive) return;
          setPartners(list);
          const initial: Record<string, number | null> = {};
          for (const partner of list) {
            const current = canRateHm
              ? await api.getMyDspHmRating(partner.userId)
              : await api.getMyHmDspReview(partner.userId);
            initial[partner.userId] = current?.rating ?? null;
          }
          if (!alive) return;
          setPendingRatings(initial);
          setSavedRatings(initial);
        }
        if (isHm) {
          const rows = await api.listDspHmRatingsAboutMe();
          if (!alive) return;
          setAboutMeRatings(rows);
        } else if (isDsp) {
          const rows = await api.listHmDspReviewsAboutMe();
          if (!alive) return;
          setAboutMeReviews(rows);
        }
        if (canManage) {
          const fb = await api.listRecognitionFeedback();
          if (!alive) return;
          setFeedback(fb);
        }
      } catch (err) {
        if (alive) setError((err as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return null;

  async function saveRating(userId: string) {
    const value = pendingRatings[userId];
    if (value === null || value === undefined) return;
    setSaving((prev) => ({ ...prev, [userId]: true }));
    setError("");
    try {
      if (canRateHm) {
        await api.submitDspHmRating({ hmUserId: userId, rating: value });
      } else {
        await api.submitHmDspReview({ dspUserId: userId, rating: value });
      }
      setSavedRatings((prev) => ({ ...prev, [userId]: value }));
      setSavedNote((prev) => ({ ...prev, [userId]: true }));
      window.setTimeout(
        () => setSavedNote((prev) => ({ ...prev, [userId]: false })),
        4000,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving((prev) => ({ ...prev, [userId]: false }));
    }
  }

  async function runWeeklySelection() {
    if (
      !window.confirm(
        "Run the weekly winner selection now? It is idempotent — weeks that already have winners are skipped.",
      )
    ) {
      return;
    }
    setRunning(true);
    setError("");
    try {
      const result = await api.runWeeklyRecognition();
      setRunResult(result);
      await loadWinners();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  const manageRows: Array<{
    key: string;
    about: string;
    direction: string;
    rating: number;
    updatedAt: string;
    history: RatingHistoryEntry[];
  }> = feedback
    ? [
        ...feedback.dspRatings.map((r) => ({
          key: r.id,
          about: r.hmName,
          direction: "DSP's rating of house manager",
          rating: r.rating,
          updatedAt: r.updatedAt,
          history: r.history,
        })),
        ...feedback.hmReviews.map((r) => ({
          key: r.id,
          about: r.dspName,
          direction: "House manager's review of DSP",
          rating: r.rating,
          updatedAt: r.updatedAt,
          history: r.history,
        })),
      ]
    : [];

  return (
    <div aria-labelledby="recognition-heading">
      <PageHeading title="Recognition" />
      {error && <p className="form-error">{error}</p>}
      {loading && <p>Loading recognition…</p>}

      {!loading && (
        <>
          {/* ---- Winners: visible to every role ---- */}
          <section className="panel" aria-label="Winners">
            <div className="panel-heading">
              <div>
                <h2 id="recognition-heading">Winners</h2>
                <p>
                  Named weekly by the agency — highlights only, no rankings.
                </p>
              </div>
            </div>
            {winners.length === 0 ? (
              <p className="muted">
                No winners announced yet — check back after Sunday's selection.
              </p>
            ) : (
              <div className="recognition-winners-grid">
                {winners.map((w) => (
                  <article
                    key={w.id}
                    className="recognition-winner-card"
                    aria-label={`${categoryLabel(w.category)}: ${w.winnerName}`}
                  >
                    <div className="recognition-winner-top">
                      <span className="recognition-trophy" aria-hidden="true">
                        <Trophy size={20} />
                      </span>
                      <div>
                        <h3>{w.winnerName}</h3>
                        <p className="recognition-category">
                          {categoryLabel(w.category)}
                          <span className="recognition-week">
                            {weekLabel(w.weekStart)}
                          </span>
                        </p>
                      </div>
                    </div>
                    {w.highlights.length > 0 && (
                      <ul className="recognition-highlights">
                        {w.highlights.map((h) => (
                          <li key={h}>{h}</li>
                        ))}
                      </ul>
                    )}
                    <ComplyrerRecordMark
                      documentId={w.id}
                      generatedAt={w.decidedAt}
                    />
                  </article>
                ))}
              </div>
            )}
          </section>

          {/* ---- Rate / review: DSPs and HMs only ---- */}
          {ratesOrReviews && (
            <section
              className="panel"
              aria-label={canRateHm ? "Rate your house manager" : "Review your DSPs"}
            >
              <div className="panel-heading">
                <div>
                  <h2>
                    {canRateHm ? "Rate your house manager" : "Review your DSPs"}
                  </h2>
                  <p>
                    Your rating is private — only the person you're rating and
                    your management team can see it.
                  </p>
                </div>
              </div>
              {partners.length === 0 ? (
                <p className="muted">
                  No one to {canRateHm ? "rate" : "review"} right now.
                </p>
              ) : (
                <ul className="recognition-partners">
                  {partners.map((partner) => {
                    const value = pendingRatings[partner.userId] ?? null;
                    const saved = savedRatings[partner.userId] ?? null;
                    const dirty = value !== null && value !== saved;
                    const busy = saving[partner.userId] === true;
                    return (
                      <li
                        key={partner.userId}
                        className="recognition-partner-row"
                      >
                        <div className="recognition-partner-name">
                          <strong>{partner.fullName}</strong>
                        </div>
                        <RatingControl
                          name={`Rating for ${partner.fullName}`}
                          value={value}
                          onChange={(r) =>
                            setPendingRatings((prev) => ({
                              ...prev,
                              [partner.userId]: r,
                            }))
                          }
                        />
                        <div className="recognition-save-row">
                          <button
                            type="button"
                            className="button secondary"
                            disabled={!dirty || busy}
                            onClick={() => saveRating(partner.userId)}
                          >
                            {busy ? "Saving…" : "Save"}
                          </button>
                          {savedNote[partner.userId] && (
                            <span
                              className="recognition-saved"
                              role="status"
                            >
                              Saved.
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}

          {/* ---- Feedback about me: private, calm ---- */}
          {(isHm || isDsp) && (
            <section className="panel" aria-label="Feedback about me">
              <div className="panel-heading">
                <div>
                  <h2>Feedback about me</h2>
                  <p>
                    Private to you — your current rating and how it has changed
                    over time.
                  </p>
                </div>
              </div>
              {isHm && aboutMeRatings.length === 0 && (
                <p className="muted">
                  No ratings about you yet. When a DSP on your team rates you,
                  it will appear here.
                </p>
              )}
              {isDsp && aboutMeReviews.length === 0 && (
                <p className="muted">
                  No reviews about you yet. When your house manager reviews
                  you, it will appear here.
                </p>
              )}
              {isHm &&
                aboutMeRatings.map((r) => (
                  <FeedbackAboutMeRow
                    key={r.id}
                    current={r.rating}
                    history={r.history}
                  />
                ))}
              {isDsp &&
                aboutMeReviews.map((r) => (
                  <FeedbackAboutMeRow
                    key={r.id}
                    current={r.rating}
                    history={r.history}
                  />
                ))}
            </section>
          )}

          {/* ---- Manage: managers/admins only ---- */}
          {canManage && (
            <section className="panel" aria-label="Manage recognition">
              <div className="panel-heading">
                <div>
                  <h2>Manage</h2>
                  <p>
                    Current ratings and reviews across the agency, with their
                    change history. This view is private to management.
                  </p>
                </div>
              </div>
              <div className="panel-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={running}
                  onClick={runWeeklySelection}
                >
                  <Trophy size={16} />
                  {running ? "Running…" : "Run weekly selection"}
                </button>
              </div>
              {runResult && (
                <div className="recognition-run-result" role="status">
                  <p>
                    <strong>{weekLabel(runResult.weekStart)}</strong>
                  </p>
                  {runResult.alreadyDecided ? (
                    <p>
                      This week's winners were already decided — no changes
                      were made.
                    </p>
                  ) : (
                    <ul>
                      <li>
                        House Manager of the Week:{" "}
                        {runResult.hmWinner?.fullName ??
                          "No eligible candidates"}
                      </li>
                      <li>
                        DSP of the Week:{" "}
                        {runResult.dspWinner?.fullName ??
                          "No eligible candidates"}
                      </li>
                    </ul>
                  )}
                </div>
              )}
              {manageRows.length === 0 ? (
                <p className="muted">
                  No ratings or reviews submitted yet.
                </p>
              ) : (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>About</th>
                        <th>Direction</th>
                        <th>Rating</th>
                        <th>Updated</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {manageRows.map((row) => {
                        const open = expanded[row.key] === true;
                        return (
                          <tr key={row.key}>
                            <td>{row.about}</td>
                            <td>{row.direction}</td>
                            <td>
                              {row.rating} · {ratingLabel(row.rating)}
                            </td>
                            <td>
                              {formatShortDate(row.updatedAt.slice(0, 10))}
                            </td>
                            <td>
                              <button
                                type="button"
                                className="button secondary small"
                                aria-expanded={open}
                                onClick={() =>
                                  setExpanded((prev) => ({
                                    ...prev,
                                    [row.key]: !prev[row.key],
                                  }))
                                }
                              >
                                <ChevronDown
                                  size={14}
                                  className={open ? "recognition-chevron-open" : ""}
                                />
                                History
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {manageRows
                .filter((row) => expanded[row.key])
                .map((row) => (
                  <div
                    key={`history-${row.key}`}
                    className="recognition-manage-history"
                  >
                    <p className="muted">
                      Change history — {row.about} ({row.direction})
                    </p>
                    <HistoryList history={row.history} />
                  </div>
                ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
