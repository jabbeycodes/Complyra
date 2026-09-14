/**
 * schedule-hm-checklists — the 26 weekly checklist item definitions.
 *
 * MIRRORED from src/data/hmChecklist.ts (WEEKLY_CHECKLIST_ITEMS / ITEM_21_KEY):
 * the edge function runs in Deno and cannot import the Vite client tree, so
 * the prompts are duplicated here. If the wording changes client-side, update
 * this file to match. Row keys ("c1".."c26") are stable for data
 * compatibility.
 */

export const ITEM_21_KEY = "c21";

export const WEEKLY_CHECKLIST_ITEMS: Array<{ key: string; prompt: string }> = [
  {
    key: "c1",
    prompt:
      "Daily staff documentation reviewed \u2014 gaps addressed, then re-verified",
  },
  {
    key: "c2",
    prompt:
      "Timesheets verified \u2014 all hours logged, errors fixed, no early or late clock-ins",
  },
  {
    key: "c3",
    prompt:
      "Medication Administration Record (MAR) checked daily for missing initials and PRN entries",
  },
  {
    key: "c4",
    prompt:
      "Enough medications and medical supplies on hand in the home",
  },
  { key: "c5", prompt: "PRN medications present in the home and unexpired" },
  {
    key: "c6",
    prompt:
      "Doctor-ordered vital signs charted in Therap as prescribed (* List ordered vitals: ___)",
  },
  {
    key: "c7",
    prompt:
      "Bowel movements charted in Therap on each shift and PRN medications given per bowel protocol",
  },
  {
    key: "c8",
    prompt: "General home walkthrough \u2014 clean, pathways clear, no hazards",
  },
  {
    key: "c9",
    prompt:
      "Maintenance issues \u2014 file a work order for any outstanding items (* List outstanding issues)",
  },
  {
    key: "c10",
    prompt: "Vehicle checked \u2014 clean (inside and out), maintenance up to date",
  },
  { key: "c11", prompt: "House mailbox checked \u2014 admin mail delivered to the office" },
  {
    key: "c12",
    prompt:
      "Medical appointment records scanned into Therap within 24 hours of the appointment",
  },
  {
    key: "c13",
    prompt:
      "Appointment notes filed in the individual's office record book and copied to the home record book",
  },
  { key: "c14", prompt: "Groceries and household supplies well stocked" },
  { key: "c15", prompt: "Adaptive equipment logs current" },
  { key: "c16", prompt: "Daily census logs and variance reports up to date" },
  { key: "c17", prompt: "Emails and texts checked \u2014 replies sent promptly" },
  {
    key: "c18",
    prompt:
      "All spending cards in the home and available to the individual \u2014 every receipt accounted for",
  },
  {
    key: "c19",
    prompt: "Pharmacy pickups checked for medication changes \u2014 RN contacted if anything changed",
  },
  {
    key: "c20",
    prompt: "Monthly reviews and RN assessments filed in the home record book",
  },
  {
    key: "c21",
    prompt:
      "All staff fully trained and signed off on trainings and delegations",
  },
  {
    key: "c22",
    prompt:
      "Smoke detectors, water temperature, CO monitors, and fire extinguishers checked",
  },
  { key: "c23", prompt: "Drills completed per the drill schedule" },
  {
    key: "c24",
    prompt:
      "First aid kits and CPR face shields in home and vehicle \u2014 nothing expired",
  },
  {
    key: "c25",
    prompt:
      "Time spent with staff and individuals \u2014 building rapport, providing oversight, addressing concerns",
  },
  {
    key: "c26",
    prompt:
      "Rights restrictions visibly followed (e.g., knives secured, internet limited)",
  },
];

/** Fresh 26-row item set for a scheduler-created week instance (all unanswered). */
export function buildSchedulerChecklistItems(): Array<{
  key: string;
  prompt: string;
  answer: null;
  note: string;
  autoComputed: boolean;
}> {
  return WEEKLY_CHECKLIST_ITEMS.map((def) => ({
    key: def.key,
    prompt: def.prompt,
    answer: null,
    note: "",
    autoComputed: def.key === ITEM_21_KEY,
  }));
}
