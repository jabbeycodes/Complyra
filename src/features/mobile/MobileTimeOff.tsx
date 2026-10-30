import { useCallback, useEffect, useMemo, useState } from "react";
import type { SessionUser } from "../../data/types";
import type { HrStore } from "../../data/hrStore";
import {
  buildRequestDays,
  LEAVE_TYPES,
  leaveTypeDebitsBalance,
  timeOffBalanceView,
  type HrAccrualLedgerEntry,
  type HrAccrualPolicy,
  type HrTimeOffRequest,
  type LeaveType,
} from "../../data/hr";
import { createSupabaseBrowserClient } from "../../data/index";
import { emitHrEvent } from "../notifications/useNotifications";
import {
  timeOffCancelledPayload,
  timeOffRequestedPayload,
  type NotificationPayload,
} from "../notifications/notify";
import {
  LEAVE_TYPE_LABELS,
  TIME_OFF_STATUS_LABELS,
  timeOffBalanceCards,
} from "./hub";
import { centralTodayIso } from "./mar";

/**
 * Mobile Time Off — the Employee Hub tab's self-service slice (PR #133
 * rules): my balances off the accrual ledger, my requests, request
 * time off, and cancel my own request. Everything goes through the
 * same HrStore methods and the same notification payloads the desktop
 * tab emits (existing types only). Approvals, team queues, and balance
 * adjustments stay on the desktop hub — this is the employee's door.
 * Auditors never reach it: the desktop hub excludes them from Time Off
 * entirely, and the mobile hub does the same.
 */
export default function MobileTimeOff({
  store,
  session,
  onBack,
}: {
  store: HrStore;
  session: SessionUser;
  onBack: () => void;
}) {
  const [mine, setMine] = useState<HrTimeOffRequest[]>([]);
  const [policies, setPolicies] = useState<HrAccrualPolicy[]>([]);
  const [ledger, setLedger] = useState<HrAccrualLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [cancelId, setCancelId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const notifyClient = useMemo(() => createSupabaseBrowserClient(), []);
  const notify = (payload: NotificationPayload) => {
    if (notifyClient) void emitHrEvent(notifyClient, payload);
  };

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      store.listTimeOffRequests({ staffId: session.userId }),
      store.listAccrualPolicies().catch(() => [] as HrAccrualPolicy[]),
      store.listLedgerEntries(session.userId).catch(() => [] as HrAccrualLedgerEntry[]),
    ])
      .then(([requests, pols, entries]) => {
        setMine(requests);
        setPolicies(pols);
        setLedger(entries);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load time off.");
        setLoading(false);
      });
  }, [store, session.userId]);

  useEffect(load, [load]);

  const cards = useMemo(
    () => timeOffBalanceCards(policies, ledger, mine, session.userId),
    [policies, ledger, mine, session.userId],
  );

  const cancel = async (request: HrTimeOffRequest) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const updated = await store.cancelTimeOffRequest(request.id, {
        reason: cancelReason,
      });
      for (const roleKey of ["house_manager", "program_manager"]) {
        notify(
          timeOffCancelledPayload({
            agencyId: session.agencyId,
            roleKey,
            requestId: updated.id,
            title: "Time off cancelled",
            body: `${session.fullName} cancelled their ${LEAVE_TYPE_LABELS[updated.kind]} request for ${updated.startsOn} – ${updated.endsOn}.`,
          }),
        );
      }
      setNotice("Request cancelled.");
      setCancelId(null);
      setCancelReason("");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not cancel the request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ My Hub
      </button>
      <h3 className="msh-pass-title">Time off</h3>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {notice && <p className="msh-status-text">{notice}</p>}
      {loading ? (
        <p className="msh-empty">Loading your time off…</p>
      ) : (
        <>
          {cards.length > 0 && (
            <div className="msh-list">
              {cards.map((card) => (
                <div key={card.type} className="msh-row static">
                  <span className="msh-row-main">
                    <strong>{LEAVE_TYPE_LABELS[card.type]}</strong>
                    <small className="msh-status-text">
                      Balance {card.view.balance}h · Available{" "}
                      {card.view.availableHours}h
                      {card.view.pendingHours > 0
                        ? ` · ${card.view.pendingHours}h pending`
                        : ""}
                      {" · "}
                      {card.used}h used
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}

          {!formOpen ? (
            <button
              type="button"
              className="msh-button primary block"
              onClick={() => setFormOpen(true)}
            >
              Request time off
            </button>
          ) : (
            <RequestForm
              store={store}
              session={session}
              ledger={ledger}
              mine={mine}
              onClose={() => setFormOpen(false)}
              onSubmitted={(created) => {
                for (const roleKey of ["house_manager", "program_manager"]) {
                  notify(
                    timeOffRequestedPayload({
                      agencyId: session.agencyId,
                      roleKey,
                      requestId: created.id,
                      title: "Time off requested",
                      body: `${session.fullName} requested ${LEAVE_TYPE_LABELS[created.kind]} from ${created.startsOn} to ${created.endsOn} (${created.totalHours}h).`,
                    }),
                  );
                }
                setFormOpen(false);
                setNotice("Request submitted — your manager has been notified.");
                load();
              }}
              onError={setError}
            />
          )}

          <h3 className="msh-pass-title">My requests</h3>
          {mine.length === 0 && (
            <p className="msh-empty">No time-off requests yet.</p>
          )}
          <div className="msh-list">
            {mine.map((request) => (
              <div key={request.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>
                    {LEAVE_TYPE_LABELS[request.kind]} · {request.totalHours}h
                  </strong>
                  <small className="msh-status-text">
                    {TIME_OFF_STATUS_LABELS[request.status]} · {request.startsOn} –{" "}
                    {request.endsOn}
                  </small>
                  {request.reason && <small>Reason: {request.reason}</small>}
                  {request.decisionNote && (
                    <small>Manager note: {request.decisionNote}</small>
                  )}
                  {(request.status === "pending" || request.status === "approved") &&
                    (cancelId === request.id ? (
                      <>
                        <label className="msh-field">
                          <span>Reason for cancelling</span>
                          <input
                            type="text"
                            value={cancelReason}
                            onChange={(event) => setCancelReason(event.target.value)}
                          />
                        </label>
                        <span className="msh-row-actions">
                          <button
                            type="button"
                            className="msh-chip-button"
                            disabled={busy}
                            onClick={() => void cancel(request)}
                          >
                            Confirm cancel
                          </button>
                          <button
                            type="button"
                            className="msh-chip-button"
                            onClick={() => setCancelId(null)}
                          >
                            Keep request
                          </button>
                        </span>
                      </>
                    ) : (
                      <span className="msh-row-actions">
                        <button
                          type="button"
                          className="msh-chip-button"
                          onClick={() => {
                            setCancelId(request.id);
                            setCancelReason("");
                          }}
                        >
                          Cancel request
                        </button>
                      </span>
                    ))}
                </span>
              </div>
            ))}
          </div>
          <p className="msh-section-note">
            Approvals happen in the desktop Employee Hub.
          </p>
        </>
      )}
    </div>
  );
}

function RequestForm({
  store,
  session,
  ledger,
  mine,
  onClose,
  onSubmitted,
  onError,
}: {
  store: HrStore;
  session: SessionUser;
  ledger: HrAccrualLedgerEntry[];
  mine: HrTimeOffRequest[];
  onClose: () => void;
  onSubmitted: (created: HrTimeOffRequest) => void;
  onError: (message: string) => void;
}) {
  const todayStamp = centralTodayIso();
  const [kind, setKind] = useState<LeaveType>("pto");
  const [startsOn, setStartsOn] = useState(todayStamp);
  const [endsOn, setEndsOn] = useState(todayStamp);
  const [dayHours, setDayHours] = useState<Record<string, number>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const datesValid = startsOn !== "" && endsOn !== "" && endsOn >= startsOn;
  const formDays = datesValid ? buildRequestDays(startsOn, endsOn, 8, dayHours) : [];
  const chosenDays = formDays.filter((day) => day.hours > 0);
  const chosenHours = chosenDays.reduce((sum, day) => sum + day.hours, 0);
  const debits = leaveTypeDebitsBalance(kind);
  const preview = debits
    ? timeOffBalanceView(ledger, mine, session.userId, kind, chosenHours)
    : null;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const created = await store.createTimeOffRequest({
        kind,
        startsOn,
        endsOn,
        reason: reason.trim(),
        days: chosenDays,
        siteId: session.siteId,
      });
      onSubmitted(created);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not submit the request.";
      setError(message);
      onError(message);
      setBusy(false);
    }
  };

  return (
    <form
      className="msh-record-card"
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && chosenHours > 0) void submit();
      }}
    >
      <strong>Request time off</strong>
      <label className="msh-field">
        <span>Type</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value as LeaveType)}
        >
          {LEAVE_TYPES.map((type) => (
            <option key={type} value={type}>
              {LEAVE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </label>
      <label className="msh-field">
        <span>First day</span>
        <input
          type="date"
          required
          value={startsOn}
          onChange={(event) => setStartsOn(event.target.value)}
        />
      </label>
      <label className="msh-field">
        <span>Last day</span>
        <input
          type="date"
          required
          value={endsOn}
          onChange={(event) => setEndsOn(event.target.value)}
        />
      </label>
      {formDays.map((day) => (
        <label key={day.date} className="msh-field">
          <span>Hours on {day.date}</span>
          <input
            type="number"
            min={0}
            max={24}
            step={0.5}
            value={dayHours[day.date] ?? 8}
            onChange={(event) =>
              setDayHours({ ...dayHours, [day.date]: Number(event.target.value) })
            }
          />
        </label>
      ))}
      <label className="msh-field">
        <span>Reason</span>
        <input
          type="text"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      {preview && (
        <p className="msh-status-text">
          Balance after this request: {preview.projectedHours}h
          {preview.pendingHours > 0
            ? ` (${preview.pendingHours}h already pending)`
            : ""}
        </p>
      )}
      <p className="msh-status-text">Total: {chosenHours}h</p>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      <div className="msh-form-actions">
        <button type="button" className="msh-button secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="msh-button primary"
          disabled={busy || chosenHours <= 0}
        >
          {busy ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </form>
  );
}
