import { DEMO_AGENCY_CODE } from "../data/seed";

/** localStorage flag: the guided demo tour has been seen on this browser. */
export const DEMO_TOUR_SEEN_KEY = "complyrer-demo-tour-seen";

export interface TourStep {
  /** App page the step lives on (must match a sidebar page name). */
  page: string;
  /** data-tour attribute value of the highlighted element. */
  target: string;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    page: "Overview",
    target: "command-center",
    title: "Your agency at a glance",
    body: "One score for the whole agency, with every program site underneath. Anything less than current tells you exactly what to fix.",
  },
  {
    page: "Overview",
    target: "risk-list",
    title: "Risks, ranked",
    body: "Overdue and expired items land here first, so the riskiest gaps never hide behind busywork.",
  },
  {
    page: "Overview",
    target: "due-next",
    title: "What's due next",
    body: "Everything due in the next 7 days, counted down in one place — no more surprises the week of a visit.",
  },
  {
    page: "Training",
    target: "training",
    title: "Staff training, tracked",
    body: "See who's trained, what's expiring, and assign refreshers before a surveyor ever asks.",
  },
  {
    page: "Delegations",
    target: "delegations",
    title: "Delegations without the paper chase",
    body: "RN delegation tasks move from draft to signed staff acknowledgment, with the full trail in one place.",
  },
  {
    page: "Certificates",
    target: "certificates",
    title: "Certificates that watch themselves",
    body: "CPR, CPI, L1MA and more — expiry dates count down automatically so renewals never sneak up.",
  },
  {
    page: "Mileage",
    target: "mileage",
    title: "Mileage, logged as you go",
    body: "Staff log drive miles per site and trip. Totals are ready when reimbursement time comes.",
  },
  {
    page: "Weekly checklist",
    target: "hm-checklist",
    title: "The house manager's week",
    body: "A fresh checklist for every house, every week — completed, signed off, and filed as evidence.",
  },
  {
    page: "Supply forecast",
    target: "med-inventory",
    title: "Meds, counted down",
    body: "Pill counts drop with each pass and low-stock alerts fire before you run out.",
  },
];

/** True when the signed-in session belongs to the fictional demo agency. */
export function isDemoSession(
  session: { agencyCode?: string | null } | null | undefined,
): boolean {
  return session?.agencyCode === DEMO_AGENCY_CODE;
}
