/**
 * Remote punch access admin — grant/revoke the `hub.remote_punch`
 * permission per staff member (clock in/out from a personal device).
 *
 * Consumes Worker 3's remote-punch store surface through the dynamic
 * adapter in kioskContracts.ts (`hasRemotePunch`, `grantRemotePunch`,
 * `revokeRemotePunch`, `listRemotePunchGrants`). Until that surface lands,
 * a plain-language setup note renders instead of the list.
 *
 * Gated on `hub.manage_pay_settings`. `initialGrants` seeds the first
 * render (tests / SSR).
 */
import { useEffect, useMemo, useState } from "react";
import { KeyRound } from "lucide-react";
import type { HrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import { hasPermission } from "../../data/permissions";
import {
  adaptRemotePunchStore,
  isRemotePunchAvailable,
  type RemotePunchGrant,
} from "./kioskContracts";
import type { HubStaffEntry } from "./EmployeeHubPage";

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

export function RemotePunchAdmin({
  session,
  store,
  staffList,
  initialGrants,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  initialGrants?: RemotePunchGrant[];
}) {
  const available = isRemotePunchAvailable(store);
  const remote = useMemo(() => adaptRemotePunchStore(store), [store]);
  const [grants, setGrants] = useState<RemotePunchGrant[]>(initialGrants ?? []);
  const [loading, setLoading] = useState(!initialGrants && available);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const canAdmin = hasPermission(session, "hub.manage_pay_settings");

  const staffName = (userId: string | null): string =>
    userId ? (staffList.find((s) => s.userId === userId)?.fullName ?? "Unknown staff") : "—";

  const load = () => {
    if (!available) return;
    setLoading(true);
    setError("");
    remote
      .listRemotePunchGrants()
      .then((g) => {
        setGrants(g);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load remote punch grants."));
        setLoading(false);
      });
  };

  useEffect(() => {
    if (!initialGrants) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  if (!canAdmin) return null;

  if (!available && !initialGrants) {
    return (
      <div>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <KeyRound size={18} aria-hidden="true" /> Remote punch access
        </h3>
        <p className="hub-sub">
          Remote punch grants are still being set up — staff grants will be
          managed here once it's live.
        </p>
      </div>
    );
  }

  const grantByStaff = new Map(grants.map((g) => [g.staffId, g]));

  const setGrant = async (staffId: string, grant: boolean) => {
    setBusyId(staffId);
    setError("");
    try {
      if (grant) await remote.grantRemotePunch(staffId);
      else await remote.revokeRemotePunch(staffId);
      load();
    } catch (err) {
      setError(errMessage(err, grant ? "Could not grant remote punch access." : "Could not revoke remote punch access."));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <KeyRound size={18} aria-hidden="true" /> Remote punch access
      </h3>
      <p className="hub-sub">
        Staff with a grant can clock in/out from a personal device
        (<code>hub.remote_punch</code>). Everyone else clocks in on the house
        kiosk laptop.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading grants…</p>
      ) : (
        <ul className="hub-list">
          {staffList.map((s) => {
            const g = grantByStaff.get(s.userId);
            const busy = busyId === s.userId;
            return (
              <li className="hub-list-item" key={s.userId}>
                <div className="hub-item-main">
                  <span className="hub-item-title">{s.fullName}</span>
                  <span className="hub-item-sub">
                    {g
                      ? `Granted by ${staffName(g.grantedBy)} · ${g.grantedAt ? fmtDateTime(g.grantedAt) : "date unknown"}`
                      : "No grant — kiosk only"}
                  </span>
                </div>
                <span className={g ? "hub-status approved" : "hub-status pending"}>
                  {g ? "Granted" : "Kiosk only"}
                </span>
                <button
                  className={`hub-btn${g ? " danger" : " primary"}`}
                  disabled={busy}
                  onClick={() => setGrant(s.userId, !g)}
                >
                  {busy ? "Saving…" : g ? "Revoke" : "Grant"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
