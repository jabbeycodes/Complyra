/**
 * Mobile shell tiles — the role-filtered home grid.
 *
 * A tile renders ONLY when the signed-in role can actually use the surface
 * behind it; gates reuse the same helpers the desktop app uses, so the grid
 * can never offer a door the API would refuse. Tiles whose module does not
 * exist on main (Messages, Event Reports, Time Off) are deliberately absent
 * rather than dead links.
 */
import { canSeeMeds } from "../../data/chart";
import { canSeeShiftNotes } from "../../data/permissions";

export type MobileTileId =
  | "medications"
  | "shiftNotes"
  | "ispData"
  | "timeClock"
  | "myTasks"
  | "individuals"
  | "appointments"
  | "checklists"
  | "medCount";

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
    id: "shiftNotes",
    label: "Shift Notes",
    hint: "Today's notes for this home",
    visible: (ctx) => canSeeShiftNotes(ctx.roleKey),
  },
  {
    id: "ispData",
    label: "ISP Data",
    hint: "Collect data on plan tasks",
    visible: (ctx) => canSeeShiftNotes(ctx.roleKey),
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
    id: "medCount",
    label: "Med Count",
    hint: "Counts and supply on hand",
    visible: (ctx) => ctx.canPage("Supply forecast"),
  },
];

/** Tiles for this user, in daily-driver order (DSP/HM first). */
export function mobileTiles(ctx: MobileTileContext): MobileTile[] {
  return TILE_DEFS.filter((tile) => tile.visible(ctx)).map(
    ({ id, label, hint }) => ({ id, label, hint }),
  );
}
