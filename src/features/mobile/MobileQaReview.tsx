import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import { can } from "../../data/status";
import {
  scoreQaAudit,
  type QaAudit,
  type QaAuditItemState,
} from "../../data/qaAudit";
import type { CorrectiveAction } from "../../data/correctiveActions";
import {
  correctiveActionLine,
  qaAllDecided,
  qaItemStatusText,
  qaItemTitle,
  qaSectionTitle,
} from "./hub";

/**
 * Mobile QA Review — a read-first phone view of the quarterly site QA
 * audits for the shell's picked home: the audit list with status and
 * score, the item-by-item record (system-verified items carry their
 * evidence; scored items state their result; disputes and resolutions
 * are stated in words), and the agency's corrective actions read-only.
 * The one action kept is the desktop's own sign action: an auditor
 * with qa.audit finalizes a fully-decided audit with an adopted
 * signature (typed name + mark) through finalizeQaAudit. Scoring,
 * disputes (photo evidence), and corrective-action management stay on
 * the desktop QA Review / Audit center surfaces.
 *
 * The door is the desktop page gate itself (pageVisible "QA Review":
 * qa.audit / qa.dispute / qa.schedule / audit.read), applied by the
 * tile; the API enforces the same permissions again server-side.
 */
export default function MobileQaReview({
  api,
  session,
  siteId,
  siteName,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string;
  siteName: string;
}) {
  const [audits, setAudits] = useState<QaAudit[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [corrective, setCorrective] = useState<CorrectiveAction[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [auditRows, actionRows] = await Promise.all([
        api.listQaAudits({ siteId }),
        api.listCorrectiveActions({}).catch(() => [] as CorrectiveAction[]),
      ]);
      setAudits(auditRows);
      setCorrective(actionRows);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load QA audits.");
    } finally {
      setLoading(false);
    }
  }, [api, siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openActions = useMemo(
    () =>
      corrective
        .map((action) => correctiveActionLine(action))
        .filter((line) => line.status !== "Resolved"),
    [corrective],
  );

  return (
    <div>
      <p className="msh-section-note">
        Quarterly QA audits for {siteName}, plus the agency&rsquo;s open
        corrective actions.
      </p>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="msh-empty">Loading QA audits…</p>
      ) : (
        <>
          {audits.length === 0 && (
            <p className="msh-empty">No QA audits for this home yet.</p>
          )}
          <div className="msh-list">
            {audits.map((audit) =>
              openId === audit.id ? (
                <AuditDetail
                  key={audit.id}
                  api={api}
                  session={session}
                  audit={audit}
                  onClose={() => setOpenId(null)}
                  onChanged={() => void load()}
                />
              ) : (
                <button
                  key={audit.id}
                  type="button"
                  className="msh-row"
                  onClick={() => setOpenId(audit.id)}
                >
                  <span className="msh-row-main">
                    <strong>
                      {audit.year} Q{audit.quarter} QA audit
                    </strong>
                    <small className="msh-status-text">
                      {audit.status === "finalized" ? "Finalized" : "In progress"}
                      {audit.score?.pct !== null && audit.score?.pct !== undefined
                        ? ` · Score ${audit.score.pct}%`
                        : ""}
                      {audit.auditorName ? ` · Auditor ${audit.auditorName}` : ""}
                    </small>
                    {audit.status === "finalized" && audit.signedAt && (
                      <small>
                        Signed {audit.signedAt.slice(0, 10)} by{" "}
                        {audit.auditorSignatureName ?? audit.auditorName}
                      </small>
                    )}
                  </span>
                  <span className="msh-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ),
            )}
          </div>

          <h3 className="msh-pass-title">Corrective actions</h3>
          <p className="msh-section-note">
            Read-only here — corrective actions are managed in the
            desktop Audit center.
          </p>
          {openActions.length === 0 ? (
            <p className="msh-empty">No open corrective actions.</p>
          ) : (
            <div className="msh-list">
              {openActions.map((line) => (
                <div key={line.id} className="msh-row static">
                  <span className="msh-row-main">
                    <strong>{line.title}</strong>
                    <small className="msh-status-text">
                      {line.status}
                      {line.overdue ? " · Overdue" : ""}
                    </small>
                    {line.detail && <small>{line.detail}</small>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AuditDetail({
  api,
  session,
  audit,
  onClose,
  onChanged,
}: {
  api: ComplyraApi;
  session: SessionUser;
  audit: QaAudit;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [items, setItems] = useState<QaAuditItemState[] | null>(null);
  const [error, setError] = useState("");
  const [sigName, setSigName] = useState(session.fullName);
  const [sigMark, setSigMark] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api
      .getQaAuditItems(audit.id)
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch((err) => {
        if (live) {
          setError(err instanceof Error ? err.message : "Could not load audit items.");
        }
      });
    return () => {
      live = false;
    };
  }, [api, audit.id]);

  const score = useMemo(() => (items ? scoreQaAudit(items) : null), [items]);
  const canFinalize =
    can(session, "qa.audit") &&
    audit.status !== "finalized" &&
    items !== null &&
    qaAllDecided(items);

  const finalize = async () => {
    setBusy(true);
    setError("");
    try {
      await api.finalizeQaAudit(audit.id, {
        name: sigName.trim(),
        mark: sigMark.trim(),
      });
      onChanged();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finalize the audit.");
      setBusy(false);
    }
  };

  const sections: { title: string; items: QaAuditItemState[] }[] = [];
  for (const item of items ?? []) {
    const title = qaSectionTitle(item);
    const group = sections.find((row) => row.title === title);
    if (group) group.items.push(item);
    else sections.push({ title, items: [item] });
  }

  return (
    <div className="msh-record-card">
      <strong>
        {audit.year} Q{audit.quarter} QA audit —{" "}
        {audit.status === "finalized" ? "Finalized" : "In progress"}
      </strong>
      {score && (
        <p className="msh-status-text">
          {audit.status === "finalized" ? "Final score" : "Score so far"}:{" "}
          {score.pct !== null ? `${score.pct}%` : "not scored yet"} ·{" "}
          {score.pass} passed · {score.fail} failed · {score.excluded} not
          applicable
          {score.criticalFails.length > 0
            ? ` · ${score.criticalFails.length} critical failure${score.criticalFails.length === 1 ? "" : "s"}`
            : ""}
        </p>
      )}
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && <p className="msh-empty">Loading audit items…</p>}
      {sections.map((section) => (
        <div key={section.title}>
          <h4 className="msh-day-heading">{section.title}</h4>
          {section.items.map((item) => (
            <div key={item.key} className="msh-record-item">
              <p>
                <strong>{qaItemTitle(item)}</strong>
              </p>
              <p className="msh-status-text">{qaItemStatusText(item)}</p>
              {item.comment && <p>Auditor comment: {item.comment}</p>}
              {item.status === "disputed" && item.disputeNote && (
                <p>
                  Disputed by {item.disputeRaisedByName ?? "staff"}
                  {item.disputeRaisedAt
                    ? ` · ${item.disputeRaisedAt.slice(0, 10)}`
                    : ""}
                  : {item.disputeNote}
                </p>
              )}
              {item.status === "resolved" && item.disputeResolution && (
                <p>
                  Dispute {item.disputeResolution.approved ? "approved" : "not approved"}{" "}
                  by {item.disputeResolution.resolvedByName ?? "auditor"}:{" "}
                  {item.disputeResolution.reason}
                </p>
              )}
            </div>
          ))}
        </div>
      ))}
      {canFinalize && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy && sigName.trim() && sigMark.trim()) void finalize();
          }}
        >
          <p>
            All items are decided. Adopt your signature to finalize.
          </p>
          <label className="msh-field">
            <span>Signature name</span>
            <input
              type="text"
              required
              value={sigName}
              onChange={(event) => setSigName(event.target.value)}
            />
          </label>
          <label className="msh-field">
            <span>Signature mark</span>
            <input
              type="text"
              required
              value={sigMark}
              onChange={(event) => setSigMark(event.target.value)}
              placeholder="Initials or mark"
            />
          </label>
          <div className="msh-form-actions">
            <button
              type="submit"
              className="msh-button primary"
              disabled={busy || !sigName.trim() || !sigMark.trim()}
            >
              Finalize with adopted signature
            </button>
          </div>
        </form>
      )}
      {audit.status === "finalized" && (
        <p className="msh-status-text">
          Finalized — signed by {audit.auditorSignatureName ?? audit.auditorName} on{" "}
          {audit.signedAt?.slice(0, 10) ?? "—"}. Digital record generated by
          Complyrer.
        </p>
      )}
      <div className="msh-form-actions">
        <button type="button" className="msh-button secondary" onClick={onClose}>
          Back to audits
        </button>
      </div>
    </div>
  );
}
