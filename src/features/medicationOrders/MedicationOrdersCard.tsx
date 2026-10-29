/**
 * MedicationOrdersCard — the prescriber-order surface on the Individual chart.
 *
 * Shows every medication order for one Individual (draft → active →
 * discontinued), lets a nurse / Program Manager draft, edit, activate, and
 * discontinue orders, and is the source of truth the MAR medication list is
 * fed from: activating an order projects it onto the MAR; discontinuing one
 * takes it back off. Draft orders are editable; active and discontinued orders
 * are frozen (discontinue + reorder to change an active one). "Individuals"
 * wording only.
 */
import { useEffect, useState, type FormEvent } from "react";
import { Pill, PlusCircle } from "lucide-react";
import { Badge, Empty, formatDateLong } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  canManageMedicationOrders,
  canViewMedicationOrders,
} from "../../data/permissions";
import { orderExpiry } from "../../data/medicationOrders";
import type {
  CreateMedicationOrderInput,
  MedicationOrder,
  MedicationOrderExpiry,
} from "../../data/types";

const STATUS_LABEL: Record<MedicationOrder["status"], string> = {
  draft: "Draft",
  active: "Active",
  discontinued: "Discontinued",
};

const STATUS_BADGE: Record<MedicationOrder["status"], string> = {
  draft: "Pending review",
  active: "Current",
  discontinued: "Off",
};

const EXPIRY_LABEL: Record<Exclude<MedicationOrderExpiry, "ok">, string> = {
  expiring: "Review due soon",
  expired: "Past review date",
};

interface DraftForm {
  medicationName: string;
  dose: string;
  route: string;
  schedule: string;
  scheduleTimes: string;
  isPrn: boolean;
  startDate: string;
  endReviewDate: string;
  prescriberName: string;
  reason: string;
}

const EMPTY_FORM: DraftForm = {
  medicationName: "",
  dose: "",
  route: "By mouth",
  schedule: "",
  scheduleTimes: "",
  isPrn: false,
  startDate: "",
  endReviewDate: "",
  prescriberName: "",
  reason: "",
};

function formToInput(
  individualId: string,
  form: DraftForm,
): CreateMedicationOrderInput {
  return {
    individualId,
    medicationName: form.medicationName,
    dose: form.dose,
    route: form.route,
    schedule: form.schedule,
    scheduleTimes: form.scheduleTimes
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    isPrn: form.isPrn,
    startDate: form.startDate || undefined,
    endReviewDate: form.endReviewDate || null,
    prescriberName: form.prescriberName,
    reason: form.reason,
  };
}

export default function MedicationOrdersCard({
  individualId,
}: {
  individualId: string;
}) {
  const { api, session, refresh } = useData();
  const [orders, setOrders] = useState<MedicationOrder[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [discontinueId, setDiscontinueId] = useState<string | null>(null);
  const [discontinueReason, setDiscontinueReason] = useState("");

  async function reload() {
    setOrders(await api.listMedicationOrders(individualId));
  }

  useEffect(() => {
    let live = true;
    setOrders(null);
    setError("");
    api
      .listMedicationOrders(individualId)
      .then((rows) => live && setOrders(rows))
      .catch((err) => live && setError((err as Error).message));
    return () => {
      live = false;
    };
  }, [api, individualId]);

  if (!session || !canViewMedicationOrders(session.roleKey)) return null;
  const canManage = canManageMedicationOrders(session.roleKey);

  function openCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function openEdit(order: MedicationOrder) {
    setEditingId(order.id);
    setForm({
      medicationName: order.medicationName,
      dose: order.dose,
      route: order.route,
      schedule: order.schedule,
      scheduleTimes: order.scheduleTimes.join(", "),
      isPrn: order.isPrn,
      startDate: order.startDate.slice(0, 10),
      endReviewDate: order.endReviewDate ? order.endReviewDate.slice(0, 10) : "",
      prescriberName: order.prescriberName,
      reason: order.reason,
    });
    setShowForm(true);
  }

  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
      await reload();
      // MAR medication list is fed from active orders — refresh the workspace
      // so the chart's medication board reflects activation / discontinuation.
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function submitForm(event: FormEvent) {
    event.preventDefault();
    const input = formToInput(individualId, form);
    await run(async () => {
      if (editingId) {
        await api.updateMedicationOrder(editingId, input);
      } else {
        await api.createMedicationOrder(input);
      }
      setShowForm(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
    });
  }

  async function discontinue(order: MedicationOrder) {
    await run(async () => {
      await api.discontinueMedicationOrder(order.id, discontinueReason);
      setDiscontinueId(null);
      setDiscontinueReason("");
    });
  }

  return (
    <section className="chart-widget" aria-labelledby="med-orders-heading">
      <div className="chart-widget-head">
        <h2 id="med-orders-heading">
          <Pill size={16} aria-hidden="true" /> Medication orders
        </h2>
        {canManage && !showForm && (
          <button className="button" onClick={openCreate}>
            <PlusCircle size={16} /> New order
          </button>
        )}
      </div>
      <p className="stack-help">
        Prescriber orders drive the medication administration record. Activating
        an order adds it to the MAR; discontinuing one takes it off.
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {canManage && showForm && (
        <form className="renewal-upload" onSubmit={submitForm}>
          <label>
            Medication name
            <input
              value={form.medicationName}
              onChange={(e) => setForm({ ...form, medicationName: e.target.value })}
              required
            />
          </label>
          <label>
            Dose
            <input
              value={form.dose}
              onChange={(e) => setForm({ ...form, dose: e.target.value })}
              placeholder="e.g. 10 mg"
              required
            />
          </label>
          <label>
            Route
            <input
              value={form.route}
              onChange={(e) => setForm({ ...form, route: e.target.value })}
              placeholder="By mouth"
              required
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isPrn}
              onChange={(e) => setForm({ ...form, isPrn: e.target.checked })}
            />
            PRN (as needed — no scheduled dose times)
          </label>
          <label>
            Schedule
            <input
              value={form.schedule}
              onChange={(e) => setForm({ ...form, schedule: e.target.value })}
              placeholder="e.g. Twice daily"
            />
          </label>
          {!form.isPrn && (
            <label>
              Dose times (24-hour, comma separated)
              <input
                value={form.scheduleTimes}
                onChange={(e) => setForm({ ...form, scheduleTimes: e.target.value })}
                placeholder="08:00, 20:00"
              />
            </label>
          )}
          <label>
            Start date
            <input
              type="date"
              value={form.startDate}
              onChange={(e) => setForm({ ...form, startDate: e.target.value })}
            />
          </label>
          <label>
            End / review date
            <input
              type="date"
              value={form.endReviewDate}
              onChange={(e) => setForm({ ...form, endReviewDate: e.target.value })}
            />
          </label>
          <label>
            Prescriber name
            <input
              value={form.prescriberName}
              onChange={(e) => setForm({ ...form, prescriberName: e.target.value })}
              required
            />
          </label>
          <label>
            Reason for the medication
            <input
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              required
            />
          </label>
          <div className="chart-actions">
            <button className="button primary" type="submit" disabled={busy}>
              {editingId ? "Save order" : "Create draft order"}
            </button>
            <button
              className="button"
              type="button"
              onClick={() => {
                setShowForm(false);
                setEditingId(null);
                setForm(EMPTY_FORM);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {orders && orders.length === 0 && !showForm && (
        <Empty
          mark="none"
          title="No medication orders"
          text="No prescriber orders have been entered for this Individual yet."
        />
      )}

      {orders && orders.length > 0 && (
        <div className="stack">
          {orders.map((order) => {
            const expiry = orderExpiry(order);
            return (
              <article key={order.id} className="obligation-card med-card">
                <header>
                  <span className={`kind-pill ${order.isPrn ? "prn" : "scheduled"}`}>
                    {order.isPrn ? "PRN" : "Scheduled"}
                  </span>
                  <h3>
                    {order.medicationName} {order.dose}
                  </h3>
                  <Badge status={STATUS_BADGE[order.status]} />
                </header>
                <p>
                  {STATUS_LABEL[order.status]} · {order.route}
                  {order.schedule ? ` · ${order.schedule}` : ""}
                  {!order.isPrn && order.scheduleTimes.length > 0
                    ? ` · ${order.scheduleTimes.join(", ")}`
                    : ""}
                </p>
                <p className="muted">
                  Prescriber {order.prescriberName} · Started{" "}
                  {formatDateLong(order.startDate)}
                  {order.endReviewDate
                    ? ` · Review ${formatDateLong(order.endReviewDate)}`
                    : " · Open-ended"}
                </p>
                <p className="muted">Reason: {order.reason}</p>
                {order.status === "active" && expiry !== "ok" && (
                  <p className="form-error" role="status">
                    {EXPIRY_LABEL[expiry]} — a prescriber review is needed.
                  </p>
                )}
                {order.status === "discontinued" && order.discontinueReason && (
                  <p className="muted">
                    Discontinued by {order.discontinuedByName}: {order.discontinueReason}
                  </p>
                )}
                {canManage && (
                  <div className="chart-actions">
                    {order.status === "draft" && (
                      <>
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => void run(() => api.activateMedicationOrder(order.id))}
                        >
                          Activate
                        </button>
                        <button
                          className="button"
                          disabled={busy}
                          onClick={() => openEdit(order)}
                        >
                          Edit
                        </button>
                      </>
                    )}
                    {order.status === "active" && discontinueId !== order.id && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          setDiscontinueId(order.id);
                          setDiscontinueReason("");
                        }}
                      >
                        Discontinue
                      </button>
                    )}
                    {order.status === "active" && discontinueId === order.id && (
                      <form
                        className="renewal-upload"
                        onSubmit={(event) => {
                          event.preventDefault();
                          void discontinue(order);
                        }}
                      >
                        <label>
                          Reason for discontinuing
                          <input
                            value={discontinueReason}
                            onChange={(e) => setDiscontinueReason(e.target.value)}
                            required
                          />
                        </label>
                        <div className="chart-actions">
                          <button className="button primary" type="submit" disabled={busy}>
                            Confirm discontinue
                          </button>
                          <button
                            className="button"
                            type="button"
                            onClick={() => {
                              setDiscontinueId(null);
                              setDiscontinueReason("");
                            }}
                          >
                            Cancel
                          </button>
                        </div>
                      </form>
                    )}
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
