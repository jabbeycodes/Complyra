/**
 * ReconciliationCard — the medication reconciliation workflow + history on the
 * Individual chart.
 *
 * Used on admission, after an ER / hospital return, and whenever orders
 * change: start a reconciliation (which seeds a checklist by comparing the
 * active orders against the current MAR medication list), record each
 * medication as continue / change / stop with a note, flag discrepancies, and
 * capture a nurse sign-off with date and note. Completed reconciliations stay
 * on the chart as an auditable, printable history. "Individuals" wording only.
 */
import { useEffect, useState } from "react";
import { ClipboardList, Download, Printer } from "lucide-react";
import { Badge, Empty, formatDateLong } from "../../components";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import { useData } from "../../data/DataProvider";
import {
  canSignReconciliation,
  canStartReconciliation,
  canViewMedicationOrders,
} from "../../data/permissions";
import {
  RECONCILIATION_DECISION_LABEL,
  RECONCILIATION_TRIGGER_LABEL,
} from "../../data/medicationOrders";
import { openPrintable } from "../../data/openFile";
import {
  buildReconciliationPdf,
  reconciliationFileName,
} from "../../pdf/reconciliationPdf";
import type {
  MedicationReconciliationView,
  ReconciliationDecision,
  ReconciliationItemInput,
  ReconciliationTrigger,
} from "../../data/types";

const TRIGGERS: ReconciliationTrigger[] = [
  "admission",
  "hospital_return",
  "order_change",
];

const DECISIONS: ReconciliationDecision[] = ["continue", "change", "stop"];

export default function ReconciliationCard({
  individualId,
  individualName,
  siteName,
}: {
  individualId: string;
  individualName: string;
  siteName: string;
}) {
  const { api, session, workspace } = useData();
  const [list, setList] = useState<MedicationReconciliationView[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [trigger, setTrigger] = useState<ReconciliationTrigger>("admission");
  const [draftItems, setDraftItems] = useState<ReconciliationItemInput[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [signNote, setSignNote] = useState("");

  async function reload() {
    setList(await api.listReconciliations(individualId));
  }

  useEffect(() => {
    let live = true;
    setList(null);
    setError("");
    setDraftItems(null);
    setActiveId(null);
    api
      .listReconciliations(individualId)
      .then((rows) => live && setList(rows))
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [api, individualId]);

  if (!session || !canViewMedicationOrders(session.roleKey)) return null;
  const canStart = canStartReconciliation(session.roleKey);
  const canSign = canSignReconciliation(session.roleKey);

  function loadDraft(recon: MedicationReconciliationView) {
    setActiveId(recon.id);
    setSignNote("");
    setDraftItems(
      recon.items.map((item) => ({
        orderId: item.orderId,
        medicationId: item.medicationId,
        medicationLabel: item.medicationLabel,
        decision: item.decision,
        discrepancy: item.discrepancy,
        note: item.note,
      })),
    );
  }

  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    await run(async () => {
      const recon = await api.startReconciliation({ individualId, trigger });
      await reload();
      loadDraft(recon);
    });
  }

  function patchItem(index: number, patch: Partial<ReconciliationItemInput>) {
    setDraftItems((prev) =>
      prev
        ? prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
        : prev,
    );
  }

  async function saveItems() {
    if (!activeId || !draftItems) return;
    await run(async () => {
      await api.saveReconciliationItems(activeId, draftItems);
      await reload();
    });
  }

  async function signOff() {
    if (!activeId || !draftItems) return;
    await run(async () => {
      // Persist the latest decisions before locking the record.
      await api.saveReconciliationItems(activeId, draftItems);
      await api.signOffReconciliation(activeId, { note: signNote });
      await reload();
      setDraftItems(null);
      setActiveId(null);
      setSignNote("");
    });
  }

  async function printPdf(
    recon: MedicationReconciliationView,
    mode: "download" | "print",
  ) {
    const generatedAt = new Date().toISOString();
    const doc = buildReconciliationPdf({
      agencyName: session.agencyName,
      individualName,
      siteName,
      reconciliation: recon,
      generatedAt,
      logoDataUrl: workspace?.branding.logoUrl ?? null,
    });
    await openPrintable(
      reconciliationFileName(individualName, generatedAt),
      doc.output("blob") as Blob,
      mode,
    );
  }

  const inProgress = (list ?? []).find((row) => row.status === "in_progress");

  return (
    <section className="chart-widget" aria-labelledby="med-recon-heading">
      <div className="chart-widget-head">
        <h2 id="med-recon-heading">
          <ClipboardList size={16} aria-hidden="true" /> Medication reconciliation
        </h2>
      </div>
      <p className="stack-help">
        Reconcile on admission, after an ER or hospital return, and whenever
        orders change. Each medication is marked continue, change, or stop, and
        a nurse signs off. Completed reconciliations stay on this chart.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {canStart && !inProgress && !draftItems && (
        <form
          className="renewal-upload"
          onSubmit={(e) => {
            e.preventDefault();
            void start();
          }}
        >
          <label>
            Reason for reconciliation
            <select
              value={trigger}
              onChange={(e) => setTrigger(e.target.value as ReconciliationTrigger)}
            >
              {TRIGGERS.map((value) => (
                <option key={value} value={value}>
                  {RECONCILIATION_TRIGGER_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <button className="button primary" type="submit" disabled={busy}>
            Start reconciliation
          </button>
        </form>
      )}

      {inProgress && !draftItems && (
        <article className="obligation-card">
          <header>
            <h3>{RECONCILIATION_TRIGGER_LABEL[inProgress.trigger]} — in progress</h3>
            <Badge status="Pending review" />
          </header>
          <p className="muted">
            Started by {inProgress.startedByName} ·{" "}
            {formatDateLong(inProgress.startedAt)}
          </p>
          {canStart && (
            <div className="chart-actions">
              <button className="button primary" onClick={() => loadDraft(inProgress)}>
                Open checklist
              </button>
            </div>
          )}
        </article>
      )}

      {draftItems && (
        <div className="stack">
          {draftItems.length === 0 && (
            <p className="muted">
              No active orders or MAR medications to reconcile. Add a sign-off
              note to close this reconciliation.
            </p>
          )}
          {draftItems.map((item, index) => (
            <article key={index} className="obligation-card">
              <header>
                <h3>{item.medicationLabel}</h3>
                {item.discrepancy && <Badge status="Overdue" />}
              </header>
              <label>
                Decision
                <select
                  value={item.decision}
                  onChange={(e) =>
                    patchItem(index, {
                      decision: e.target.value as ReconciliationDecision,
                    })
                  }
                >
                  {DECISIONS.map((value) => (
                    <option key={value} value={value}>
                      {RECONCILIATION_DECISION_LABEL[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={Boolean(item.discrepancy)}
                  onChange={(e) => patchItem(index, { discrepancy: e.target.checked })}
                />
                Flag as a discrepancy
              </label>
              <label>
                Note {item.decision !== "continue" ? "(required)" : "(optional)"}
                <input
                  value={item.note ?? ""}
                  onChange={(e) => patchItem(index, { note: e.target.value })}
                />
              </label>
            </article>
          ))}
          <div className="chart-actions">
            <button className="button" disabled={busy} onClick={() => void saveItems()}>
              Save decisions
            </button>
            <button
              className="button"
              type="button"
              disabled={busy}
              onClick={() => {
                setDraftItems(null);
                setActiveId(null);
              }}
            >
              Close checklist
            </button>
          </div>
          {canSign && (
            <form
              className="renewal-upload"
              onSubmit={(e) => {
                e.preventDefault();
                void signOff();
              }}
            >
              <label>
                Nurse sign-off note
                <input
                  value={signNote}
                  onChange={(e) => setSignNote(e.target.value)}
                  placeholder="Reviewed against active orders; no outstanding discrepancies."
                  required
                />
              </label>
              <button className="button primary" type="submit" disabled={busy}>
                Sign off and complete
              </button>
            </form>
          )}
        </div>
      )}

      {list && list.filter((row) => row.status === "completed").length === 0 &&
        !inProgress &&
        !draftItems && (
          <Empty
            mark="none"
            title="No reconciliations yet"
            text="No medication reconciliations have been completed for this Individual."
          />
        )}

      {list && list.some((row) => row.status === "completed") && (
        <div className="stack">
          <h3 className="stack-subhead">Completed reconciliations</h3>
          {list
            .filter((row) => row.status === "completed")
            .map((recon) => {
              const discrepancies = recon.items.filter((item) => item.discrepancy).length;
              return (
                <article key={recon.id} className="obligation-card">
                  <header>
                    <h3>{RECONCILIATION_TRIGGER_LABEL[recon.trigger]}</h3>
                    <Badge status="Current" />
                  </header>
                  <p className="muted">
                    Signed off by {recon.signedOffByName} ·{" "}
                    {recon.signedOffAt ? formatDateLong(recon.signedOffAt) : ""}
                  </p>
                  <p>
                    {recon.items.length} medication
                    {recon.items.length === 1 ? "" : "s"} · {discrepancies}{" "}
                    discrepanc{discrepancies === 1 ? "y" : "ies"}
                  </p>
                  {recon.signOffNote && (
                    <p className="muted">Note: {recon.signOffNote}</p>
                  )}
                  <ul className="record-list">
                    {recon.items.map((item) => (
                      <li key={item.id} className="record-row">
                        <span>
                          <strong>{item.medicationLabel}</strong> ·{" "}
                          {RECONCILIATION_DECISION_LABEL[item.decision]}
                          {item.discrepancy ? " · Discrepancy" : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="chart-actions">
                    <button className="button" onClick={() => void printPdf(recon, "download")}>
                      <Download size={16} /> Download
                    </button>
                    <button className="button" onClick={() => void printPdf(recon, "print")}>
                      <Printer size={16} /> Print
                    </button>
                  </div>
                  <ComplyrerRecordMark
                    documentId={`reconciliation-${recon.id}`}
                    generatedAt={recon.signedOffAt}
                  />
                </article>
              );
            })}
        </div>
      )}
    </section>
  );
}
