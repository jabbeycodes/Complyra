import { useEffect, useMemo, useState } from "react";
import { Empty, Modal, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { useIspApi } from "./ispApi";
import { escalationMessageFor } from "./ispEscalationMessage";
import { repeatOffenders as repeatOffendersPure } from "../../data/ispData";
import type {
  IspExpectationView,
  IspRepeatOffender,
} from "../../data/types";
import "./ispData.css";

export default function OverdueCommand() {
  const isp = useIspApi();
  const { session } = useData();
  const [overdue, setOverdue] = useState<IspExpectationView[]>([]);
  const [dueSoon, setDueSoon] = useState<IspExpectationView[]>([]);
  const [offenders, setOffenders] = useState<IspRepeatOffender[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState("");
  const [activeExp, setActiveExp] = useState<IspExpectationView | null>(null);
  const [messageText, setMessageText] = useState("");
  const [messageDone, setMessageDone] = useState("");

  const canMessage = !!session && can(session, "isp.message_staff");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [over, soon, off] = await Promise.all([
        isp.ispOverdueNotes(),
        isp
          .ispListExpectations({})
          .catch(() => [] as IspExpectationView[]),
        isp.ispRepeatOffenders(30).catch(() => [] as IspRepeatOffender[]),
      ]);
      setOverdue(over);
      // "Due soon": pending expectations due within the next 6 hours.
      const now = Date.now();
      setDueSoon(
        soon
          .filter((e) => {
            if (e.status !== "pending" || e.excused) return false;
            const due = new Date(e.dueAt).getTime();
            return due > now && due - now <= 6 * 3600 * 1000;
          })
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      );
      // Fall back to the pure helper if the API returned nothing.
      setOffenders(
        off.length > 0
          ? off
          : repeatOffendersPure([...over, ...soon], 30, new Date()),
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not load overdue notes.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSweep() {
    setBusy(true);
    setSweepResult("");
    setError("");
    try {
      const decisions = await isp.ispRunEscalationSweep();
      setSweepResult(
        decisions.length === 0
          ? "Sweep complete — nothing needed a reminder."
          : `Sweep complete — ${decisions.length} reminder${decisions.length === 1 ? "" : "s"} sent.`,
      );
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not run the sweep.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(exp: IspExpectationView) {
    const text = messageText.trim() || escalationMessageFor(exp);
    setBusy(true);
    try {
      await isp.ispSendEscalation({
        expectationId: exp.id,
        kind: "message",
        toUserId: exp.userId,
        message: text,
      });
      setMessageDone(`Message sent to ${exp.staffName}.`);
      setMessageText("");
    } catch (err) {
      setMessageDone(
        err instanceof Error ? err.message : "Could not send the message.",
      );
    } finally {
      setBusy(false);
    }
  }

  function openMessage(exp: IspExpectationView) {
    setActiveExp(exp);
    setMessageText(escalationMessageFor(exp));
    setMessageDone("");
  }

  const totalOverdueHours = useMemo(
    () =>
      overdue.reduce((sum, e) => sum + Math.max(0, e.hoursOverdue ?? 0), 0),
    [overdue],
  );

  if (loading) return <div className="isp-panel">Loading command center…</div>;

  return (
    <div className="isp-wrap">
      <PageHeading title="ISP data">
        <span className="isp-status-chip">
          {overdue.length} overdue · {dueSoon.length} due soon
        </span>
      </PageHeading>

      {error && (
        <p role="alert" style={{ color: "#93382a", fontWeight: 700 }}>
          {error}
        </p>
      )}

      <div className="isp-panel">
        <h3>Overdue notes</h3>
        <p className="isp-sub">
          Every missing shift note across the agency, sorted by how late it
          is. {totalOverdueHours > 0 && (
            <>
              {Math.floor(totalOverdueHours)} overdue note-hours outstanding.
            </>
          )}
        </p>
        <div className="isp-btn-row" style={{ marginTop: 0, marginBottom: 16 }}>
          <button
            type="button"
            className="isp-btn primary"
            onClick={() => void runSweep()}
            disabled={busy}
          >
            {busy ? "Running…" : "Run reminder sweep"}
          </button>
          {sweepResult && (
            <span style={{ color: "#3f5c3b", fontWeight: 700 }}>
              {sweepResult}
            </span>
          )}
        </div>
        {overdue.length === 0 ? (
          <Empty
            title="Nothing overdue"
            text="Every expected shift note is in or excused."
          />
        ) : (
          <div className="isp-list">
            {overdue.map((e) => (
              <div className="isp-overdue-row overdue" key={e.id}>
                <div>
                  <div className="isp-who">{e.staffName}</div>
                  <div className="isp-meta">
                    {e.siteName} · {e.individualName} · {e.shiftName} (
                    {e.shiftStart}–{e.shiftEnd}) · {e.workDate}
                  </div>
                </div>
                <div className="isp-sig-row">
                  <span className="isp-hours">
                    {Math.floor(e.hoursOverdue ?? 0)}h overdue
                  </span>
                  {canMessage && (
                    <button
                      type="button"
                      className="isp-btn"
                      onClick={() => openMessage(e)}
                    >
                      Message
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="isp-panel">
        <h3>Due soon</h3>
        <p className="isp-sub">
          Notes still pending with due time in the next 6 hours — a nudge now
          avoids an overdue later.
        </p>
        {dueSoon.length === 0 ? (
          <Empty
            title="Nothing due soon"
            text="No pending notes are due in the next 6 hours."
          />
        ) : (
          <div className="isp-list">
            {dueSoon.map((e) => (
              <div className="isp-overdue-row due-soon" key={e.id}>
                <div>
                  <div className="isp-who">{e.staffName}</div>
                  <div className="isp-meta">
                    {e.siteName} · {e.individualName} · {e.shiftName} · due{" "}
                    {new Date(e.dueAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
                {canMessage && (
                  <button
                    type="button"
                    className="isp-btn"
                    onClick={() => openMessage(e)}
                  >
                    Message
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="isp-panel">
        <h3>Repeat offenders — last 30 days</h3>
        <p className="isp-sub">
          Staff with the most overdue and late notes. Use this for coaching
          conversations, not punishment.
        </p>
        {offenders.length === 0 ? (
          <Empty
            title="No repeat offenders"
            text="No one has a pattern of overdue notes in the last 30 days."
          />
        ) : (
          <div className="isp-table-wrap">
            <table className="isp-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Home</th>
                  <th>Overdue</th>
                  <th>Late</th>
                  <th>Expected</th>
                </tr>
              </thead>
              <tbody>
                {offenders.map((o) => (
                  <tr key={o.userId}>
                    <td>{o.staffName}</td>
                    <td>{o.siteName}</td>
                    <td>
                      <span className="isp-badge red">{o.overdueCount}</span>
                    </td>
                    <td>
                      <span className="isp-badge amber">{o.lateCount}</span>
                    </td>
                    <td>{o.totalExpected}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {activeExp && (
        <Modal
          title={`Message ${activeExp.staffName}`}
          onClose={() => setActiveExp(null)}
        >
          <div className="isp-panel">
            <h3>Message {activeExp.staffName}</h3>
            <p className="isp-sub">
              {activeExp.siteName} · {activeExp.individualName} ·{" "}
              {activeExp.shiftName}
            </p>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-overdue-message">Message</label>
              </span>
              <textarea
                id="isp-overdue-message"
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
              />
            </div>
            {messageDone && <p>{messageDone}</p>}
            <div className="isp-btn-row">
              <button
                type="button"
                className="isp-btn primary"
                onClick={() => void sendMessage(activeExp)}
                disabled={busy || !messageText.trim()}
              >
                {busy ? "Sending…" : "Send message"}
              </button>
              <button
                type="button"
                className="isp-btn"
                onClick={() => setActiveExp(null)}
              >
                Close
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
