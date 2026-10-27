/**
 * MedicationOrdersPage — the agency-wide medication order worklist + expiring
 * orders report.
 *
 * Two surfaces in one page, across every Individual the viewer may read:
 *  - Draft orders awaiting a nurse / Program Manager review and activation.
 *  - Active orders whose end / review date is approaching or past (the
 *    expiring report), printable with the Complyrer record mark. Opening this
 *    worklist also raises the expiring / expired alert for the nurse and
 *    Program Manager (no cron: the alert fires when a reviewer looks).
 * "Individuals" wording only.
 */
import { useEffect, useMemo, useState } from "react";
import { Download, Printer, TriangleAlert } from "lucide-react";
import { Empty, PageHeading, formatDateLong } from "../../components";
import { useData } from "../../data/DataProvider";
import { canViewMedicationOrders } from "../../data/permissions";
import { openPrintable } from "../../data/openFile";
import {
  buildMedicationOrdersReportPdf,
  medicationOrdersReportFileName,
} from "../../pdf/medicationOrdersReportPdf";
import type { MedicationOrderExpiry, MedicationOrderView } from "../../data/types";

const EXPIRY_LABEL: Record<MedicationOrderExpiry, string> = {
  expired: "Past review date",
  expiring: "Review due soon",
  ok: "On schedule",
};

function reviewPhrase(order: MedicationOrderView) {
  if (order.daysUntilReview === null) return "Open-ended";
  const days = order.daysUntilReview;
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} past review`;
  if (days === 0) return "Review due today";
  return `${days} day${days === 1 ? "" : "s"} until review`;
}

export default function MedicationOrdersPage({
  onOpenPerson,
}: {
  onOpenPerson: (name: string) => void;
}) {
  const { api, session, workspace } = useData();
  const [orders, setOrders] = useState<MedicationOrderView[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    setOrders(null);
    setError("");
    api
      .listMedicationOrderWorklist()
      .then((rows) => live && setOrders(rows))
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [api]);

  const drafts = useMemo(
    () => (orders ?? []).filter((order) => order.status === "draft"),
    [orders],
  );
  const expiring = useMemo(
    () =>
      (orders ?? []).filter(
        (order) => order.status === "active" && order.expiry !== "ok",
      ),
    [orders],
  );

  if (!session || !canViewMedicationOrders(session.roleKey)) {
    return (
      <Empty
        title="Medication orders"
        text="You don't have access to medication orders."
      />
    );
  }

  async function printReport(mode: "download" | "print") {
    const generatedAt = new Date().toISOString();
    const doc = buildMedicationOrdersReportPdf({
      agencyName: session.agencyName,
      orders: expiring,
      generatedByName: session.fullName,
      generatedAt,
      logoDataUrl: workspace?.branding.logoUrl ?? null,
    });
    await openPrintable(
      medicationOrdersReportFileName(generatedAt),
      doc.output("blob") as Blob,
      mode,
    );
  }

  return (
    <div>
      <PageHeading
        title="Medication orders"
        description="Draft orders awaiting activation and active orders due for prescriber review."
      />
      {error && <p className="form-error">{error}</p>}

      <section aria-labelledby="orders-expiring-heading" style={{ marginBottom: 24 }}>
        <div className="chart-widget-head">
          <h2 id="orders-expiring-heading">
            <TriangleAlert size={18} aria-hidden="true" /> Due for review (
            {expiring.length})
          </h2>
          {expiring.length > 0 && (
            <div className="chart-actions">
              <button className="button" onClick={() => void printReport("download")}>
                <Download size={16} /> Download report
              </button>
              <button className="button" onClick={() => void printReport("print")}>
                <Printer size={16} /> Print report
              </button>
            </div>
          )}
        </div>
        {orders && expiring.length === 0 && (
          <Empty
            mark="check"
            title="No orders due for review"
            text="No active orders are approaching or past their end / review date."
          />
        )}
        {expiring.map((order) => (
          <article key={order.id} className="obligation-card med-card">
            <header>
              <span className="kind-pill scheduled">{EXPIRY_LABEL[order.expiry]}</span>
              <h3>
                {order.medicationName} {order.dose}
              </h3>
            </header>
            <p>
              <button className="table-title" onClick={() => onOpenPerson(order.individualName)}>
                {order.individualName}
              </button>
              {order.siteName ? ` · ${order.siteName}` : ""} · {reviewPhrase(order)}
            </p>
            <p className="muted">
              Prescriber {order.prescriberName}
              {order.endReviewDate
                ? ` · Review ${formatDateLong(order.endReviewDate)}`
                : ""}
            </p>
          </article>
        ))}
      </section>

      <section aria-labelledby="orders-drafts-heading">
        <div className="chart-widget-head">
          <h2 id="orders-drafts-heading">Draft orders awaiting activation ({drafts.length})</h2>
        </div>
        {orders && drafts.length === 0 && (
          <Empty
            mark="none"
            title="No draft orders"
            text="Every medication order has been activated or discontinued."
          />
        )}
        {drafts.map((order) => (
          <article key={order.id} className="obligation-card med-card">
            <header>
              <span className={`kind-pill ${order.isPrn ? "prn" : "scheduled"}`}>
                {order.isPrn ? "PRN" : "Scheduled"}
              </span>
              <h3>
                {order.medicationName} {order.dose}
              </h3>
            </header>
            <p>
              <button className="table-title" onClick={() => onOpenPerson(order.individualName)}>
                {order.individualName}
              </button>
              {order.siteName ? ` · ${order.siteName}` : ""} · {order.route}
            </p>
            <p className="muted">
              Prescriber {order.prescriberName} · Reason: {order.reason}
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
