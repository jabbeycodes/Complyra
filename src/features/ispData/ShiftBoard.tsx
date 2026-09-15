import { useEffect, useState } from "react";
import { Empty, Modal } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { useIspApi } from "./ispApi";
import type {
  HouseShiftBoard,
  IspExpectationStatus,
  IspExpectationView,
} from "../../data/types";
import "./ispData.css";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function cellClass(status: IspExpectationStatus): string {
  switch (status) {
    case "submitted":
      return "submitted";
    case "overdue":
      return "overdue";
    case "late_submitted":
      return "late";
    case "excused":
      return "excused";
    default:
      return "pending";
  }
}

function cellLabel(
  status: IspExpectationStatus,
  hoursOverdue: number | null,
): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "overdue":
      return `Overdue${hoursOverdue != null ? ` ${Math.floor(hoursOverdue)}h` : ""}`;
    case "late_submitted":
      return "Late";
    case "excused":
      return "Excused";
    default:
      return "Pending";
  }
}

export default function ShiftBoard({
  siteId,
  siteName,
}: {
  siteId: string;
  siteName: string;
}) {
  const isp = useIspApi();
  const { session } = useData();
  const [date, setDate] = useState(todayIso());
  const [board, setBoard] = useState<HouseShiftBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<{
    shiftName: string;
    staffName: string;
    expectations: IspExpectationView[];
  } | null>(null);
  const [selectedExps, setSelectedExps] = useState<IspExpectationView[]>([]);
  const [selectedLoading, setSelectedLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageBusy, setMessageBusy] = useState(false);
  const [messageDone, setMessageDone] = useState("");
  const [excuseReason, setExcuseReason] = useState("");
  const [excuseTarget, setExcuseTarget] = useState<string | null>(null);

  const canMessage = !!session && can(session, "isp.message_staff");
  const canExcuse =
    !!session &&
    (can(session, "isp.manage_plan") ||
      session.roleKey === "house_manager" ||
      session.roleKey === "administrator" ||
      session.roleKey === "degreed_professional_manager");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      setBoard(await isp.ispHouseShiftBoard(siteId, date));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the board.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, date]);

  async function openCell(
    shiftName: string,
    staffName: string,
    userId: string,
    shiftPatternId: string,
  ) {
    setSelected({ shiftName, staffName, expectations: [] });
    setSelectedExps([]);
    setMessage("");
    setMessageDone("");
    setExcuseTarget(null);
    setExcuseReason("");
    setSelectedLoading(true);
    try {
      const rows = await isp.ispListExpectations({
        siteId,
        userId,
        fromDate: date,
        toDate: date,
      });
      setSelectedExps(
        rows.filter((r) => r.shiftPatternId === shiftPatternId),
      );
    } catch {
      setSelectedExps([]);
    } finally {
      setSelectedLoading(false);
    }
  }

  async function sendMessage(toUserId: string) {
    if (!message.trim()) return;
    setMessageBusy(true);
    try {
      await isp.ispSendEscalation({
        kind: "message",
        toUserId,
        message: message.trim(),
      });
      setMessageDone("Message sent.");
      setMessage("");
    } catch (err) {
      setMessageDone(
        err instanceof Error ? err.message : "Could not send the message.",
      );
    } finally {
      setMessageBusy(false);
    }
  }

  async function excuse(expectationId: string) {
    if (!excuseReason.trim()) return;
    try {
      await isp.ispExcuseExpectation(expectationId, excuseReason.trim());
      setExcuseTarget(null);
      setExcuseReason("");
      await reload();
      setSelected(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not excuse.");
    }
  }

  if (loading) return <div className="isp-panel">Loading shift board…</div>;

  return (
    <div className="isp-wrap">
      <div className="isp-panel">
        <h3>Shift board — {siteName}</h3>
        <p className="isp-sub">
          Who worked each shift and whether their notes are in. Select a cell
          for details and to message the staffer.
        </p>
        <div className="isp-picker-row">
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ minHeight: 44 }}
            />
          </label>
        </div>
        {error && (
          <p role="alert" style={{ color: "#93382a", fontWeight: 700 }}>
            {error}
          </p>
        )}
        {!board || board.shifts.length === 0 ? (
          <Empty
            title="No shifts scheduled"
            text="Use the Scheduling view to assign staff to shifts for this day."
          />
        ) : (
          <>
            <div className="isp-legend" style={{ marginBottom: 12 }}>
              <span>
                <span className="isp-swatch" style={{ background: "#dce8d3" }} />
                Submitted
              </span>
              <span>
                <span className="isp-swatch" style={{ background: "#f7f3ea" }} />
                Pending
              </span>
              <span>
                <span className="isp-swatch" style={{ background: "#f3d9cf" }} />
                Overdue
              </span>
              <span>
                <span className="isp-swatch" style={{ background: "#f6e7c8" }} />
                Late
              </span>
              <span>
                <span className="isp-swatch" style={{ background: "#e4e4e4" }} />
                Excused
              </span>
            </div>
            <div className="isp-board">
              {board.shifts.map((shift) => (
                <div
                  className="isp-board-row"
                  key={shift.patternId}
                  style={{
                    gridTemplateColumns: `180px repeat(${Math.max(shift.cells.length, 1)}, minmax(140px, 1fr))`,
                  }}
                >
                  <div className="isp-board-head">
                    {shift.name}
                    <br />
                    <span
                      style={{
                        fontWeight: 400,
                        fontSize: 13,
                        color: "#4a4036",
                      }}
                    >
                      {shift.startTime}–{shift.endTime}
                    </span>
                  </div>
                  {shift.cells.map((cell) => {
                    const status: IspExpectationStatus =
                      cell.overdue > 0
                        ? "overdue"
                        : cell.lateSubmitted > 0
                          ? "late_submitted"
                          : cell.excused > 0
                            ? "excused"
                            : cell.submitted > 0 && cell.pending === 0
                              ? "submitted"
                              : "pending";
                    const label = cellLabel(status, null);
                    return (
                      <button
                        key={cell.assignmentId}
                        type="button"
                        className={`isp-cell ${cellClass(status)}`}
                        onClick={() =>
                          void openCell(
                            shift.name,
                            cell.staffName,
                            cell.userId,
                            shift.patternId,
                          )
                        }
                      >
                        <span className="isp-cell-name">{cell.staffName}</span>
                        <span className="isp-cell-sub">
                          {label} ·{" "}
                          {cell.submitted + cell.lateSubmitted}/{cell.total}{" "}
                          notes
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <Modal
          title={`${selected.shiftName} — ${selected.staffName}`}
          onClose={() => setSelected(null)}
        >
          <div className="isp-panel">
            <h3>
              {selected.shiftName} — {selected.staffName}
            </h3>
            {selectedLoading ? (
              <p>Loading expectations…</p>
            ) : selectedExps.length === 0 ? (
              <Empty
                title="No expectations"
                text="No notes were expected from this staffer on this shift."
              />
            ) : (
              <div className="isp-list">
                {selectedExps.map((e) => (
                  <div
                    className={`isp-overdue-row ${
                      e.status === "overdue" ? "overdue" : ""
                    }`}
                    key={e.id}
                  >
                    <div>
                      <div className="isp-who">{e.individualName}</div>
                      <div className="isp-meta">
                        {e.shiftName} · due{" "}
                        {new Date(e.dueAt).toLocaleString()} ·{" "}
                        <strong>{e.status.replace("_", " ")}</strong>
                        {e.hoursOverdue != null && e.hoursOverdue > 0 && (
                          <span className="isp-hours">
                            {" "}
                            · {Math.floor(e.hoursOverdue)}h overdue
                          </span>
                        )}
                      </div>
                    </div>
                    {canExcuse && e.status !== "excused" && (
                      <button
                        type="button"
                        className="isp-btn"
                        onClick={() =>
                          setExcuseTarget(
                            excuseTarget === e.id ? null : e.id,
                          )
                        }
                      >
                        Excuse
                      </button>
                    )}
                  </div>
                ))}
                {excuseTarget && (
                  <div className="isp-field">
                    <span>
                      <label htmlFor="isp-excuse-reason">
                        Excuse reason (required)
                      </label>
                    </span>
                    <textarea
                      id="isp-excuse-reason"
                      value={excuseReason}
                      onChange={(ev) => setExcuseReason(ev.target.value)}
                      placeholder="Why is this note not required?"
                    />
                    <div className="isp-btn-row">
                      <button
                        type="button"
                        className="isp-btn"
                        onClick={() => void excuse(excuseTarget)}
                        disabled={!excuseReason.trim()}
                      >
                        Save excuse
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {canMessage && selectedExps.length > 0 && (
              <div className="isp-field" style={{ marginTop: 16 }}>
                <span>
                  <label htmlFor="isp-cell-message">
                    Message {selected.staffName}
                  </label>
                </span>
                <textarea
                  id="isp-cell-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="e.g. Your shift note for today is still open — please submit it before end of shift."
                />
                {messageDone && <p>{messageDone}</p>}
                <div className="isp-btn-row">
                  <button
                    type="button"
                    className="isp-btn primary"
                    onClick={() =>
                      void sendMessage(selectedExps[0]?.userId ?? "")
                    }
                    disabled={messageBusy || !message.trim()}
                  >
                    {messageBusy ? "Sending…" : "Send message"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
