import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import type { SessionUser } from "../../data/types";
import type { HrStore } from "../../data/hrStore";
import type { HrPunch } from "../../data/hr";
import {
  adaptRemotePunchStore,
  isRemotePunchAvailable,
} from "../employeeHub/kioskContracts";
import { centralTodayIso, formatCentralTime } from "./mar";

/**
 * Mobile Time Clock — the phone Time Clock tile's home (batches
 * 29–30: the tile used to leave the shell for the desktop Employee
 * Hub and land on My Schedule). Same store, same rules as the
 * desktop Time Clock tab: today's punches from listPunches, the
 * clock button from clockIn/clockOut, and the remote-punch grant
 * gate — without a hub.remote_punch grant there is no button, only
 * the kiosk direction, exactly like the desktop tab.
 */
export default function MobileTimeClock({
  store,
  session,
  onBack,
}: {
  store: HrStore;
  session: SessionUser;
  onBack: () => void;
}) {
  const [punches, setPunches] = useState<HrPunch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState<"unknown" | "allowed" | "denied">(() =>
    isRemotePunchAvailable(store) ? "unknown" : "allowed",
  );
  const stamp = centralTodayIso();

  useEffect(() => {
    let cancelled = false;
    if (!isRemotePunchAvailable(store)) {
      setGrant("allowed");
      return;
    }
    adaptRemotePunchStore(store)
      .hasRemotePunch(session.userId)
      .then((ok) => {
        if (!cancelled) setGrant(ok ? "allowed" : "denied");
      })
      .catch(() => {
        if (!cancelled) setGrant("allowed");
      });
    return () => {
      cancelled = true;
    };
  }, [store, session.userId]);

  const load = () => {
    setLoading(true);
    setError("");
    store
      .listPunches(session.userId, `${stamp}T00:00:00`, `${stamp}T23:59:59`)
      .then((rows) => {
        setPunches(rows);
        setLoading(false);
      })
      .catch((err) => {
        setError(
          err instanceof Error ? err.message : "Could not load today's punches.",
        );
        setLoading(false);
      });
  };

  useEffect(load, [store, session.userId, stamp]);

  const last = punches[punches.length - 1];
  const clockedIn = last?.kind === "in";

  const act = async () => {
    setBusy(true);
    setError("");
    try {
      if (clockedIn) await store.clockOut();
      else await store.clockIn();
      load();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : clockedIn
            ? "Could not clock out."
            : "Could not clock in.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ My Hub
      </button>
      <h3 className="msh-pass-title">Time clock</h3>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      <p className="msh-status-text">
        {loading
          ? "Loading today's punches…"
          : clockedIn
            ? `Clocked in since ${formatCentralTime(last.punchedAt)}.`
            : "You are clocked out."}
      </p>
      {grant === "denied" ? (
        <p className="msh-empty">
          Clock in on the house kiosk laptop. Remote punching from a
          personal device isn't enabled for your account — use the kiosk
          at your work site instead.
        </p>
      ) : (
        <button
          type="button"
          className="msh-button block"
          disabled={busy || loading || grant === "unknown"}
          onClick={() => void act()}
        >
          <Clock size={18} aria-hidden="true" />{" "}
          {busy ? "Saving…" : clockedIn ? "Clock out" : "Clock in"}
        </button>
      )}
      <h4 className="msh-pass-title">Today's punches</h4>
      {loading ? (
        <p className="msh-empty">Loading…</p>
      ) : punches.length === 0 ? (
        <p className="msh-empty">No punches today. Clock in to start your shift.</p>
      ) : (
        <div className="msh-list">
          {punches.map((punch) => (
            <div key={punch.id} className="msh-row static">
              <span className="msh-row-main">
                <strong>
                  {punch.kind === "in"
                    ? "Clocked in"
                    : punch.kind === "out"
                      ? "Clocked out"
                      : punch.kind === "break_out"
                        ? "Break started"
                        : punch.kind === "break_in"
                          ? "Back from break"
                          : "Transferred"}
                </strong>
                <small>{formatCentralTime(punch.punchedAt)}</small>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
