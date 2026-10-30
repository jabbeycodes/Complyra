/**
 * Mobile shell tiles — the role-filtered home grid.
 *
 * A tile renders ONLY when the signed-in role can actually use the surface
 * behind it; gates reuse the same helpers the desktop app uses, so the grid
 * can never offer a door the API would refuse. Tiles whose module does not
 * exist on main (Event Reports, Time Off) are deliberately absent rather
 * than dead links.
 *
 * There is deliberately no separate "Shift Notes" tile: in ComplyRer's
 * model a shift note IS an ISP data entry (the ISP flow saves through
 * saveShiftNote), so ISP Data is the single door for both reading and
 * writing a home's shift notes on mobile.
 *
 * There is likewise no separate "Med Count" tile: the count belongs
 * under Medications — every medication row in the MAR carries its own
 * supply countdown, and managers reset it there when a refill comes in.
 */
import { canSeeMeds } from "../../data/chart";
import { canSeeShiftNotes } from "../../data/permissions";
import { fieldLogAccess } from "./fieldLogs";

export type MobileTileId =
  | "medications"
  | "ispData"
  | "health"
  | "quickLog"
  | "messages"
  | "scheduling"
  | "timeClock"
  | "myTasks"
  | "individuals"
  | "appointments"
  | "checklists"
  | "houseCard";

export interface MobileTile {
  id: MobileTileId;
  label: string;
  hint: string;
}

export interface MobileTileContext {
  roleKey: string;
  permissions: Record<string, boolean>;
  /** App's pageVisible(session, page) — the desktop page gate. */
  canPage: (page: string) => boolean;
}

const TILE_DEFS: {
  id: MobileTileId;
  label: string;
  hint: string;
  visible: (ctx: MobileTileContext) => boolean;
}[] = [
  {
    id: "medications",
    label: "Medications",
    hint: "Pass meds and record doses",
    visible: (ctx) => canSeeMeds(ctx.roleKey),
  },
  {
    id: "ispData",
    label: "ISP Data",
    hint: "Collect data on plan tasks",
    visible: (ctx) => canSeeShiftNotes(ctx.roleKey),
  },
  {
    // HEALTH: the seven day-to-day trackers (intake, elimination, vitals,
    // glucose, skin, seizures, menses) as a phone view over the chart's
    // health-entry store. The gate mirrors canViewHealthTrack in
    // data/healthTrack (chart read access: individuals.view, and never
    // HR); recording inside follows the chart's health.record permission,
    // so view-only roles such as auditors see statuses with no log actions.
    id: "health",
    label: "Health",
    hint: "Vitals, intake, seizures & more",
    visible: (ctx) =>
      ctx.permissions["individuals.view"] === true && ctx.roleKey !== "hr",
  },
  {
    // QUICK LOG: one door for the field logs — health trackers, menu
    // records, mileage, drills, incident (GER) reports. The gate is
    // "can record in at least one domain, or can view health,"
    // computed from the same helpers and permission keys the desktop
    // surfaces use (fieldLogAccess), so the tile never offers a door
    // the API would refuse. A health-only viewer (an auditor, say)
    // gets the tile with the read surfaces their flags allow — health
    // statuses and filed GERs — and no recording door.
    id: "quickLog",
    label: "Quick log",
    hint: "Menu, mileage, drills & incidents",
    visible: (ctx) => fieldLogAccess(ctx.roleKey, ctx.permissions).any,
  },
  {
    // MESSAGES: staff-to-staff conversations. The gate restates
    // canUseMessaging (data/permissions) — the exact rule the desktop
    // page gate (pageVisible → "Messages") and both API layers enforce:
    // the messages.use permission AND never the auditor role. The role
    // half is deliberate defense in depth (PR #121): messaging is staff
    // communication, not a compliance record surface, so even if the
    // permission is mistakenly granted on the auditor template, no tile
    // renders and the view stays unreachable. (Checked against the
    // session's complete permission map, like the health tile above.)
    id: "messages",
    label: "Messages",
    hint: "Conversations with staff",
    visible: (ctx) =>
      ctx.roleKey !== "auditor" && ctx.permissions["messages.use"] === true,
  },
  {
    // SCHEDULING: the manager's week coverage board with the engine's
    // per-shift accountability lines. The gate is the desktop page gate
    // itself (pageVisible "Scheduling": house managers, program
    // managers, agency administrators — DSPs, nurses, and auditors
    // never see it). Site scope inside follows the desktop page:
    // sitesVisibleTo (an HM's own houses; PM/admin every house).
    id: "scheduling",
    label: "Scheduling",
    hint: "Week coverage & accountability",
    visible: (ctx) => ctx.canPage("Scheduling"),
  },
  {
    id: "timeClock",
    label: "Time Clock",
    hint: "Shifts, punches and time off",
    visible: (ctx) => ctx.permissions["hub.access"] === true,
  },
  {
    id: "myTasks",
    label: "My Tasks",
    hint: "What is due for you",
    visible: () => true,
  },
  {
    id: "individuals",
    label: "Individuals",
    hint: "People at this home",
    visible: (ctx) => ctx.permissions["individuals.view"] === true,
  },
  {
    id: "appointments",
    label: "Appointments",
    hint: "Visits and follow-ups",
    visible: (ctx) => ctx.canPage("Appointments"),
  },
  {
    id: "checklists",
    label: "Checklists",
    hint: "Weekly house checklist",
    visible: (ctx) => ctx.canPage("Weekly checklist"),
  },
  {
    // HOUSE CARD: daily recording is phone-first, so the home's petty
    // cash ledger gets a tile. The gate is the desktop page gate itself
    // (role list: DSP/HM record, PM/admin reach every home, auditors
    // read; nurses never see it).
    id: "houseCard",
    label: "House Card",
    hint: "Log house card spending",
    visible: (ctx) => ctx.canPage("House Card"),
  },
];

/** Tiles for this user, in daily-driver order (DSP/HM first). */
export function mobileTiles(ctx: MobileTileContext): MobileTile[] {
  return TILE_DEFS.filter((tile) => tile.visible(ctx)).map(
    ({ id, label, hint }) => ({ id, label, hint }),
  );
}
