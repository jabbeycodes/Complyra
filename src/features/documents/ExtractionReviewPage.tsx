/**
 * ExtractionReviewPage — PM/RN reviews an AI extraction side-by-side.
 *
 * Left: the extracted structured data (individual, plan dates, outcomes and
 * goals, protocols, dietary, behavioral supports, training requirements,
 * physician orders, signatures including missing ones).
 * Right: the proposed trackable items — each editable (title, detail, due
 * date), add-new, remove.
 *
 * Confidence is shown per field; low-confidence fields are flagged
 * "Needs human check" with icon + text (never color alone).
 *
 * Gating: Approve / Reject act on the whole extraction. Per-item Activate is
 * disabled until the extraction is approved. NOTHING becomes tracked or
 * visible to staff before approval — the copy and the disabled buttons say
 * so explicitly.
 *
 * Delegation handoff: activating a `protocol_needs_delegation` item runs the
 * backend delegation workflow — the editable training draft is created
 * automatically and lands in the delegation review queue (confirmed
 * inline on the item card). No separate draft step is needed.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Plus,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { Badge, Empty, formatDate, PageHeading } from "../../components";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import { useData } from "../../data/DataProvider";
import {
  canReviewDocuments,
  confidenceLabel,
  documentTypeLabel,
  extractionDatesSection,
  extractionListSections,
  isMissingSignature,
  needsHumanCheck,
  trackableItemKindLabel,
  uploadStatusLabel,
  TRACKABLE_ITEM_KIND_LABELS,
  getDocumentsApi,
  type DocumentUploadSummary,
  type ExtractedField,
  type ExtractionListItem,
  type PcspExtraction,
  type TrackableItem,
  type TrackableItemKind,
  type UploadStatus,
} from "./documents";

function ConfidenceNote({ confidence }: { confidence?: number | null }) {
  if (confidence == null) return null;
  const flag = needsHumanCheck(confidence);
  return (
    <span style={{ whiteSpace: "nowrap" }}>
      <span className="doc-confidence">{confidenceLabel(confidence)}</span>
      {flag && (
        <span className="doc-flag" role="img" aria-label="Needs human check">
          <AlertTriangle size={12} aria-hidden /> Needs human check
        </span>
      )}
    </span>
  );
}

function FieldLine<T>({ label, field }: { label: string; field: ExtractedField<T> }) {
  const value = field.value;
  if (value == null || value === "") return null;
  return (
    <li>
      <strong>{label}:</strong> {String(value)}
      <ConfidenceNote confidence={field.confidence} />
    </li>
  );
}

function ItemList({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: ExtractionListItem[];
  emptyText: string;
}) {
  return (
    <div className="doc-section">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="doc-hint">{emptyText}</p>
      ) : (
        <ul>
          {items.map((item, i) => (
            <li key={i}>
              <strong>{item.title}</strong>
              {item.detail ? ` — ${item.detail}` : ""}
              <ConfidenceNote confidence={item.confidence} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function statusBadge(status: UploadStatus) {
  return <Badge status={uploadStatusLabel(status)} />;
}

/* ------------------------------------------------------------------ */
/* Trackable item card (right column)                                   */
/* ------------------------------------------------------------------ */

function TrackableItemCard({
  item,
  approved,
  onChanged,
}: {
  item: TrackableItem;
  approved: boolean;
  onChanged: (item: TrackableItem) => void;
}) {
  const { api } = useData();
  const docs = useMemo(() => getDocumentsApi(api), [api]);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [detail, setDetail] = useState(item.detail);
  const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setSaving(true);
    setError("");
    try {
      const updated = await docs.updateTrackableItem(item.id, {
        title: title.trim(),
        detail: detail.trim(),
        dueDate: dueDate || null,
      });
      onChanged(updated);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message ?? "Could not save the item.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove "${item.title}" from the proposed items?`)) return;
    setSaving(true);
    setError("");
    try {
      const updated = await docs.updateTrackableItem(item.id, { status: "dismissed" });
      onChanged(updated);
    } catch (err) {
      setError((err as Error).message ?? "Could not remove the item.");
    } finally {
      setSaving(false);
    }
  }

  async function activate() {
    setSaving(true);
    setError("");
    try {
      const updated = await docs.activateTrackableItem(item.id);
      onChanged(updated);
    } catch (err) {
      setError((err as Error).message ?? "Could not activate the item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="doc-item">
      <div className="doc-item-head">
        <span className="doc-item-kind">{trackableItemKindLabel(item.kind)}</span>
        <Badge
          status={item.status === "proposed" ? "Proposed" : item.status === "activated" ? "Activated" : "Removed"}
        />
        <ConfidenceNote confidence={item.confidence} />
      </div>
      {editing ? (
        <div className="doc-form" style={{ marginTop: 0 }}>
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Detail
            <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
          </label>
          <label>
            Due date
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </label>
        </div>
      ) : (
        <>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{item.title}</div>
          {item.detail && (
            <p className="doc-hint" style={{ marginTop: 4 }}>{item.detail}</p>
          )}
          {item.dueDate && (
            <p className="doc-hint" style={{ marginTop: 4 }}>
              Due {formatDate(item.dueDate)}
            </p>
          )}
        </>
      )}
      {error && (
        <div className="doc-error" role="alert" style={{ marginTop: 8 }}>
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="doc-item-actions">
        {item.status === "proposed" && !editing && (
          <button className="button small" onClick={() => setEditing(true)} disabled={saving}>
            Edit
          </button>
        )}
        {editing && (
          <>
            <button className="button primary small" onClick={save} disabled={saving || !title.trim()}>
              {saving ? "Saving…" : "Save changes"}
            </button>
            <button className="button small" onClick={() => { setEditing(false); setTitle(item.title); setDetail(item.detail); setDueDate(item.dueDate ?? ""); }} disabled={saving}>
              Cancel
            </button>
          </>
        )}
        {item.status === "proposed" && !editing && (
          <button
            className="button small"
            onClick={activate}
            disabled={!approved || saving}
            title={approved ? "Activate this item" : "Available after the extraction is approved"}
          >
            {saving ? "Working…" : "Activate"}
          </button>
        )}
        {item.status === "proposed" && !editing && (
          <button className="button small" onClick={remove} disabled={saving}>
            Remove
          </button>
        )}
        {item.kind === "protocol_needs_delegation" && item.status === "activated" && (
          <span className="doc-hint" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <CheckCircle2 size={14} color="#1a7f37" /> Training draft created — it is now in the delegation review queue.
          </span>
        )}
      </div>
      {!approved && item.status === "proposed" && (
        <p className="doc-hint" style={{ marginTop: 8 }}>
          Activation unlocks after the extraction is approved. Nothing is tracked or visible to staff before then.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function ExtractionReviewPage({
  initialUploadId,
  onSelectUpload,
}: {
  initialUploadId: string | null;
  onSelectUpload: (uploadId: string | null) => void;
}) {
  const { api, session, workspace } = useData();
  const docs = useMemo(
    () =>
      getDocumentsApi(api, {
        resolveIndividualName: (id) =>
          workspace?.individuals.find((p) => p.id === id)?.name,
      }),
    [api, workspace],
  );

  const [queue, setQueue] = useState<DocumentUploadSummary[] | null>(null);
  const [extraction, setExtraction] = useState<PcspExtraction | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [acting, setActing] = useState(false);
  // Add-new item form
  const [adding, setAdding] = useState(false);
  const [newKind, setNewKind] = useState<TrackableItemKind>("review_task");
  const [newTitle, setNewTitle] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [newDueDate, setNewDueDate] = useState("");

  const uploadId = initialUploadId;

  const queuedUpload =
    (queue ?? []).find((q) => q.uploadId === uploadId) ?? null;
  // The upload exists but the extraction row isn't there yet — the AI (or the
  // edge function) is still working. Poll instead of showing "Not found".
  const extractionPending =
    !loading &&
    !!uploadId &&
    !extraction &&
    !error &&
    !!queuedUpload &&
    (queuedUpload.status === "uploading" || queuedUpload.status === "extracting");

  const loadQueue = useCallback(async () => {
    const rows = await docs.listUploads();
    setQueue(rows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadExtraction = useCallback(
    async (id: string) => {
      const ex = await docs.getExtraction(id);
      setExtraction(ex);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    (async () => {
      try {
        await loadQueue();
        if (uploadId) await loadExtraction(uploadId);
        else setExtraction(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? "Could not load the review queue.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [uploadId, loadQueue, loadExtraction]);

  // While the extraction is still being produced, re-check periodically so
  // the reviewer lands on the finished extraction without refreshing.
  useEffect(() => {
    if (!extractionPending || !uploadId) return;
    const timer = setInterval(() => {
      loadExtraction(uploadId).catch(() => {
        // A transient fetch failure is fine; the next tick retries.
      });
    }, 5000);
    return () => clearInterval(timer);
  }, [extractionPending, uploadId, loadExtraction]);

  if (!canReviewDocuments(session)) {
    return (
      <>
        <PageHeading title="Review extractions" />
        <section className="panel">
          <Empty title="No access" text="Extraction review is limited to administrators, program managers, and nurses." />
        </section>
      </>
    );
  }

  async function approve() {
    if (!uploadId) return;
    setActing(true);
    setError("");
    try {
      const ex = await docs.approveExtraction(uploadId);
      setExtraction(ex);
      await loadQueue();
    } catch (err) {
      setError((err as Error).message ?? "Could not approve the extraction.");
    } finally {
      setActing(false);
    }
  }

  async function reject() {
    if (!uploadId) return;
    if (!rejectReason.trim()) {
      setError("Give a reason for the rejection so the uploader knows what to fix.");
      return;
    }
    setActing(true);
    setError("");
    try {
      await docs.rejectUpload(uploadId, rejectReason.trim());
      setRejecting(false);
      setRejectReason("");
      onSelectUpload(null);
      await loadQueue();
    } catch (err) {
      setError((err as Error).message ?? "Could not reject the upload.");
    } finally {
      setActing(false);
    }
  }

  function handleItemChanged(updated: TrackableItem) {
    setExtraction((ex) =>
      ex ? { ...ex, items: ex.items.map((i) => (i.id === updated.id ? updated : i)) } : ex,
    );
  }

  const visibleItems = (extraction?.items ?? []).filter((i) => i.status !== "dismissed");
  const removedCount = (extraction?.items ?? []).filter((i) => i.status === "dismissed").length;
  const approved = extraction?.status === "approved";

  return (
    <>
      <PageHeading
        title={uploadId ? "Review extraction" : "Extraction review"}
        description={
          uploadId
            ? "Nothing is tracked until a person approves it."
            : undefined
        }
      >
        {uploadId && (
          <button className="button" onClick={() => onSelectUpload(null)}>
            <ArrowLeft size={16} /> Back to queue
          </button>
        )}
      </PageHeading>

      {loading && (
        <section className="panel">
          <p className="doc-hint">Loading…</p>
        </section>
      )}
      {error && (
        <section className="panel">
          <div className="doc-error" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        </section>
      )}

      {!loading && !uploadId && (
        <section className="panel">
          {queue === null || queue.length === 0 ? (
            <Empty title="Queue is clear" text="No document uploads yet. Approved and rejected uploads appear here too, for the record." />
          ) : (
            queue.map((row) => (
              <div key={row.uploadId} className="doc-queue-row">
                <div className="doc-queue-main">
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    <FileText size={14} style={{ verticalAlign: -2, marginRight: 6 }} aria-hidden />
                    {row.fileName}
                  </div>
                  <p className="doc-hint" style={{ marginTop: 4 }}>
                    {row.individualName} · {documentTypeLabel(row.documentType)} · uploaded {formatDate(row.createdAt)}
                  </p>
                </div>
                {statusBadge(row.status)}
                <button className="button small" onClick={() => onSelectUpload(row.uploadId)}>
                  {row.status === "ready_for_review" ? "Review" : "Open"}
                </button>
              </div>
            ))
          )}
        </section>
      )}

      {!loading && uploadId && extraction && (
        <>
          <section className="panel">
            <div className="doc-queue-row" style={{ marginBottom: 0 }}>
              <div className="doc-queue-main">
                <div style={{ fontWeight: 600, fontSize: 15 }}>{extraction.fileName}</div>
                <p className="doc-hint" style={{ marginTop: 4 }}>
                  {extraction.individualName} · {documentTypeLabel(extraction.documentType)} · uploaded {formatDate(extraction.createdAt)}
                  {extraction.reviewedAt && ` · reviewed ${formatDate(extraction.reviewedAt)}${extraction.reviewedBy ? ` by ${extraction.reviewedBy}` : ""}`}
                </p>
              </div>
              {statusBadge(extraction.status)}
            </div>
            {extraction.status === "rejected" && extraction.rejectionReason && (
              <div className="doc-error" role="alert" style={{ marginTop: 12 }}>
                <XCircle size={18} />
                <span><strong>Rejected:</strong> {extraction.rejectionReason}</span>
              </div>
            )}
            {extraction.status === "ready_for_review" && (
              <div className="doc-notice" style={{ marginTop: 12 }}>
                <ShieldAlert size={18} />
                <span>
                  <strong>Nothing is tracked or visible to staff yet.</strong> Proposed items below become real only after you approve this extraction — and each item still needs individual activation.
                </span>
              </div>
            )}
          </section>

          <div className="doc-review-grid" style={{ marginTop: 16 }}>
            {/* Left: extracted structured data */}
            <section className="panel" aria-label="Extracted document data">
              <div className="panel-heading">
                <h2>Extracted data</h2>
                <p>What the AI read in the document. Check it against the source file.</p>
              </div>
              <div className="doc-section">
                <h3>{extractionDatesSection(extraction.documentType).title}</h3>
                <ul>
                  {extractionDatesSection(extraction.documentType).rows.map(
                    (row) => (
                      <FieldLine
                        key={row.field}
                        label={row.label}
                        field={extraction.structured[row.field]}
                      />
                    ),
                  )}
                </ul>
              </div>
              {extractionListSections(extraction.documentType).map((section) => (
                <ItemList
                  key={section.key}
                  title={section.title}
                  items={extraction.structured[section.key]}
                  emptyText={section.emptyText}
                />
              ))}
              <div className="doc-section">
                <h3>Signatures</h3>
                {extraction.structured.signatures.length === 0 ? (
                  <p className="doc-hint">No signatures extracted.</p>
                ) : (
                  <ul>
                    {extraction.structured.signatures.map((sig, i) => (
                      <li key={i}>
                        <strong>{sig.role}:</strong>{" "}
                        {sig.signed ? (
                          <>
                            {sig.name ?? "Signed"}{sig.signedAt ? ` · ${formatDate(sig.signedAt)}` : ""}
                            <span className="doc-confidence" style={{ color: "#1a7f37" }}>
                              <CheckCircle2 size={12} aria-hidden /> Signed
                            </span>
                          </>
                        ) : (
                          <span className="doc-flag">
                            <AlertTriangle size={12} aria-hidden /> Missing signature
                          </span>
                        )}
                        {isMissingSignature(sig) ? null : <ConfidenceNote confidence={sig.confidence} />}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Right: proposed trackable items */}
            <section className="panel" aria-label="Proposed trackable items">
              <div className="panel-heading">
                <h2>Proposed trackable items</h2>
                <p>Edit, add, or remove. Items activate individually after approval.</p>
              </div>
              {visibleItems.length === 0 && (
                <p className="doc-hint">No proposed items.</p>
              )}
              {visibleItems.map((item) => (
                <TrackableItemCard
                  key={item.id}
                  item={item}
                  approved={approved}
                  onChanged={handleItemChanged}
                />
              ))}
              {removedCount > 0 && (
                <p className="doc-hint">{removedCount} item{removedCount === 1 ? "" : "s"} removed.</p>
              )}
              {!adding ? (
                <button className="button small" onClick={() => setAdding(true)} disabled={!canReviewDocuments(session)}>
                  <Plus size={14} /> Add item
                </button>
              ) : (
                <AddItemForm
                  uploadId={uploadId}
                  onAdded={(item) => {
                    setExtraction((ex) => (ex ? { ...ex, items: [...ex.items, item] } : ex));
                    setAdding(false);
                    setNewKind("review_task");
                    setNewTitle("");
                    setNewDetail("");
                    setNewDueDate("");
                  }}
                  onCancel={() => setAdding(false)}
                  kind={newKind}
                  setKind={setNewKind}
                  title={newTitle}
                  setTitle={setNewTitle}
                  detail={newDetail}
                  setDetail={setNewDetail}
                  dueDate={newDueDate}
                  setDueDate={setNewDueDate}
                />
              )}
            </section>
          </div>

          {/* Approve / reject */}
          {extraction.status === "ready_for_review" && (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-heading">
                <h2>Review decision</h2>
                <p>Approval makes items eligible for activation — staff still see nothing until each item is activated.</p>
              </div>
              {!rejecting ? (
                <div className="doc-item-actions">
                  <button className="button primary" onClick={approve} disabled={acting}>
                    <CheckCircle2 size={16} /> {acting ? "Approving…" : "Approve extraction"}
                  </button>
                  <button className="button danger" onClick={() => setRejecting(true)} disabled={acting}>
                    <XCircle size={16} /> Reject
                  </button>
                </div>
              ) : (
                <div className="doc-form" style={{ marginTop: 0 }}>
                  <label>
                    Rejection reason (the uploader will see this)
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      rows={3}
                      placeholder="What should the uploader fix and resubmit?"
                    />
                  </label>
                  <div className="doc-item-actions">
                    <button className="button danger" onClick={reject} disabled={acting || !rejectReason.trim()}>
                      {acting ? "Rejecting…" : "Confirm rejection"}
                    </button>
                    <button className="button" onClick={() => { setRejecting(false); setRejectReason(""); }} disabled={acting}>
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}
          <ComplyrerRecordMark documentId={extraction.uploadId} generatedAt={extraction.createdAt} />
        </>
      )}

      {extractionPending && (
        <section className="panel">
          <Empty
            title="Extraction in progress"
            text="The document is still being processed. This page will show the proposed items automatically when extraction finishes."
          />
          <div className="doc-item-actions">
            <button
              className="button"
              onClick={() => uploadId && loadExtraction(uploadId)}
            >
              Check again
            </button>
          </div>
        </section>
      )}
      {!loading && uploadId && !extraction && !error && !extractionPending && (
        <section className="panel">
          <Empty title="Not found" text="That upload could not be loaded. It may have been removed." />
        </section>
      )}
    </>
  );
}

function AddItemForm({
  uploadId,
  onAdded,
  onCancel,
  kind,
  setKind,
  title,
  setTitle,
  detail,
  setDetail,
  dueDate,
  setDueDate,
}: {
  uploadId: string;
  onAdded: (item: TrackableItem) => void;
  onCancel: () => void;
  kind: TrackableItemKind;
  setKind: (k: TrackableItemKind) => void;
  title: string;
  setTitle: (v: string) => void;
  detail: string;
  setDetail: (v: string) => void;
  dueDate: string;
  setDueDate: (v: string) => void;
}) {
  const { api } = useData();
  const docs = useMemo(() => getDocumentsApi(api), [api]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function add() {
    if (!title.trim()) {
      setError("Give the item a title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const item = await docs.addTrackableItem(uploadId, {
        kind,
        title: title.trim(),
        detail: detail.trim(),
        dueDate: dueDate || null,
      });
      onAdded(item);
    } catch (err) {
      setError((err as Error).message ?? "Could not add the item.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="doc-form" style={{ borderTop: "1px solid #eae8e4", paddingTop: 12 }}>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as TrackableItemKind)}>
          {(Object.keys(TRACKABLE_ITEM_KIND_LABELS) as TrackableItemKind[]).map((k) => (
            <option key={k} value={k}>{TRACKABLE_ITEM_KIND_LABELS[k]}</option>
          ))}
        </select>
      </label>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        Detail
        <textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} />
      </label>
      <label>
        Due date
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </label>
      {error && (
        <div className="doc-error" role="alert">
          <AlertTriangle size={16} />
          <span>{error}</span>
        </div>
      )}
      <div className="doc-item-actions">
        <button className="button primary small" onClick={add} disabled={saving}>
          {saving ? "Adding…" : "Add item"}
        </button>
        <button className="button small" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </div>
  );
}
