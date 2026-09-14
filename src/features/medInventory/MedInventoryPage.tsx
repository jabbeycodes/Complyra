import { useEffect, useMemo, useState } from "react";
import { BellRing, TriangleAlert } from "lucide-react";
import { Empty, PageHeading } from "../../components";
import StatusBadge from "../../components/StatusBadge";
import { medSupplyStatus } from "../../data/complianceStatus";
import { useData } from "../../data/DataProvider";
import { canRecordDelivery, canSeeMeds } from "../../data/chart";
import { inventoryCountdownLabel } from "../../data/medInventory";
import type { MedSupplyStatus } from "../../data/types";
import MedInventoryCard from "./MedInventoryCard";

export default function MedInventoryPage() {
  const { api, session, workspace, refresh } = useData();
  const [siteId, setSiteId] = useState("");
  const [status, setStatus] = useState<MedSupplyStatus | null>(null);
  const [error, setError] = useState("");

  const sites = workspace?.sites ?? [];
  const activeSiteId = siteId || sites[0]?.id || "";
  const people = useMemo(
    () =>
      (workspace?.individuals ?? []).filter(
        (person) => person.site === sites.find((site) => site.id === activeSiteId)?.name,
      ),
    [workspace, sites, activeSiteId],
  );
  const nameById = useMemo(
    () => Object.fromEntries((workspace?.individuals ?? []).map((p) => [p.id, p.name])),
    [workspace],
  );

  useEffect(() => {
    if (!activeSiteId) return;
    let live = true;
    setStatus(null);
    setError("");
    api
      .getMedicationSupplyStatus(activeSiteId)
      .then((result) => {
        if (live) setStatus(result);
      })
      .catch((err) => {
        if (live) setError((err as Error).message);
      });
    return () => {
      live = false;
    };
  }, [api, activeSiteId, workspace]);

  if (!session || !canSeeMeds(session.roleKey)) {
    return (
      <Empty
        title="Medication supply forecast"
        text="You don't have access to medication records."
      />
    );
  }
  const canManage = canRecordDelivery(session.roleKey);

  async function acknowledge(medicationId: string) {
    setError("");
    try {
      await api.acknowledgeReorderAlert(medicationId);
      await refresh();
      if (activeSiteId) setStatus(await api.getMedicationSupplyStatus(activeSiteId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div data-tour="med-inventory">
      <PageHeading
        title="Supply forecast"
        description="Projected pills on hand — not a medication administration record."
      />
      {error && <p className="form-error">{error}</p>}
      <p style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Home{" "}
          <select value={activeSiteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
      </p>

      {status && !status.allClear && (
        <section
          role="alert"
          aria-label="Medications needing reorder"
          className="panel"
          style={{ borderLeft: "4px solid #b3261e", marginBottom: 16 }}
        >
          <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <TriangleAlert size={18} color="#b3261e" /> Reorder needed — {status.alerts.length}{" "}
            medication{status.alerts.length === 1 ? "" : "s"}
          </h2>
          <p className="stack-help">{status.summary}</p>
          <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
            {status.alerts.map((alert) => (
              <li
                key={alert.medicationId}
                style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
              >
                <StatusBadge
                  status={medSupplyStatus(alert.daysRemaining)}
                  size="sm"
                />
                <span>
                  <strong>{nameById[alert.individualId] ?? "Unknown"}</strong> —{" "}
                  {alert.medicationName} ({alert.strength}): {inventoryCountdownLabel(alert)}
                </span>
                {alert.alertActive && canManage && (
                  <button className="button" onClick={() => acknowledge(alert.medicationId)}>
                    <BellRing size={14} /> Acknowledge
                  </button>
                )}
                {alert.alertActive && !canManage && <small>Awaiting HM reorder</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {status?.allClear && (
        <p className="stack-help" style={{ marginBottom: 16 }}>
          {status.summary}
        </p>
      )}

      {people.length === 0 && (
        <Empty title="No individuals" text="No individuals are assigned to this home." />
      )}
      {people.map((person) => (
        <section key={person.id} aria-label={person.name} style={{ marginBottom: 24 }}>
          <h2 style={{ fontSize: "1.05rem", marginBottom: 8 }}>{person.name}</h2>
          <MedInventoryCard individualId={person.id} />
        </section>
      ))}
    </div>
  );
}
