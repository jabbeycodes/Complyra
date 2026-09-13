import { useEffect, useState } from "react";
import { BellRing, History, Pill, Settings2 } from "lucide-react";
import { Badge, Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { canRecordDelivery } from "../../data/chart";
import { inventoryCountdownLabel } from "../../data/medInventory";
import type { MedInventoryStatus, MedInventoryView } from "../../data/types";

const STATUS_BADGE: Record<MedInventoryStatus, string> = {
  ok: "Active",
  low: "Due soon",
  critical: "Overdue",
  out: "Expired",
};

const STATUS_LABEL: Record<MedInventoryStatus, string> = {
  ok: "Stocked",
  low: "Reorder soon",
  critical: "Reorder now",
  out: "Out of stock",
};

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
      <h2 id="med-inventory-heading">Medication inventory</h2>
      <p className="stack-help">
        Countdown from the delivery-day count: scheduled meds drop by pills-per-day
        each calendar day, logged PRN doses decrement too. No manual recounts needed.
      </p>
      {error && <p className="form-error">{error}</p>}
      {views === null && <p>Loading inventory…</p>}
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
              <Badge status={STATUS_BADGE[view.status]} />
            </header>
            <p>
              {view.strength} · {inventoryCountdownLabel(view)}
              {view.deliveredOn ? ` · Counted ${formatDate(view.deliveredOn)}` : ""}
              {view.kind === "prn" && view.prnDosesSinceDelivery > 0
                ? ` · ${view.prnDosesSinceDelivery} PRN dose${view.prnDosesSinceDelivery === 1 ? "" : "s"} since`
                : ""}
            </p>
            <div
              role="progressbar"
              aria-label={`${view.medicationName} supply: ${STATUS_LABEL[view.status]}`}
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
              {STATUS_LABEL[view.status]}
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
              <button
                className="button"
                onClick={() =>
                  setOpenMed(openMed === `history-${view.medicationId}` ? null : `history-${view.medicationId}`)
                }
              >
                <History size={15} /> Delivery history
              </button>
            </p>
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
                {view.deliveries.length === 0 && <li>No delivery counts recorded yet.</li>}
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
