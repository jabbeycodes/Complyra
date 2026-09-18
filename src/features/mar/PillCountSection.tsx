/**
 * Issue #100 — pill-count countdown section: one card per medication showing
 * pills remaining, projected days remaining, and the deterministic stock
 * status. The views come from getMedInventory, whose deterministic
 * projection credits refused, omitted, and held MAR doses back into stock.
 */
import type { MedInventoryView } from "../../data/types";

function badgeClass(view: MedInventoryView): string {
  if (view.status === "out") return "out";
  if (view.status === "critical") return "critical";
  if (view.status === "low") return "low";
  return "ok";
}

function badgeLabel(view: MedInventoryView): string {
  if (view.status === "out") return "Out of stock";
  if (view.daysRemaining == null) return "PRN — no countdown";
  return `${view.daysRemaining} day${view.daysRemaining === 1 ? "" : "s"} left`;
}

export default function PillCountSection({ views }: { views: MedInventoryView[] }) {
  return (
    <section className="mar-block" aria-label="Pill count countdown">
      <h3>Pill count countdown</h3>
      {views.length === 0 && <p className="mar-help">No medications on this chart yet.</p>}
      {views.map((view) => (
        <article key={view.medicationId} className="mar-count-card">
          <header>
            <h4>
              {view.medicationName} {view.strength}
            </h4>
            <span className={`mar-badge ${badgeClass(view)}`}>{badgeLabel(view)}</span>
          </header>
          <p className="mar-help" style={{ margin: 0 }}>
            {view.currentCount} pill{view.currentCount === 1 ? "" : "s"} remaining
            {view.dosesPerDay > 0 ? ` · ${view.dosesPerDay} per day` : ""}
            {view.deliveredOn ? ` · counted ${view.deliveredOn.slice(0, 10)}` : ""}
          </p>
        </article>
      ))}
    </section>
  );
}
