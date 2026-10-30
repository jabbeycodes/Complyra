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
  | "myHub"
  | "myTasks"
  | "individuals"
  | "appointments"
  | "checklists"
  | "houseCard"
  | "reports"
  | "qaReview";

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
    // records, mileage, drills, incident (GER) reports — and the
    // expenditure trackers (house card, personal spending). The gate
    // is "can record in at least one domain, or can view health, or
    // can view either money tracker," computed from the same helpers
    // and permission keys the desktop surfaces use (fieldLogAccess),
    // so the tile never offers a door the API would refuse. A
    // view-only user (an auditor, say) gets the tile with the read
    // surfaces their flags allow — health statuses, filed GERs, the
    // money views — and no recording door.
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
    // MY HUB (Phase 4b): the employee's self-service hub in the shell —
    // my compliance detail, time off, my New Hire Binder (with phone
    // uploads), my performance file, and documents with acknowledgment
    // signing. The gate is the desktop Employee Hub page's own gate
    // (hub.access — the same permission the Time Clock tile uses; that
    // tile still opens the full desktop hub for punches/schedule and
    // the manager tabs). Inside, sections follow the desktop hub's
    // rules — auditors are excluded from Time Off, exactly as there.
    id: "myHub",
    label: "My Hub",
    hint: "Time off, binder, documents & more",
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
  {
    // REPORT LIBRARY (Phase 4b): the manager read/run surface. The
    // gate is the desktop page gate itself (pageVisible "Report
    // Library" — the REPORT_LIBRARY_ROLES list: administrator,
    // compliance_admin, PM, HM, nurse, auditor; DSP and HR never see
    // it). Inside, each entry keeps its own per-report role list via
    // reportsForRole, exactly as the desktop page filters.
    id: "reports",
    label: "Report Library",
    hint: "Run and print reports",
    visible: (ctx) => ctx.canPage("Report Library"),
  },
  {
    // QA REVIEW (Phase 4b): read-first audits for the picked home. The
    // gate is the desktop page gate itself (pageVisible "QA Review":
    // qa.audit / qa.dispute / qa.schedule / audit.read permissions).
    // Scoring and photo disputes stay on the desktop page; the one
    // action inside is the auditor's finalize-with-signature.
    id: "qaReview",
    label: "QA Review",
    hint: "Quarterly audits for this home",
    visible: (ctx) => ctx.canPage("QA Review"),
  },
];

/** Tiles for this user, in daily-driver order (DSP/HM first). */
export function mobileTiles(ctx: MobileTileContext): MobileTile[] {
  return TILE_DEFS.filter((tile) => tile.visible(ctx)).map(
    ({ id, label, hint }) => ({ id, label, hint }),
  );
}
