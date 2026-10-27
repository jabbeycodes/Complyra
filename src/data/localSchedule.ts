import { shiftSpanOnServiceDate } from "./dueItems";

const HR_KEY = "complyrer.hr.v1";
const OPEN_KEY = "complyra.openShifts.v1";

export type LocalCoverageShift = {
  id: string;
  staffUserId: string;
  staffName: string;
  startsAt: string;
  endsAt: string;
};

type StoredShift = {
  id?: string;
  siteId?: string | null;
  staffId?: string | null;
  startsAt?: string;
  endsAt?: string;
  status?: string;
};

/** Shifts created from an open-shift pickup in this page, including when storage is off. */
const claimed = new Map<string, StoredShift[]>();

export function rememberClaimedShift(agencyId: string, shift: StoredShift): void {
  const rows = claimed.get(agencyId) ?? [];
  if (!rows.some((row) => row.id === shift.id)) rows.push(shift);
  claimed.set(agencyId, rows);
}

export function claimedCoverageShifts(agencyId: string): StoredShift[] {
  return claimed.get(agencyId) ?? [];
}

function readJson(key: string): Record<string, unknown> | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function touches(startsAt: string, endsAt: string, serviceDate: string): boolean {
  const span = shiftSpanOnServiceDate(startsAt, endsAt, serviceDate);
  return Boolean(span && span.start < 1440 && span.end > 0);
}

/**
 * The demo schedule lives in the browser, split by the person who saved it.
 * The house dashboard and the due list both read every bucket for the agency.
 */
export function readLocalCoverage(
  agencyId: string,
  siteId: string,
  serviceDate: string,
): LocalCoverageShift[] {
  const byId = new Map<string, LocalCoverageShift>();
  const add = (shift: StoredShift, staffName = "Staff") => {
    if (!shift.id || !shift.startsAt || !shift.endsAt) return;
    if (shift.siteId && shift.siteId !== siteId) return;
    if (shift.status === "cancelled") return;
    if (!touches(shift.startsAt, shift.endsAt, serviceDate)) return;
    byId.set(shift.id, {
      id: shift.id,
      staffUserId: shift.staffId ?? "",
      staffName: shift.staffId ? staffName : "Open",
      startsAt: shift.startsAt,
      endsAt: shift.endsAt,
    });
  };

  const hr = readJson(HR_KEY);
  const agency = hr?.[agencyId];
  if (agency && typeof agency === "object") {
    for (const bucket of Object.values(agency as Record<string, { shifts?: StoredShift[] }>)) {
      for (const shift of bucket?.shifts ?? []) add(shift);
    }
  }
  for (const shift of claimed.get(agencyId) ?? []) add(shift);

  const openRoot = readJson(OPEN_KEY);
  const openBucket = openRoot?.[agencyId] as { shifts?: Array<StoredShift & { kind?: string }> } | undefined;
  for (const shift of openBucket?.shifts ?? []) {
    if (shift.kind && shift.kind !== "temporary") continue;
    if (shift.status && shift.status !== "open") continue;
    add({ ...shift, staffId: null, status: "published" }, "Open");
  }
  return [...byId.values()];
}
