/**
 * Issue #100 — MAR home for the Individual chart's Medications tab:
 * medication profile header, medication list, monthly administration grid,
 * and pill-count countdown. Everything here is read-only for auditors.
 */
import { useCallback, useEffect, useState } from "react";
import { useData } from "../../data/DataProvider";
import type { MedInventoryView } from "../../data/types";
import type { IndividualProfile } from "../../data/planStack";
import type { MarAdministration, MarConcern, MarPrnLog, MedicationMarView } from "../../data/mar";
import { monthKeyFor } from "../../data/mar";
import "./mar.css";
import MedProfileHeader from "./MedProfileHeader";
import MedicationList from "./MedicationList";
import MarMonthlyGrid from "./MarMonthlyGrid";
import PillCountSection from "./PillCountSection";

export default function MarHome({
  individualId,
  individualName,
  profile,
}: {
  individualId: string;
  individualName: string;
  profile: IndividualProfile | null;
}) {
  const { api, workspace } = useData();
  const [monthKey, setMonthKey] = useState(monthKeyFor());
  const [meds, setMeds] = useState<MedicationMarView[]>([]);
  const [administrations, setAdministrations] = useState<MarAdministration[]>([]);
  const [prnLogs, setPrnLogs] = useState<MarPrnLog[]>([]);
  const [concerns, setConcerns] = useState<MarConcern[]>([]);
  const [inventoryViews, setInventoryViews] = useState<MedInventoryView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");
    try {
      const [month, inventory] = await Promise.all([
        api.getMarMonth(individualId, monthKey),
        api.getMedInventory(individualId),
      ]);
      setMeds(month.meds);
      setAdministrations(month.administrations);
      setPrnLogs(month.prnLogs);
      setConcerns(month.concerns);
      setInventoryViews(inventory);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, individualId, monthKey]);

  useEffect(() => {
    void load();
    // `workspace` is an intentional dep: inventory corrections and med
    // deliveries go through DataProvider.refresh(), which swaps the workspace
    // object — that refreshes this sibling view too, so the pill-count
    // countdown never goes stale while the inventory card next to it updates.
  }, [load, workspace]);

  return (
    <div className="mar-home">
      {loading && <p className="mar-help">Loading medication records…</p>}
      {error && <p className="mar-error">{error}</p>}
      {!loading && (
        <>
          {profile && <MedProfileHeader profile={profile} meds={meds} weightKg="" />}
          <MedicationList individualId={individualId} meds={meds} onChanged={load} />
          <MarMonthlyGrid
            individualId={individualId}
            individualName={individualName}
            meds={meds}
            administrations={administrations}
            prnLogs={prnLogs}
            concerns={concerns}
            onChanged={load}
            monthKey={monthKey}
            onMonthKeyChange={setMonthKey}
          />
          <PillCountSection views={inventoryViews} />
        </>
      )}
    </div>
  );
}
