import { useCallback, useEffect, useState } from "react";
import { BadgeCheck, Plus } from "lucide-react";
import { Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import {
  qaPeriodLabel,
  type QaAudit,
} from "../../data/qaAudit";
import QaAuditDetail from "./QaAuditDetail";

/**
 * Per-site QA Review flow for the site detail "QA Review" tab.
 * Cleaner than a static history list: site audits (newest first) drill
 * straight into the same scoring/dispute UI as the agency page.
 */
export default function SiteQaReview({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const { api, session } = useData();
  const [audits, setAudits] = useState<QaAudit[] | null>(null);
  const [openAudit, setOpenAudit] = useState<QaAudit | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  const canAudit = !!session && can(session, "qa.audit");
  const canView =
    !!session &&
    (can(session, "qa.audit") ||
      can(session, "audit.read") ||
      can(session, "audit.export"));

  const load = useCallback(async () => {
    if (!canView) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      // Site-scoped list (drafts + in progress + finalized) so auditors can
      // resume their work from the site page.
      setAudits(await api.listQaAudits({ siteId }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, canView]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!session) return null;

  if (openAudit) {
    return (
      <QaAuditDetail
        audit={openAudit}
        siteName={siteName}
        onBack={() => setOpenAudit(null)}
        onChanged={(updated) => {
          setOpenAudit(updated);
          void load();
        }}
      />
    );
  }

  async function startReview() {
    setError("");
    setCreating(true);
    try {
      const now = new Date();
      const audit = await api.createQaAudit(
        siteId,
        now.getUTCFullYear(),
        (Math.min(4, Math.floor(now.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4),
      );
      setOpenAudit(audit);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (!canView) {
    return (
      <Empty
        title="QA Review not available"
        text="Your role doesn't include permission to view QA reviews."
      />
    );
  }

  return (
    <div>
      <div className="qa-filter-row">
        <p className="muted">
          Quarterly quality reviews for {siteName}. Items Complyrer can prove
          from its own records are pre-filled and locked; the auditor scores
          the rest.
        </p>
        {canAudit && (
          <button
            type="button"
            className="button primary"
            disabled={creating}
            onClick={() => void startReview()}
          >
            <Plus size={16} /> {creating ? "Starting…" : "Start review"}
          </button>
        )}
      </div>
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <Empty title="Loading QA reviews…" text="Fetching this site's reviews." />
      ) : !audits || audits.length === 0 ? (
        <Empty
          mark="none"
          title="No QA reviews yet"
          text="No QA reviews have been recorded for this home."
        />
      ) : (
        <div className="qa-list">
          {audits.map((a) => (
            <button
              key={a.id}
              type="button"
              className="qa-row"
              onClick={() => setOpenAudit(a)}
            >
              <span className="qa-row-main">
                <BadgeCheck size={18} aria-hidden />
                <span>
                  <strong>{qaPeriodLabel(a.year, a.quarter)}</strong>
                  <span className="qa-row-sub">
                    {a.auditorName ?? "Unassigned"}
                    {a.signedAt ? ` · signed ${formatDate(a.signedAt.slice(0, 10))}` : ""}
                  </span>
                </span>
              </span>
              <span className="qa-row-side">
                {a.score?.pct !== null && a.score?.pct !== undefined && (
                  <strong className={a.score.criticalFails.length > 0 ? "qa-critical" : ""}>
                    {a.score.pct}%
                  </strong>
                )}
                <span className={`qa-status qa-status--${a.status}`}>
                  {a.status === "finalized" ? "Finalized" : "In progress"}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
