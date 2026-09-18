import { useEffect, useState } from "react";
import { BellRing, History, Pill, Settings2, TriangleAlert } from "lucide-react";
import { Empty, formatDate } from "../../components";
import StatusBadge from "../../components/StatusBadge";
import { medSupplyStatusFromInventory } from "../../data/complianceStatus";
import { useData } from "../../data/DataProvider";
import { canLogDoseException, canRecordDelivery } from "../../data/chart";
import {
  doseExceptionKindLabel,
  inventoryCountdownLabel,
  medSupplyStatusDescription,
  medSupplyStatusLabel,
} from "../../data/medInventory";
import type {
  DoseExceptionKind,
  MedInventoryStatus,
  MedInventoryView,
} from "../../data/types";

const EXCEPTION_KINDS: DoseExceptionKind[] = ["refused", "held", "wasted"];

function statusTone(status: MedInventoryStatus) {
  if (status === "out" || status === "critical") return "#b3261e";
  if (status === "low") return "#9a6b00";
  return "#2f6b3a";
}

export default function MedInventoryCard({ individualId }: { individualId: string }) {
  const { api, session, workspace, refresh } = useData();
  const [views, setViews] = useState<MedInventoryView[] | null>(null);
  const [error, setError] = useState("");
  const [openMed, setOpenMed] = useState<string | null>(null);
  const [thresholdDrafts, setThresholdDrafts] = useState<Record<string, string>>({});
  const [adjustDrafts, setAdjustDrafts] = useState<
    Record<string, { delta: string; reason: string }>
  >({});
  const [exceptionMed, setExceptionMed] = useState<string | null>(null);
  const [exceptionDraft, setExceptionDraft] = useState<{
    kind: DoseExceptionKind;
    pills: string;
    reason: string;
    occurredOn: string;
  }>({ kind: "refused", pills: "", reason: "", occurredOn: new Date().toISOString().slice(0, 10) });

  useEffect(() => {
    let live = true;
    setViews(null);
    api
      .getMedInventory(individualId)
      .then((rows) => {
        if (live) setViews(rows);
      })
      .catch((err) => {
        if (live) setError((err as Error).message);
      });
    return () => {
      live = false;
    };
  }, [api, individualId, workspace]);

  if (!session) return null;
  const canManage = canRecordDelivery(session.roleKey);
  const canLogException = canLogDoseException(session.roleKey);

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
      setViews(await api.getMedInventory(individualId));
      return true;
    } catch (err) {
      setError((err as Error).message);
      return false;
    }
  }

  return (
    <section className="chart-widget" aria-labelledby="med-inventory-heading">
      <h2 id="med-inventory-heading">Medication supply forecast</h2>
      <p className="stack-help">
        A projection of pills on hand — <strong>not a medication administration record</strong>.
        Scheduled meds drop by pills-per-day each calendar day from the delivery-day count; logged
        PRN doses and refused / held / wasted dose exceptions decrement too. No manual recounts
        needed.
      </p>
      {error && <p className="form-error">{error}</p>}
      {views === null && <p>Loading forecast…</p>}
      {views !== null && views.length === 0 && (
        <Empty title="No medications" text="No medications are on this chart yet." />
      )}
      {views?.map((view) => {
        const depletion =
          view.quantityOnDelivery > 0
            ? Math.max(0, Math.min(100, (view.currentCount / view.quantityOnDelivery) * 100))
            : 0;
        const expanded = openMed === view.medicationId;
        return (
          <article key={view.medicationId} className="obligation-card med-card">
            <header>
              <span className={`kind-pill ${view.kind}`}>{view.kind}</span>
              <h3>{view.medicationName}</h3>
              {/* WS3 (accessible status system): shared badge — the band is the
                  stored inventory band (medSupplyStatusFromInventory); the
                  label/description are supply-specific so a stocked PRN never
                  reads "Expired". */}
              <StatusBadge
                status={medSupplyStatusFromInventory(view.status)}
                label={medSupplyStatusLabel(view.status)}
                description={medSupplyStatusDescription(view.status, view.reorderPointPills)}
              />
            </header>
            <p>
              {view.strength} · {inventoryCountdownLabel(view)}
              {view.deliveredOn ? ` · Counted ${formatDate(view.deliveredOn)}` : ""}
              {view.kind === "prn" && view.prnDosesSinceDelivery > 0
                ? ` · ${view.prnDosesSinceDelivery} PRN dose${view.prnDosesSinceDelivery === 1 ? "" : "s"} since`
                : ""}
              {view.doseExceptions.length > 0
                ? ` · ${view.doseExceptions.length} dose exception${view.doseExceptions.length === 1 ? "" : "s"} logged`
                : ""}
            </p>
            <div
              role="progressbar"
              aria-label={`${view.medicationName} supply: ${medSupplyStatusLabel(view.status)}`}
              aria-valuenow={Math.round(depletion)}
              aria-valuemin={0}
              aria-valuemax={100}
              style={{
                height: 8,
                borderRadius: 999,
                background: "#e9e2d8",
                overflow: "hidden",
                margin: "8px 0 4px",
              }}
            >
              <div
                style={{
                  width: `${depletion}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: statusTone(view.status),
                  transition: "width 300ms ease",
                }}
              />
            </div>
            <p className="stack-help" style={{ marginTop: 2 }}>
              {medSupplyStatusLabel(view.status)}
              {view.status !== "ok" && view.status !== "out"
                ? ` — reorder at ${view.reorderPointPills} pills (${view.lowThresholdDays}-day threshold)`
                : view.status === "out"
                  ? " — reorder immediately"
                  : ` — reorder at ${view.reorderPointPills} pills`}
              {view.alertActive && view.reorderAcknowledgedOn
                ? ` · acknowledged ${formatDate(view.reorderAcknowledgedOn)}, still low`
                : ""}
            </p>
            {view.alertActive && canManage && (
              <p>
                <button
                  className="button primary"
                  onClick={() => run(() => api.acknowledgeReorderAlert(view.medicationId))}
                >
                  <BellRing size={15} /> Acknowledge reorder
                </button>
              </p>
            )}
            <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="button"
                onClick={() => setOpenMed(expanded ? null : view.medicationId)}
                aria-expanded={expanded}
              >
                <Settings2 size={15} /> Threshold & correction
              </button>
              {canLogException && (
                <button
                  className="button"
                  onClick={() => {
                    setExceptionMed(
                      exceptionMed === view.medicationId ? null : view.medicationId,
                    );
                    setExceptionDraft({
                      kind: "refused",
                      pills: "",
                      reason: "",
                      occurredOn: new Date().toISOString().slice(0, 10),
                    });
                  }}
                >
                  <TriangleAlert size={15} /> Log dose exception
                </button>
              )}
              <button
                className="button"
                onClick={() =>
                  setOpenMed(openMed === `history-${view.medicationId}` ? null : `history-${view.medicationId}`)
                }
              >
                <History size={15} /> Supply history
              </button>
            </p>
            {exceptionMed === view.medicationId && canLogException && (
              <form
                className="renewal-upload"
                style={{ marginTop: 8 }}
                onSubmit={(e) => {
                  e.preventDefault();
                  run(() =>
                    api.addMedDoseException({
                      medicationId: view.medicationId,
                      kind: exceptionDraft.kind,
                      pillsAffected: Number(exceptionDraft.pills),
                      reason: exceptionDraft.reason,
                      occurredOn: exceptionDraft.occurredOn,
                    }),
                  ).then((ok) => {
                    if (ok) setExceptionMed(null);
                  });
                }}
              >
                <p className="stack-help" style={{ margin: 0 }}>
                  Refused, held, or wasted doses subtract pills from the forecast. This is
                  recorded permanently — corrections are logged as new rows, never edits.
                </p>
                <label>
                  What happened
                  <select
                    value={exceptionDraft.kind}
                    onChange={(e) =>
                      setExceptionDraft((prev) => ({
                        ...prev,
                        kind: e.target.value as DoseExceptionKind,
                      }))
                    }
                  >
                    {EXCEPTION_KINDS.map((kind) => (
                      <option key={kind} value={kind}>
                        {doseExceptionKindLabel(kind)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Pills affected
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={exceptionDraft.pills}
                    onChange={(e) =>
                      setExceptionDraft((prev) => ({ ...prev, pills: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Date
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    value={exceptionDraft.occurredOn}
                    onChange={(e) =>
                      setExceptionDraft((prev) => ({ ...prev, occurredOn: e.target.value }))
                    }
                  />
                </label>
                <label>
                  Reason (goes in the audit trail)
                  <input
                    type="text"
                    required
                    placeholder="e.g. individual refused the evening dose"
                    value={exceptionDraft.reason}
                    onChange={(e) =>
                      setExceptionDraft((prev) => ({ ...prev, reason: e.target.value }))
                    }
                  />
                </label>
                <button className="button primary" type="submit">
                  Log exception
                </button>
              </form>
            )}
            {expanded && canManage && (
              <div style={{ display: "grid", gap: 12, marginTop: 4 }}>
                <form
                  className="renewal-upload"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const draft = thresholdDrafts[view.medicationId] ?? String(view.lowThresholdDays);
                    run(() =>
                      api.setReorderThreshold({
                        medicationId: view.medicationId,
                        lowThresholdDays: Number(draft),
                      }),
                    );
                  }}
                >
                  <label>
                    Reorder when days left reach
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={thresholdDrafts[view.medicationId] ?? String(view.lowThresholdDays)}
                      onChange={(e) =>
                        setThresholdDrafts((prev) => ({
                          ...prev,
                          [view.medicationId]: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <button className="button primary" type="submit">
                    Save threshold
                  </button>
                </form>
                <form
                  className="renewal-upload"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const draft = adjustDrafts[view.medicationId] ?? { delta: "", reason: "" };
                    run(() =>
                      api.adjustMedInventory({
                        medicationId: view.medicationId,
                        quantityDelta: Number(draft.delta),
                        reason: draft.reason,
                      }),
                    ).then((ok) => {
                      if (ok) {
                        setAdjustDrafts((prev) => ({
                          ...prev,
                          [view.medicationId]: { delta: "", reason: "" },
                        }));
                      }
                    });
                  }}
                >
                  <label>
                    Correct count by (± pills)
                    <input
                      type="number"
                      step="1"
                      placeholder="+5 or -3"
                      value={adjustDrafts[view.medicationId]?.delta ?? ""}
                      onChange={(e) =>
                        setAdjustDrafts((prev) => ({
                          ...prev,
                          [view.medicationId]: {
                            delta: e.target.value,
                            reason: prev[view.medicationId]?.reason ?? "",
                          },
                        }))
                      }
                    />
                  </label>
                  <label>
                    Reason (goes in the audit trail)
                    <input
                      type="text"
                      placeholder="e.g. spilled bottle, recount found 4 extra"
                      value={adjustDrafts[view.medicationId]?.reason ?? ""}
                      onChange={(e) =>
                        setAdjustDrafts((prev) => ({
                          ...prev,
                          [view.medicationId]: {
                            delta: prev[view.medicationId]?.delta ?? "",
                            reason: e.target.value,
                          },
                        }))
                      }
                    />
                  </label>
                  <button className="button primary" type="submit">
                    <Pill size={15} /> Apply correction
                  </button>
                </form>
              </div>
            )}
            {openMed === `history-${view.medicationId}` && (
              <ul className="person-renewals" style={{ marginTop: 8 }}>
                {view.deliveries.length === 0 && view.doseExceptions.length === 0 && (
                  <li>No delivery counts recorded yet.</li>
                )}
                {[...view.doseExceptions]
                  .sort((a, b) => (a.occurredOn < b.occurredOn ? 1 : -1))
                  .map((exception) => (
                    <li key={exception.id}>
                      <span>
                        <strong>{formatDate(exception.occurredOn)}</strong> —{" "}
                        {doseExceptionKindLabel(exception.kind)}: {exception.pillsAffected} pill
                        {exception.pillsAffected === 1 ? "" : "s"} · {exception.reason}
                      </span>
                    </li>
                  ))}
                {view.deliveries.map((delivery) => (
                  <li key={delivery.id}>
                    <span>
                      <strong>{formatDate(delivery.countedOn)}</strong> — {delivery.remainingPills}{" "}
                      pills counted
                      {view.kind === "scheduled" ? ` · ${delivery.pillsPerDay}/day` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        );
      })}
    </section>
  );
}
