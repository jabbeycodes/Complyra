import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Check,
  Download,
  Flag,
  History,
  LockKeyhole,
  Minus,
  X,
} from "lucide-react";
import { Empty, PageHeading, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import {
  QA_ITEM_MAP,
  QA_SECTIONS,
  qaPeriodLabel,
  qaUndecidedItems,
  scoreQaAudit,
  QA_MAX_PHOTO_BYTES,
  type QaAudit,
  type QaAuditItemState,
  type QaItemResult,
  type QaPhotoInput,
} from "../../data/qaAudit";
import { buildQaAuditPdf, qaFileName } from "../../pdf/qaAuditPdf";
import { asQaBlockedError } from "./qaApiShim";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that photo."));
    reader.readAsDataURL(file);
  });
}

const RESULT_LABEL: Record<Exclude<QaItemResult, null>, string> = {
  yes: "Yes",
  no: "No",
  na: "N/A",
  skipped: "Skip",
};

function ResultBadge({ result }: { result: QaItemResult | null }) {
  if (!result) return <span className="qa-result qa-result--pending">Not scored</span>;
  const cls =
    result === "yes"
      ? "qa-result--yes"
      : result === "no"
        ? "qa-result--no"
        : "qa-result--neutral";
  return <span className={`qa-result ${cls}`}>{RESULT_LABEL[result]}</span>;
}

function ItemCard({
  item,
  canScore,
  canDispute,
  canResolve,
  onScore,
  onDispute,
  onResolve,
  busy,
}: {
  item: QaAuditItemState;
  canScore: boolean;
  canDispute: boolean;
  canResolve: boolean;
  onScore: (key: string, result: Exclude<QaItemResult, null>, comment: string) => void;
  onDispute: (key: string, note: string, photos: QaPhotoInput[]) => void;
  onResolve: (key: string, approved: boolean, reason: string) => void;
  busy: boolean;
}) {
  const def = QA_ITEM_MAP[item.itemId];
  const [comment, setComment] = useState(item.comment);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState("");
  const [photos, setPhotos] = useState<QaPhotoInput[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [resolving, setResolving] = useState(false);
  const [reason, setReason] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  async function addPhotos(files: FileList | null) {
    setPhotoError("");
    if (!files) return;
    const next: QaPhotoInput[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        setPhotoError("Only image files can be attached as evidence.");
        continue;
      }
      if (file.size > QA_MAX_PHOTO_BYTES) {
        setPhotoError("Each photo must be 2 MB or smaller.");
        continue;
      }
      next.push({
        id: crypto.randomUUID(),
        name: file.name,
        dataUrl: await fileToDataUrl(file),
        capturedAt: new Date().toISOString(),
        capturedBy: "",
      });
    }
    setPhotos((prev) => [...prev, ...next].slice(0, 6));
  }

  return (
    <div className={`qa-item ${item.locked ? "qa-item--locked" : ""}`}>
      <div className="qa-item-head">
        <div>
          <p className="qa-item-text">{def?.text ?? item.itemId}</p>
          {item.individualName && (
            <p className="qa-item-person">{item.individualName}</p>
          )}
        </div>
        <ResultBadge result={item.result} />
      </div>

      {item.locked && (
        <div className="qa-locked">
          <LockKeyhole size={16} aria-hidden />
          <div>
            <strong>System-verified — locked.</strong>
            <p>{item.systemEvidence}</p>
            <p className="qa-locked-note">
              The auditor cannot change, skip, or dispute this item.
            </p>
          </div>
        </div>
      )}

      {!item.locked && canScore && item.status !== "disputed" && (
        <div className="qa-score-row" role="group" aria-label="Score this item">
          {(["yes", "no", "na", "skipped"] as const).map((r) => (
            <button
              key={r}
              type="button"
              disabled={busy}
              aria-pressed={item.result === r}
              className={`qa-score-btn ${item.result === r ? "active" : ""} ${r === "no" ? "qa-score-btn--no" : ""}`}
              onClick={() => onScore(item.key, r, comment)}
            >
              {RESULT_LABEL[r]}
            </button>
          ))}
        </div>
      )}

      {!item.locked && (canScore || item.comment) && (
        <label className="qa-comment">
          <span>Auditor note</span>
          <textarea
            value={comment}
            disabled={!canScore || busy}
            onChange={(e) => setComment(e.target.value)}
            onBlur={() => {
              if (item.result && comment !== item.comment) {
                onScore(item.key, item.result, comment);
              }
            }}
            rows={2}
            placeholder="Optional note about this item"
          />
        </label>
      )}

      {item.status === "disputed" && (
        <div className="qa-dispute-box">
          <Flag size={16} aria-hidden />
          <div>
            <strong>
              Disputed by {item.disputeRaisedByName ?? "staff"}
              {item.disputeRaisedAt ? ` · ${formatDate(item.disputeRaisedAt.slice(0, 10))}` : ""}
            </strong>
            <p>{item.disputeNote}</p>
            {item.disputePhotos.length > 0 && (
              <div className="qa-photos">
                {item.disputePhotos.map((p) => (
                  <a key={p.id} href={p.dataUrl} target="_blank" rel="noreferrer">
                    <img src={p.dataUrl} alt={p.name || "Dispute photo evidence"} />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {item.status === "resolved" && item.disputeResolution && (
        <div className="qa-dispute-box qa-dispute-box--resolved">
          <Check size={16} aria-hidden />
          <div>
            <strong>
              Dispute {item.disputeResolution.approved ? "approved" : "not approved"} by{" "}
              {item.disputeResolution.resolvedByName ?? "auditor"}
            </strong>
            <p>{item.disputeResolution.reason}</p>
          </div>
        </div>
      )}

      {!item.locked && canDispute && (item.status === "scored" || item.status === "resolved") && (
        <div className="qa-dispute-actions">
          {!disputing ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setDisputing(true)}
            >
              <Flag size={16} /> Dispute this finding
            </button>
          ) : (
            <div className="qa-dispute-form">
              <label>
                <span>What is wrong? (required)</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Explain why the score is wrong"
                />
              </label>
              <label className="qa-photo-label">
                <Camera size={16} /> Add photo evidence (required, up to 6)
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => void addPhotos(e.target.files)}
                />
              </label>
              {photoError && <p className="form-error">{photoError}</p>}
              {photos.length > 0 && (
                <div className="qa-photos">
                  {photos.map((p) => (
                    <span key={p.id} className="qa-photo-thumb">
                      <img src={p.dataUrl} alt={p.name} />
                      <button
                        type="button"
                        aria-label={`Remove ${p.name}`}
                        onClick={() => setPhotos((prev) => prev.filter((x) => x.id !== p.id))}
                      >
                        <X size={14} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="qa-dispute-form-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setDisputing(false);
                    setNote("");
                    setPhotos([]);
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !note.trim() || photos.length === 0}
                  onClick={() => {
                    onDispute(item.key, note.trim(), photos);
                    setDisputing(false);
                    setNote("");
                    setPhotos([]);
                  }}
                >
                  Submit dispute
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {canResolve && item.status === "disputed" && (
        <div className="qa-dispute-actions">
          {!resolving ? (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={() => setResolving(true)}
            >
              Review dispute
            </button>
          ) : (
            <div className="qa-dispute-form">
              <label>
                <span>Resolution reason (required)</span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Why is the dispute approved or rejected?"
                />
              </label>
              <div className="qa-dispute-form-actions">
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    setResolving(false);
                    setReason("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || !reason.trim()}
                  onClick={() => {
                    onResolve(item.key, false, reason.trim());
                    setResolving(false);
                    setReason("");
                  }}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="button primary"
                  disabled={busy || !reason.trim()}
                  onClick={() => {
                    onResolve(item.key, true, reason.trim());
                    setResolving(false);
                    setReason("");
                  }}
                >
                  Approve
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {item.history.length > 0 && (
        <div className="qa-history">
          <button
            type="button"
            className="qa-history-toggle"
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
          >
            <History size={14} /> Change history ({item.history.length})
          </button>
          {showHistory && (
            <ul>
              {item.history.map((h, i) => (
                <li key={i}>
                  <strong>{h.action.replaceAll("_", " ")}</strong> — {h.actorName}
                  {h.at ? ` · ${formatDate(h.at.slice(0, 10))}` : ""}
                  {h.detail ? `: ${h.detail}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function QaAuditDetail({
  audit,
  siteName,
  onBack,
  onChanged,
}: {
  audit: QaAudit;
  siteName: string;
  onBack: () => void;
  onChanged: (audit: QaAudit) => void;
}) {
  const { api, session } = useData();
  const [items, setItems] = useState<QaAuditItemState[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({});
  const [sigName, setSigName] = useState("");
  const [sigMark, setSigMark] = useState("");
  const [downloading, setDownloading] = useState(false);
  // BLOCKING RULE (2026-09-14): when the data layer throws QaBlockedError
  // (system detected the item is already present/available), scoring "no" is
  // refused and the checker is prompted with the evidence instead.
  const [blocked, setBlocked] = useState<{
    key: string;
    comment: string;
    evidence: string;
  } | null>(null);

  const canScore = can(session!, "qa.audit") && audit.status !== "finalized";
  const canDispute = can(session!, "qa.dispute");
  const canResolve = can(session!, "qa.audit");
  const canDownload = can(session!, "audit.export");

  async function load() {
    setLoading(true);
    setError("");
    try {
      setItems(await api.getQaAuditItems(audit.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit.id]);

  async function run(action: () => Promise<QaAuditItemState | QaAudit>) {
    setError("");
    setBusy(true);
    try {
      const result = await action();
      if ("siteId" in result && "year" in result) {
        onChanged(result as QaAudit);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const score = useMemo(() => scoreQaAudit(items), [items]);
  const undecided = useMemo(() => qaUndecidedItems(items), [items]);
  const disputedCount = items.filter((i) => i.status === "disputed").length;

  /**
   * Score one item with the blocking rule applied: a QaBlockedError means
   * the system already proved the item present/available, so "no" is
   * refused and the checker is shown the evidence with a choice — mark it
   * present (scores yes) or cancel.
   */
  async function handleScore(
    key: string,
    result: Exclude<QaItemResult, null>,
    itemComment: string,
  ) {
    setError("");
    setBusy(true);
    try {
      await api.scoreQaItem(audit.id, key, result, itemComment);
      await load();
    } catch (err) {
      const blockedErr = asQaBlockedError(err);
      if (blockedErr) {
        setBlocked({ key, comment: itemComment, evidence: blockedErr.evidence });
      } else {
        setError((err as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function downloadPdf() {
    setDownloading(true);
    setError("");
    try {
      const doc = buildQaAuditPdf({
        agencyName: session!.agencyName,
        siteName,
        audit,
        items,
      });
      doc.save(qaFileName(siteName, audit.year, audit.quarter));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDownloading(false);
    }
  }

  if (!session) return null;

  return (
    <div>
      <button type="button" className="button" onClick={onBack}>
        ← Back to QA Review
      </button>
      <PageHeading
        eyebrow="QA Review"
        title={`${siteName} · ${qaPeriodLabel(audit.year, audit.quarter)}`}
        description={`Auditor: ${audit.auditorName ?? "—"} · Status: ${
          audit.status === "finalized" ? "Finalized" : "In progress"
        }${disputedCount > 0 ? ` · ${disputedCount} open dispute${disputedCount === 1 ? "" : "s"}` : ""}`}
      >
        {canDownload && items.length > 0 && (
          <button
            type="button"
            className="button"
            disabled={downloading}
            onClick={() => void downloadPdf()}
          >
            <Download size={16} /> {downloading ? "Preparing…" : "Download report"}
          </button>
        )}
      </PageHeading>

      {error && <p className="form-error">{error}</p>}

      <div className="qa-score-summary">
        <div>
          <span className="qa-score-label">{audit.status === "finalized" ? "Final score" : "Score so far"}</span>
          <strong>{score.pct === null ? "—" : `${score.pct}%`}</strong>
        </div>
        <div>
          <span className="qa-score-label">Pass</span>
          <strong>{score.pass}</strong>
        </div>
        <div>
          <span className="qa-score-label">Fail</span>
          <strong>{score.fail}</strong>
        </div>
        <div>
          <span className="qa-score-label">Excluded</span>
          <strong>{score.excluded}</strong>
        </div>
        <div>
          <span className="qa-score-label">Critical failures</span>
          <strong className={score.criticalFails.length > 0 ? "qa-critical" : ""}>
            {score.criticalFails.length}
          </strong>
        </div>
        <div>
          <span className="qa-score-label">Undecided</span>
          <strong>{undecided.length}</strong>
        </div>
      </div>

      {!loading && audit.status !== "finalized" && (
        <p className="muted">In progress: this score covers assessed items only. {undecided.length} item{undecided.length === 1 ? "" : "s"} still need a decision or dispute resolution.</p>
      )}

      {loading ? (
        <Empty title="Loading audit…" text="Fetching the checklist items." />
      ) : (
        QA_SECTIONS.map((section) => {
          const sectionItems = items.filter(
            (i) => QA_ITEM_MAP[i.itemId]?.sectionId === section.id,
          );
          if (sectionItems.length === 0) return null;
          const open = openSections[section.id] ?? false;
          const sectionDecided = sectionItems.filter(
            (i) => i.result !== null || i.status === "scored" || i.status === "resolved",
          ).length;
          return (
            <section key={section.id} className="qa-section">
              <button
                type="button"
                className="qa-section-head"
                aria-expanded={open}
                onClick={() =>
                  setOpenSections((prev) => ({ ...prev, [section.id]: !open }))
                }
              >
                <span>
                  <strong>{section.title}</strong>
                  <span className="qa-section-count">
                    {sectionDecided}/{sectionItems.length} decided
                  </span>
                </span>
                <span aria-hidden>{open ? "▾" : "▸"}</span>
              </button>
              {open && (
                <div className="qa-section-items">
                  {sectionItems.map((item) => (
                    <ItemCard
                      key={item.key}
                      item={item}
                      canScore={canScore}
                      canDispute={canDispute}
                      canResolve={canResolve}
                      busy={busy}
                      onScore={(key, result, itemComment) =>
                        void handleScore(key, result, itemComment)
                      }
                      onDispute={(key, disputeNote, photos) =>
                        void run(() => api.raiseQaDispute(audit.id, key, disputeNote, photos))
                      }
                      onResolve={(key, approved, resolveReason) =>
                        void run(() => api.resolveQaDispute(audit.id, key, approved, resolveReason))
                      }
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {canScore && audit.status !== "finalized" && (
        <div className="qa-finalize">
          <h2>Finalize audit</h2>
          {undecided.length > 0 ? (
            <p>
              {undecided.length} item{undecided.length === 1 ? " is" : "s are"} still
              undecided. Score or skip every item before finalizing.
            </p>
          ) : (
            <>
              <p>All items are decided. Adopt your signature to finalize.</p>
              <div className="qa-sig-row">
                <label>
                  <span>Signature name</span>
                  <input
                    value={sigName}
                    onChange={(e) => setSigName(e.target.value)}
                    placeholder="Type your full name"
                  />
                </label>
                <label>
                  <span>Signature mark</span>
                  <input
                    value={sigMark}
                    onChange={(e) => setSigMark(e.target.value)}
                    placeholder="Initials or mark"
                  />
                </label>
              </div>
              <button
                type="button"
                className="button primary"
                disabled={busy || !sigName.trim() || !sigMark.trim()}
                onClick={() =>
                  void run(() =>
                    api.finalizeQaAudit(audit.id, {
                      name: sigName.trim(),
                      mark: sigMark.trim(),
                    }),
                  )
                }
              >
                Finalize with adopted signature
              </button>
            </>
          )}
        </div>
      )}

      {audit.status === "finalized" && (
        <div className="qa-finalize qa-finalize--done">
          <h2>Finalized</h2>
          <p>
            Signed by {audit.auditorSignatureName ?? audit.auditorName ?? "auditor"}
            {audit.signedAt ? ` on ${formatDate(audit.signedAt.slice(0, 10))}` : ""}.
            Disputes can still be raised on scored items; the score updates when the
            auditor resolves them.
          </p>
        </div>
      )}

      <div className="qa-record-mark">
        <Minus size={14} aria-hidden /> Digital record generated by Complyrer
      </div>

      {blocked && (
        <div
          className="qa-blocked-overlay"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="qa-blocked-title"
          aria-describedby="qa-blocked-desc"
        >
          <div className="qa-blocked">
            <h2 id="qa-blocked-title">Can't mark this missing</h2>
            <p id="qa-blocked-desc">
              The system detected this item is already present:{" "}
              <strong>{blocked.evidence}</strong>. It can't be marked missing.
            </p>
            <div className="qa-dispute-form-actions">
              <button
                type="button"
                className="button"
                onClick={() => setBlocked(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() => {
                  const b = blocked;
                  setBlocked(null);
                  void handleScore(b.key, "yes", b.comment);
                }}
              >
                Mark as present
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
