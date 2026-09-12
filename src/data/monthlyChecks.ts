import type { IndividualRecord, SiteRecord } from "./types";
import type { ObligationItem } from "./planStack";

export const MONTHLY_DUE_DAY = 7;

export type DrillType =
  | "fire"
  | "tornado"
  | "earthquake"
  | "severe_weather"
  | "intruder"
  | "missing_person"
  | "medical_emergency";

export type SafetyLineKey =
  | "smoke_1"
  | "smoke_2"
  | "smoke_3"
  | "co_1"
  | "faucet_1"
  | "faucet_2"
  | "fire_extinguisher"
  | "expired_foods"
  | "home_first_aid"
  | "vehicle_first_aid";

export type MonthlyTone = "current" | "due_soon" | "overdue";

export interface AdaptiveEquipment {
  id: string;
  agencyId: string;
  individualId: string;
  name: string;
  source: "pcsp" | "manual";
  active: boolean;
}

export interface EquipmentMonthLog {
  id: string;
  equipmentId: string;
  monthKey: string;
  checkedOn: string | null;
  initials: string | null;
  checkedByUserId: string | null;
  comments: string;
}

export interface EmergencyDrill {
  id: string;
  agencyId: string;
  siteId: string;
  monthKey: string;
  drillType: DrillType;
  date: string | null;
  time: string | null;
  evacTime: string | null;
  leaderName: string | null;
  participants: string;
  awakeOrSleep: "awake" | "sleep" | "";
}

export interface SafetyLine {
  key: SafetyLineKey;
  dateChecked: string | null;
  location: string;
  temp: string;
  extra: string;
  checkedBy: string | null;
  signature: string | null;
}

export interface HomeSafetyReport {
  id: string;
  agencyId: string;
  siteId: string;
  monthKey: string;
  lines: SafetyLine[];
}

/** LifePath schedule: drills due by the 7th, fire every month. */
export const DRILLS_BY_MONTH: Record<number, DrillType[]> = {
  1: ["fire", "intruder"],
  2: ["fire", "earthquake"],
  3: ["fire", "tornado", "severe_weather"],
  4: ["fire", "tornado", "medical_emergency"],
  5: ["fire", "tornado", "earthquake", "intruder"],
  6: ["fire", "tornado", "severe_weather", "missing_person"],
  7: ["fire", "tornado", "intruder"],
  8: ["fire", "tornado", "earthquake"],
  9: ["fire", "tornado", "severe_weather"],
  10: ["fire", "tornado", "medical_emergency"],
  11: ["fire", "severe_weather"],
  12: ["fire", "earthquake", "intruder", "missing_person"],
};

export const DRILL_LABELS: Record<DrillType, string> = {
  fire: "Fire",
  tornado: "Tornado",
  earthquake: "Earthquake",
  severe_weather: "Severe weather",
  intruder: "Intruder / threatening situation",
  missing_person: "Missing person",
  medical_emergency: "Medical emergency",
};

export const SAFETY_LINE_DEFS: {
  key: SafetyLineKey;
  title: string;
  fields: Array<"location" | "temp" | "extra">;
  extraLabel?: string;
}[] = [
  { key: "smoke_1", title: "Smoke detector 1", fields: ["location"] },
  { key: "smoke_2", title: "Smoke detector 2", fields: ["location"] },
  { key: "smoke_3", title: "Smoke detector 3", fields: ["location"] },
  { key: "co_1", title: "Carbon monoxide detector 1", fields: ["location"] },
  { key: "faucet_1", title: "Faucet 1", fields: ["location", "temp"] },
  { key: "faucet_2", title: "Faucet 2", fields: ["location", "temp"] },
  {
    key: "fire_extinguisher",
    title: "Kitchen fire extinguisher",
    fields: ["extra"],
    extraLabel: "Date on extinguisher / full reading",
  },
  { key: "expired_foods", title: "Expired foods", fields: [] },
  { key: "home_first_aid", title: "Home first aid kit", fields: [] },
  { key: "vehicle_first_aid", title: "Vehicle first aid kit", fields: [] },
];

export function monthKeyFrom(isoDate: string) {
  return isoDate.slice(0, 7);
}

export function monthDueOn(key: string) {
  return `${key}-${String(MONTHLY_DUE_DAY).padStart(2, "0")}`;
}

export function monthLabel(key: string) {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function drillsForMonth(key: string): DrillType[] {
  const month = Number(key.slice(5, 7));
  return DRILLS_BY_MONTH[month] ?? ["fire"];
}

export function monthlyTone(complete: boolean, today: string, key: string): MonthlyTone {
  if (complete) return "current";
  return today <= monthDueOn(key) ? "due_soon" : "overdue";
}

export function blankSafetyLines(): SafetyLine[] {
  return SAFETY_LINE_DEFS.map((def) => ({
    key: def.key,
    dateChecked: null,
    location: "",
    temp: "",
    extra: "",
    checkedBy: null,
    signature: null,
  }));
}

export function equipmentLogComplete(log: EquipmentMonthLog | undefined) {
  return Boolean(log?.checkedOn && log.initials);
}

export function drillComplete(drill: EmergencyDrill) {
  return Boolean(drill.date && drill.time && drill.leaderName && drill.participants.trim());
}

export function safetyComplete(report: HomeSafetyReport) {
  return SAFETY_LINE_DEFS.every((def) => {
    const line = report.lines.find((row) => row.key === def.key);
    return Boolean(line?.dateChecked && line.checkedBy);
  });
}

export function equipmentFromInventoryDetail(detail: string) {
  return detail
    .split(/[,;/]|\band\b/i)
    .map((part) => part.replace(/\.$/, "").trim())
    .filter((part) => part.length > 2 && !/^other listed/i.test(part));
}

export function isAdaptiveEquipmentObligation(item: ObligationItem) {
  return (
    item.kind === "inventory" &&
    item.enabled &&
    !item.proposed &&
    /adaptive equipment/i.test(item.title)
  );
}

export function canManageEquipment(roleKey: string) {
  return [
    "administrator",
    "compliance_admin",
    "house_manager",
    "degreed_professional_manager",
  ].includes(roleKey);
}

export function canCompleteMonthly(roleKey: string) {
  return canManageEquipment(roleKey) || roleKey === "dsp" || roleKey === "nurse";
}

export type MonthlyCollections = {
  adaptiveEquipment: AdaptiveEquipment[];
  equipmentMonthLogs: EquipmentMonthLog[];
  emergencyDrills: EmergencyDrill[];
  homeSafetyReports: HomeSafetyReport[];
};

export type MonthlyWorkspace = {
  equipment: AdaptiveEquipment[];
  equipmentLogs: EquipmentMonthLog[];
  drills: EmergencyDrill[];
  safetyReports: HomeSafetyReport[];
};

export function asMonthlyCollections(monthly: MonthlyWorkspace): MonthlyCollections {
  return {
    adaptiveEquipment: monthly.equipment,
    equipmentMonthLogs: monthly.equipmentLogs,
    emergencyDrills: monthly.drills,
    homeSafetyReports: monthly.safetyReports,
  };
}

export function emptyMonthlyCollections(): MonthlyCollections {
  return {
    adaptiveEquipment: [],
    equipmentMonthLogs: [],
    emergencyDrills: [],
    homeSafetyReports: [],
  };
}

export function ensureMonthlyCycles(
  db: MonthlyCollections & {
    sites: SiteRecord[];
    individuals: IndividualRecord[];
    obligations?: ObligationItem[];
  },
  today: string,
) {
  const key = monthKeyFrom(today);
  syncEquipmentFromPlans(db);
  for (const item of db.adaptiveEquipment.filter((row) => row.active)) {
    if (
      !db.equipmentMonthLogs.some(
        (log) => log.equipmentId === item.id && log.monthKey === key,
      )
    ) {
      db.equipmentMonthLogs.push({
        id: crypto.randomUUID(),
        equipmentId: item.id,
        monthKey: key,
        checkedOn: null,
        initials: null,
        checkedByUserId: null,
        comments: "",
      });
    }
  }
  for (const site of db.sites) {
    for (const drillType of drillsForMonth(key)) {
      if (
        !db.emergencyDrills.some(
          (row) =>
            row.siteId === site.id &&
            row.monthKey === key &&
            row.drillType === drillType,
        )
      ) {
        db.emergencyDrills.push({
          id: crypto.randomUUID(),
          agencyId: site.agencyId,
          siteId: site.id,
          monthKey: key,
          drillType,
          date: null,
          time: null,
          evacTime: null,
          leaderName: null,
          participants: "",
          awakeOrSleep: "",
        });
      }
    }
    if (
      !db.homeSafetyReports.some(
        (row) => row.siteId === site.id && row.monthKey === key,
      )
    ) {
      db.homeSafetyReports.push({
        id: crypto.randomUUID(),
        agencyId: site.agencyId,
        siteId: site.id,
        monthKey: key,
        lines: blankSafetyLines(),
      });
    }
  }
}

function syncEquipmentFromPlans(
  db: MonthlyCollections & { obligations?: ObligationItem[] },
) {
  for (const item of db.obligations ?? []) {
    if (!isAdaptiveEquipmentObligation(item)) continue;
    const existing = db.adaptiveEquipment.filter(
      (row) => row.individualId === item.individualId && row.active,
    );
    if (existing.length) continue;
    const names = equipmentFromInventoryDetail(item.detail);
    const fallback = names.length ? names : ["Adaptive equipment"];
    for (const name of fallback) {
      db.adaptiveEquipment.push({
        id: crypto.randomUUID(),
        agencyId: item.agencyId,
        individualId: item.individualId,
        name,
        source: "pcsp",
        active: true,
      });
    }
  }
}

export type EquipmentPersonView = {
  individualId: string;
  items: Array<AdaptiveEquipment & { log?: EquipmentMonthLog; complete: boolean }>;
  complete: boolean;
  tone: MonthlyTone;
};

export function equipmentViewForPerson(
  collections: MonthlyCollections,
  individualId: string,
  monthKey: string,
  today: string,
): EquipmentPersonView {
  const items = collections.adaptiveEquipment
    .filter((row) => row.individualId === individualId && row.active)
    .map((item) => {
      const log = collections.equipmentMonthLogs.find(
        (row) => row.equipmentId === item.id && row.monthKey === monthKey,
      );
      return { ...item, log, complete: equipmentLogComplete(log) };
    });
  const complete = items.length > 0 && items.every((item) => item.complete);
  return {
    individualId,
    items,
    complete,
    tone: items.length ? monthlyTone(complete, today, monthKey) : "current",
  };
}

export function siteDrillsView(
  collections: MonthlyCollections,
  siteId: string,
  monthKey: string,
) {
  return collections.emergencyDrills
    .filter((row) => row.siteId === siteId && row.monthKey === monthKey)
    .sort((a, b) => a.drillType.localeCompare(b.drillType));
}

export function siteSafetyView(
  collections: MonthlyCollections,
  siteId: string,
  monthKey: string,
) {
  return collections.homeSafetyReports.find(
    (row) => row.siteId === siteId && row.monthKey === monthKey,
  );
}

export function availableMonths(collections: MonthlyCollections, siteId?: string) {
  const keys = new Set<string>();
  for (const row of collections.emergencyDrills) {
    if (!siteId || row.siteId === siteId) keys.add(row.monthKey);
  }
  for (const row of collections.homeSafetyReports) {
    if (!siteId || row.siteId === siteId) keys.add(row.monthKey);
  }
  for (const log of collections.equipmentMonthLogs) {
    const item = collections.adaptiveEquipment.find((row) => row.id === log.equipmentId);
    if (!item) continue;
    keys.add(log.monthKey);
  }
  return [...keys].sort().reverse();
}
