/**
 * The notices the bell already sends, as a pure list. The signed-in app and
 * the unattended sweep both use this so a closed browser does not invent a
 * second set of rules.
 */
import {
  blockForShiftLabel,
  buildSiteDueItems,
  computeMedDueItems,
  computeShiftNoteDueItems,
  shiftBlocksForSite,
  type SiteDueItem,
} from "./dueItems";
import { reminderSlot, prnFollowupStillOpen } from "./lateness";
import { normalizeSiteFacts } from "./siteReview";
import type { OperatingRules } from "./rules";
import type { AloneTimeWindow } from "./types";
import { shiftNoteDeepLink } from "../features/notifications/notify";

export interface OperatingNotice {
  userId: string;
  type: "med.unrecorded" | "documentation.missing_note" | "med.prn_repeat";
  title: string;
  body: string;
  deepLink: string;
  entityId: string;
  entityType: "shift_note" | "medication";
  dedupeKey: string;
}

export interface ReminderMembership {
  userId: string;
  role: string;
  siteId: string | null;
  expiresOn: string | null;
}

/** Active members of the roles, including agency-wide roles with no site. */
export function reminderRecipientIds(
  memberships: ReminderMembership[],
  siteId: string,
  roles: string[],
  today: string,
): string[] {
  const ids = new Set<string>();
  for (const membership of memberships) {
    if (membership.expiresOn && membership.expiresOn < today) continue;
    if (!roles.includes(membership.role)) continue;
    if (membership.siteId && membership.siteId !== siteId) continue;
    ids.add(membership.userId);
  }
  return [...ids];
}

/**
 * Missouri agency clock. The signed-in app uses the browser clock. This job
 * uses Central so a dose at 8:00 a.m. is judged in the agency's day.
 */
export const AGENCY_TIME_ZONE = "America/Chicago";

/** The day, the dose clock, and the notice day the bell and the job share. */
export function dueItemClock(now = new Date()) {
  const clock = agencyClock(now, AGENCY_TIME_ZONE);
  return {
    now,
    serviceDate: clock.yesterday,
    doseDate: clock.today,
    nowMinutes: clock.minutes,
    noteDay: clock.today,
    timeZone: AGENCY_TIME_ZONE,
  };
}

export function agencyClock(now: Date, timeZone = AGENCY_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const today = `${read("year")}-${read("month")}-${read("day")}`;
  let hour = Number(read("hour"));
  if (hour === 24) hour = 0;
  const [year, month, day] = today.split("-").map(Number);
  const previous = new Date(Date.UTC(year, (month || 1) - 1, day || 1));
  previous.setUTCDate(previous.getUTCDate() - 1);
  return {
    today,
    yesterday: previous.toISOString().slice(0, 10),
    minutes: hour * 60 + Number(read("minute")),
  };
}

export function operatingReminderNotices(input: {
  now: Date;
  unrecordedReminderMinutes: number;
  prnReminderRepeatMinutes: number;
  prnFollowupMinutes: number;
  /** Dedupe day. The signed-in app leaves this empty and uses the UTC date. */
  noteDay?: string;
  sites: Array<{
    id: string;
    name: string;
    items: SiteDueItem[];
    medRecipients: string[];
    noteManagers: string[];
  }>;
  prnFollowups: Array<{
    medicationId: string;
    medName: string;
    createdAt: string;
    stillOpen: boolean;
    actorId: string | null;
    homeRecipients: string[];
  }>;
}): OperatingNotice[] {
  const notices: OperatingNotice[] = [];
  const medSlot = reminderSlot(input.now.getTime(), input.unrecordedReminderMinutes);
  const prnSlot = reminderSlot(input.now.getTime(), input.prnReminderRepeatMinutes);
  const noteDay = input.noteDay ?? input.now.toISOString().slice(0, 10);
  for (const site of input.sites) {
    const overdue = site.items.filter((item) => item.kind === "medication" && item.severity === "overdue");
    if (overdue.length > 0) {
      const sample = overdue.slice(0, 3).map((item) => item.line2).join("; ");
      const more = overdue.length > 3 ? ` and ${overdue.length - 3} more` : "";
      const body = `${site.name} has ${overdue.length} unmarked dose${overdue.length === 1 ? "" : "s"} past the window. ${sample}${more}.`;
      for (const userId of site.medRecipients) {
        notices.push({
          userId,
          type: "med.unrecorded",
          title: "Unmarked medication",
          body,
          deepLink: "/meds",
          entityId: site.id,
          entityType: "medication",
          dedupeKey: `med.unrecorded:${site.id}:${userId}:${medSlot}`,
        });
      }
    }
    for (const item of site.items) {
      if (item.kind !== "shift_note" || !item.shift) continue;
      const writerId = item.shift.staffUserId;
      const detail = `${item.line2}. ${item.line3}.`;
      notices.push({
        userId: writerId,
        type: "documentation.missing_note",
        title: "Missing Shift note",
        body: detail,
        deepLink: shiftNoteDeepLink(item.individualId),
        entityId: item.individualId,
        entityType: "shift_note",
        dedupeKey: `documentation.missing_note:${item.id}:${writerId}:${noteDay}`,
      });
      for (const managerId of site.noteManagers) {
        if (managerId === writerId) continue;
        notices.push({
          userId: managerId,
          type: "documentation.missing_note",
          title: "Missing Shift note",
          body: `${site.name}: ${detail}`,
          deepLink: shiftNoteDeepLink(item.individualId),
          entityId: item.individualId,
          entityType: "shift_note",
          dedupeKey: `documentation.missing_note:${item.id}:${managerId}:${noteDay}`,
        });
      }
    }
  }
  for (const followup of input.prnFollowups) {
    if (!followup.stillOpen) continue;
    if (input.now.getTime() < Date.parse(followup.createdAt) + input.prnFollowupMinutes * 60_000) continue;
    const recipients = new Set(followup.homeRecipients);
    if (followup.actorId) recipients.add(followup.actorId);
    for (const userId of recipients) {
      notices.push({
        userId,
        type: "med.prn_repeat",
        title: "PRN follow-up still open",
        body: `Effectiveness follow-up for ${followup.medName} is still open. Record what you saw, or the house is reminded again in ${input.prnReminderRepeatMinutes} minutes.`,
        deepLink: "/meds",
        entityId: followup.medicationId,
        entityType: "medication",
        dedupeKey: `med.prn_repeat:${followup.medicationId}:${userId}:${prnSlot}`,
      });
    }
  }
  return notices;
}

export interface UnattendedAgencyInput {
  now: Date;
  timeZone?: string;
  rules: Pick<
    OperatingRules,
    | "noteGraceMinutes"
    | "medWindowBeforeMinutes"
    | "medWindowAfterMinutes"
    | "unrecordedReminderMinutes"
    | "prnFollowupMinutes"
    | "prnReminderRepeatMinutes"
  >;
  sites: Array<{ id: string; name: string; facts: unknown }>;
  memberships: ReminderMembership[];
  profiles: Array<{ id: string; fullName: string }>;
  individuals: Array<{ id: string; name: string; siteId: string }>;
  notes: Array<{ individualId: string; staffUserId: string; shift: string; noteDate: string }>;
  aloneTime: AloneTimeWindow[];
  medications: Array<{ id: string; name: string; individualId: string; kind: string; strength: string }>;
  doseTimes: Array<{ medicationId: string; doseTimes: string[] }>;
  marks: Array<{ medicationId: string; doseDate: string; doseTime: string; status: string }>;
  /**
   * Hosted and the unattended job treat medication.prn and
   * medication.prn_followup as the dose that was given. The local demo
   * sweep stays on medication.prn only and does not call this function.
   */
  prnEvents: Array<{ action: string; targetId: string | null; actorId: string | null; createdAt: string }>;
}

/**
 * The closed-app list for one agency. Yesterday and the dose clock are
 * Central. The signed-in bell keeps its own clock and calls
 * operatingReminderNotices directly.
 */
export function noticesForAgency(input: UnattendedAgencyInput): OperatingNotice[] {
  const clock = dueItemClock(input.now);
  const timeZone = input.timeZone ?? clock.timeZone;
  const names = new Map(input.profiles.map((profile) => [profile.id, profile.fullName || "Staff"]));
  const sites = input.sites.map((site) => {
    const facts = normalizeSiteFacts((site.facts ?? {}) as Parameters<typeof normalizeSiteFacts>[0]);
    const people = input.individuals.filter((person) => person.siteId === site.id);
    const peopleIds = new Set(people.map((person) => person.id));
    const writers = input.memberships
      .filter((membership) => {
        if (membership.role !== "dsp" || membership.siteId !== site.id) return false;
        return !(membership.expiresOn && membership.expiresOn < clock.doseDate);
      })
      .map((membership) => ({
        userId: membership.userId,
        name: names.get(membership.userId) ?? "Staff",
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const shiftNoteItems = computeShiftNoteDueItems({
      serviceDate: clock.serviceDate,
      now: input.now,
      graceMinutes: input.rules.noteGraceMinutes,
      timeZone,
      blocks: shiftBlocksForSite(facts),
      staffed24h: facts.staffed24h,
      individuals: people.map((person) => ({ id: person.id, name: person.name })),
      requiredWriters: writers,
      notes: input.notes
        .filter((note) => peopleIds.has(note.individualId) && note.noteDate.slice(0, 10) === clock.serviceDate)
        .map((note) => ({
          individualId: note.individualId,
          staffUserId: note.staffUserId,
          blockId: blockForShiftLabel(note.shift),
          noteDate: note.noteDate.slice(0, 10),
        })),
      aloneTime: input.aloneTime.filter((window) => peopleIds.has(window.individualId)),
    });
    const doses = input.medications
      .filter((med) => med.kind === "scheduled" && peopleIds.has(med.individualId))
      .map((med) => ({
        individualId: med.individualId,
        individualName: people.find((person) => person.id === med.individualId)?.name ?? "",
        medicationId: med.id,
        medName: med.name,
        strength: med.strength,
        doseTimes: input.doseTimes.find((row) => row.medicationId === med.id)?.doseTimes ?? [],
      }))
      .filter((dose) => dose.doseTimes.length > 0);
    const medItems = computeMedDueItems({
      doseDate: clock.doseDate,
      nowMinutes: clock.nowMinutes,
      windowBeforeMinutes: input.rules.medWindowBeforeMinutes,
      windowAfterMinutes: input.rules.medWindowAfterMinutes,
      scheduledDoses: doses,
      marks: input.marks.map((mark) => ({
        medicationId: mark.medicationId,
        doseDate: mark.doseDate.slice(0, 10),
        doseTime: mark.doseTime.slice(0, 5),
        status: mark.status as "given",
      })),
    });
    return {
      id: site.id,
      name: site.name,
      items: buildSiteDueItems(shiftNoteItems, medItems),
      medRecipients: reminderRecipientIds(
        input.memberships,
        site.id,
        ["dsp", "house_manager", "administrator", "nurse"],
        clock.doseDate,
      ),
      noteManagers: reminderRecipientIds(input.memberships, site.id, ["house_manager", "administrator"], clock.doseDate),
    };
  });
  const latestGiven = new Map<string, { createdAt: string; actorId: string | null }>();
  for (const event of input.prnEvents) {
    if (!event.targetId) continue;
    if (event.action !== "medication.prn" && event.action !== "medication.prn_followup") continue;
    const previous = latestGiven.get(event.targetId);
    if (!previous || event.createdAt > previous.createdAt) {
      latestGiven.set(event.targetId, { createdAt: event.createdAt, actorId: event.actorId });
    }
  }
  const medById = new Map(input.medications.map((med) => [med.id, med]));
  const homeByPerson = new Map(input.individuals.map((person) => [person.id, person.siteId]));
  return operatingReminderNotices({
    now: input.now,
    noteDay: clock.noteDay,
    unrecordedReminderMinutes: input.rules.unrecordedReminderMinutes,
    prnReminderRepeatMinutes: input.rules.prnReminderRepeatMinutes,
    prnFollowupMinutes: input.rules.prnFollowupMinutes,
    sites,
    prnFollowups: [...latestGiven].flatMap(([medicationId, given]) => {
      const med = medById.get(medicationId);
      if (!med) return [];
      const homeId = homeByPerson.get(med.individualId) ?? null;
      return [{
        medicationId,
        medName: med.name,
        createdAt: given.createdAt,
        stillOpen: prnFollowupStillOpen(input.prnEvents, medicationId, given.createdAt),
        actorId: given.actorId,
        homeRecipients: homeId
          ? reminderRecipientIds(input.memberships, homeId, ["house_manager", "administrator", "nurse"], clock.doseDate)
          : [],
      }];
    }),
  });
}

export { prnFollowupStillOpen };
