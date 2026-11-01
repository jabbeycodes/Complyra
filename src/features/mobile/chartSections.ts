/**
 * Pure helpers for the mobile chart sections (Phase 4): Care Plans,
 * Consents, Life Events. Everything here is a projection over the same
 * data-layer records and status helpers the desktop chart uses — the
 * mobile views render these rows and call the same API methods, so the
 * phone can never disagree with the chart about what a record says.
 */
import {
  canAcknowledgeCare,
  type CarePlan,
  type CareScreeningData,
} from "../../data/careScreening";
import {
  consentOnFile,
  consentOutcomeLabel,
  consentStatus,
  type ConsentRecord,
  type ConsentRegister,
  type ConsentType,
} from "../../data/consents";
import type { LifeEventView } from "../../data/lifeEvents";
import {
  isCompletedRightsPacket,
  rightsPacketStatusFor,
  type RightsPacket,
} from "../../data/rightsPackets";
import { todayStamp } from "../../data/status";

/* ------------------------------ Care plans ------------------------------ */

export interface ChartPlans {
  /** Active and draft plans, in register order (what the chart leads with). */
  current: CarePlan[];
  /** Retired / revised plans (the chart's history, hidden from DSPs). */
  history: CarePlan[];
}

export function chartPlans(data: CareScreeningData): ChartPlans {
  return {
    current: data.plans.filter((plan) =>
      ["active", "draft"].includes(plan.status),
    ),
    history: data.plans.filter((plan) =>
      ["retired", "revised"].includes(plan.status),
    ),
  };
}

/** Whether this user still owes the active plan their acknowledgment. */
export function planAwaitingMyAck(
  data: CareScreeningData,
  plan: CarePlan,
  userId: string,
  roleKey: string,
): boolean {
  return (
    plan.status === "active" &&
    canAcknowledgeCare(roleKey) &&
    !data.acknowledgements.some(
      (ack) => ack.plan_id === plan.id && ack.user_id === userId,
    )
  );
}

export function planAckCount(data: CareScreeningData, planId: string): number {
  return data.acknowledgements.filter((ack) => ack.plan_id === planId).length;
}

/* ------------------------------- Consents ------------------------------- */

export interface ConsentTypeRow {
  type: ConsentType;
  /** Status word exactly as the chart shows it (DSP-masked, see below). */
  status: string;
  /** The recorded decision, or the chart's no-permission wording. */
  decision: string;
  reviewOn: string | null;
  /** Version history for this type, newest first. */
  history: ConsentRecord[];
  /** Heading the chart gives the history disclosure for this role. */
  historyLabel: string;
}

/**
 * One row per consent type for one Individual, mirroring the desktop
 * register cell for cell — including the DSP masking rule: a DSP never
 * sees the word "Missing" (it reads "No active consent available") and
 * their history disclosure is titled "Active consent details".
 */
export function consentTypeRows(
  register: ConsentRegister,
  individualId: string,
  roleKey: string,
): ConsentTypeRow[] {
  return register.types.map((type) => {
    const { row, status } = consentOnFile(register, individualId, type.id);
    const history = register.records
      .filter(
        (record) => record.individualId === individualId && record.typeId === type.id,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return {
      type,
      status: roleKey === "dsp" && status === "Missing" ? "No active consent available" : status,
      decision: row ? consentOutcomeLabel(row.outcome) : "No active permission on file",
      reviewOn: row?.reviewOn ?? null,
      history,
      historyLabel:
        roleKey === "dsp" ? "Active consent details" : `Version history (${history.length})`,
    };
  });
}

export function consentRecordStatus(
  register: ConsentRegister,
  record: ConsentRecord,
): string {
  return consentStatus(record, register.records, register.revocations);
}

/* ---------------------------- Rights packet ---------------------------- */

export interface RightsPacketSummary {
  /**
   * The shared tracking line: a countdown or "Not yet signed".
   * Null while the packet list has not loaded — no verdict exists yet.
   */
  trackingText: string | null;
  state: string;
  packetOn: string | null;
  renewalOn: string | null;
  /** The latest completed packet (drives the countdown), if any. */
  latest: RightsPacket | null;
  /** The open packet awaiting signature, if any. */
  awaiting: RightsPacket | null;
  /** Everything else, newest first — prior years stay in history. */
  history: RightsPacket[];
}

/**
 * The mobile Rights packet card, projected from the same shared
 * selector the desktop chart and the Overview use
 * (rightsPacketStatusFor) — the status is identical on every surface
 * because it is computed in one place. Pass null until the packet
 * list has loaded: the summary is then 'unknown' and carries no
 * tracking line, so the card can never present an unloaded list as
 * "Not yet signed".
 */
export function rightsPacketSummary(
  packets: RightsPacket[] | null,
  today = todayStamp(),
): RightsPacketSummary {
  const status = rightsPacketStatusFor(packets, today);
  const list = packets ?? [];
  const latest =
    status.kind === "signed_current" ||
    status.kind === "signed_renewal_due" ||
    status.kind === "signed_overdue"
      ? status.packet
      : null;
  const awaiting =
    [...list]
      .filter((packet) => packet.status === "awaiting_signature")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  const history = list
    .filter((packet) => packet.id !== latest?.id && packet.id !== awaiting?.id)
    .sort((a, b) =>
      (b.packetOn ?? b.createdAt).localeCompare(a.packetOn ?? a.createdAt),
    );
  return {
    trackingText: status.text,
    state: status.renewal ? status.renewal.state : status.kind === "never_signed" ? "not_signed" : "unknown",
    packetOn: latest?.packetOn ?? null,
    renewalOn: status.renewal?.renewalOn ?? null,
    latest,
    awaiting,
    history,
  };
}

export function rightsHistoryLine(packet: RightsPacket): string {
  return isCompletedRightsPacket(packet)
    ? `Packet date ${packet.packetOn} · signed by ${packet.signer?.printedName} (${packet.signer?.authority}) · ${packet.status}`
    : `Started ${packet.createdAt.slice(0, 10)} · awaiting signature · expected signer ${packet.signerName}`;
}

/* ------------------------------ Life events ----------------------------- */

export interface LifeEventYearGroup {
  year: string;
  rows: LifeEventView[];
}

/** Group the timeline by year, preserving the API's order inside a year. */
export function groupLifeEventsByYear(
  rows: LifeEventView[],
): LifeEventYearGroup[] {
  const groups: LifeEventYearGroup[] = [];
  for (const row of rows) {
    const year = row.eventDate.slice(0, 4);
    const group = groups.find((item) => item.year === year);
    if (group) group.rows.push(row);
    else groups.push({ year, rows: [row] });
  }
  return groups;
}
