/**
 * Who's here now — per-site live view of open clock-ins for managers.
 *
 * Reads open punches from the kiosk store surface (`listOpenPunches`,
 * Worker 3) and auto-refreshes every 60 seconds. Today's published shifts
 * supply the shift label per punch. Multi-site managers
 * (hub.manage_staffing) get a site picker; everyone else sees their own
 * site. Renders a "being set up" note until the kiosk store surface lands.
 *
 * `initialOpenPunches` / `initialShifts` seed the first render (tests / SSR)
 * — the client always refreshes from the store on mount and every 60s after.
 */
import { useEffect, useMemo, useState } from "react";
import { Clock } from "lucide-react";
import { Empty } from "../../components";
import { hasPermission } from "../../data/permissions";
import type { HrPunch, HrShift } from "../../data/hr";
import type { SessionUser } from "../../data/types";
import type { HrStore } from "../../data/hrStore";
import {
  adaptKioskStore,
  isKioskStoreAvailable,
} from "./kioskContracts";
import type { HubSite, HubStaffEntry } from "./EmployeeHubPage";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "3h 12m" / "45m" — tabular figures so the tick doesn't jitter. */
export function fmtElapsed(sinceIso: string, nowMs: number): string {
  const ms = Math.max(0, nowMs - Date.parse(sinceIso));
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

/** Verification method label for the chip. */
function verificationLabel(method: string): string {
  return method.replace(/_/g, " ");
}

function dayStamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function WhosHereNow({
  session,
  store,
  staffList,
  sites,
  initialOpenPunches,
  initialShifts,
}: {
  session: SessionUser;
  store: HrStore;
  staffList: HubStaffEntry[];
  sites: HubSite[];
  initialOpenPunches?: HrPunch[];
  initialShifts?: HrShift[];
}) {
  const kiosk = useMemo(() => adaptKioskStore(store), [store]);
  const available = isKioskStoreAvailable(store);
  const canSeeAllSites = hasPermission(session, "hub.manage_staffing");
  const [siteId, setSiteId] = useState(canSeeAllSites ? "" : (session.siteId ?? ""));
  const [punches, setPunches] = useState<HrPunch[]>(initialOpenPunches ?? []);
  const [shifts, setShifts] = useState<HrShift[]>(initialShifts ?? []);
  const [loading, setLoading] = useState(!initialOpenPunches && available);
  const [error, setError] = useState("");
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    const load = () => {
      setError("");
      const today = dayStamp(new Date());
      const siteIds = siteId ? [siteId] : sites.map((s) => s.id);
      Promise.all([
        Promise.all(siteIds.map((id) => kiosk.listOpenPunches(id).catch(() => [] as HrPunch[]))),
        store.listShifts(`${today}T00:00:00`, `${today}T23:59:59`).catch(() => [] as HrShift[]),
      ])
        .then(([lists, dayShifts]) => {
          if (cancelled) return;
          setPunches(lists.flat());
          setShifts(dayShifts);
          setLoading(false);
          setNowMs(Date.now());
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error && err.message ? err.message : "Could not load who's here.");
          setLoading(false);
        });
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kiosk, siteId, available]);

  const nameFor = (punch: HrPunch): string =>
    staffList.find((s) => s.userId === punch.staffId)?.fullName ?? "Unknown staff";

  /** The punch's own shift, or the staff member's first published shift today. */
  const shiftLabelFor = (punch: HrPunch): string | null => {
    const direct = shifts.find((s) => s.id === punch.shiftId);
    if (direct) return direct.title;
    const todays = shifts.find(
      (s) => s.staffId === punch.staffId && s.status === "published",
    );
    return todays?.title ?? null;
  };

  const siteNameFor = (punch: HrPunch): string | null => {
    if (!punch.siteId) return null;
    return sites.find((s) => s.id === punch.siteId)?.name ?? null;
  };

  const siteLabel = siteId
    ? (sites.find((s) => s.id === siteId)?.name ?? "this site")
    : "all sites";

  if (!available) {
    return (
      <section className="hub-card" aria-label="Who's here now">
        <h2>Who's here now</h2>
        <p className="hub-sub">
          The kiosk time clock is still being set up — the live who's-here
          view will appear here once it's live.
        </p>
      </section>
    );
  }

  return (
    <section className="hub-card" aria-label="Who's here now">
      <div className="hub-row">
        <div>
          <h2>Who's here now</h2>
          <p className="hub-sub">
            Live clock-ins at {siteLabel} · refreshes every minute.
          </p>
        </div>
        {canSeeAllSites && (
          <div className="hub-form">
            <label>
              Site
              <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
                <option value="">All sites</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </div>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading…</p>
      ) : punches.length === 0 ? (
        <Empty
          title="Nobody clocked in"
          text={`No open clock-ins at ${siteLabel} right now.`}
          mark="quiet"
        />
      ) : (
        <ul className="hub-list">
          {punches.map((punch) => {
            const name = nameFor(punch);
            const shiftLabel = shiftLabelFor(punch);
            const siteName = siteNameFor(punch);
            return (
              <li className="hub-list-item" key={punch.id}>
                <span className="hub-avatar" aria-hidden="true">
                  {initialsOf(name)}
                </span>
                <div className="hub-item-main">
                  <span className="hub-item-title">{name}</span>
                  <span className="hub-item-sub">
                    Clocked in {fmtTime(punch.punchedAt)}
                    {shiftLabel ? ` · ${shiftLabel}` : ""}
                    {siteName && siteId === "" ? ` · ${siteName}` : ""}
                  </span>
                  <span className="hub-chip-row" style={{ marginTop: 4 }}>
                    {punch.verificationMethod && (
                      <span className="hub-chip" style={{ minHeight: 0, padding: "4px 10px" }}>
                        {verificationLabel(punch.verificationMethod)}
                      </span>
                    )}
                    {punch.remote === true && (
                      <span className="hub-chip" style={{ minHeight: 0, padding: "4px 10px" }}>
                        Remote
                      </span>
                    )}
                    {punch.offline && (
                      <span className="hub-chip" style={{ minHeight: 0, padding: "4px 10px" }}>
                        Offline sync
                      </span>
                    )}
                  </span>
                </div>
                <div className="hub-row">
                  <span className="hub-elapsed" title={`Clocked in at ${fmtTime(punch.punchedAt)}`}>
                    <Clock size={16} aria-hidden="true" /> {fmtElapsed(punch.punchedAt, nowMs)}
                  </span>
                  <span className="hub-status submitted">On shift</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
