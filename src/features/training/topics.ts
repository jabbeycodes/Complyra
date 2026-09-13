/**
 * LIFEPATH-P2 seed data: training topics.
 *
 * The ~65 in-home checklist topics are transcribed VERBATIM from
 * ~/workspace/lifepath-docs/extracted/staff-in-home-training-checklist.md.
 * Supplemental sets come verbatim from EXTRACTION_NOTES.md sections A1–A6
 * (G-tube competency, Lawton House expectations, HM weekly checklist items,
 * corrective refresher topics, task-specific acknowledgments).
 *
 * Seeds live in code (not Supabase) so LocalApi and HostedApi serve identical
 * topics. Individual-specific templates use the [Individual] placeholder,
 * replaced with the individual's name at assignment time.
 */
import type { TrainingTopic } from "../../data/types";

function checklist(id: string, section: 1 | 2 | 3 | 4 | 5 | 6, title: string): TrainingTopic {
  return {
    id,
    section,
    title,
    perIndividual: section === 6,
    scope: "agency",
    reusableTemplate: false,
    source: "checklist",
    setName: "In-home training checklist",
  };
}

const CHECKLIST_TOPICS: TrainingTopic[] = [
  // ---- Section 1: General Information ----
  checklist("chk-1-01", 1, "Chain of Command, including Contacts and Expectations"),
  checklist("chk-1-02", 1, "When to Call Nursing and Policy (LPMM-207)"),
  checklist("chk-1-03", 1, "Performance Plan expectations"),
  checklist("chk-1-04", 1, "Timekeeping/Payroll"),
  checklist("chk-1-05", 1, "Therap Documentation Deadline"),
  checklist("chk-1-06", 1, "Call-in Procedure (LPMM-110)"),
  checklist("chk-1-07", 1, "PTO Procedure (if applicable), 90-day Probationary Period"),
  checklist("chk-1-08", 1, "Disciplinary Guidelines"),
  checklist("chk-1-09", 1, "Smoking Protocol/Cigarette Disposal"),
  checklist("chk-1-10", 1, "Dress Code, including close-toed shoes"),
  // ---- Section 2: Locations ----
  checklist("chk-2-01", 2, "Individual Books/Training Plans"),
  checklist("chk-2-02", 2, "MARs"),
  checklist("chk-2-03", 2, "Medication Storage"),
  checklist("chk-2-04", 2, "Controlled Medications"),
  checklist("chk-2-05", 2, "Forms"),
  checklist("chk-2-06", 2, "First Aid Kit"),
  checklist("chk-2-07", 2, "CPR Face Masks"),
  checklist("chk-2-08", 2, "Emergency Phone Numbers"),
  checklist("chk-2-09", 2, "Emergency Exit Maps"),
  checklist("chk-2-10", 2, "Emergency Kit/Supplies"),
  checklist(
    "chk-2-11",
    2,
    "Breaker Box, Gas Line Cutoffs, Water Valves, Fire Extinguishers, Keys",
  ),
  // ---- Section 3: Vehicle ----
  checklist("chk-3-01", 3, "Mileage Log"),
  checklist("chk-3-02", 3, "Policies Specific to Vehicles (LPMM-108)"),
  checklist("chk-3-03", 3, "Vehicle Accident Procedure"),
  checklist("chk-3-04", 3, "Car Maintenance (including Fuel)"),
  checklist("chk-3-05", 3, "Transportation of Specific Individuals"),
  checklist("chk-3-06", 3, "Lifts/Adaptive Equipment"),
  checklist(
    "chk-3-07",
    3,
    "Location of First Aid Kit, CPR Face Masks, Emergency Roadside Kit, Fire Extinguisher",
  ),
  // ---- Section 4: Emergency Procedures ----
  checklist("chk-4-01", 4, "Emergency Procedure-Fire"),
  checklist("chk-4-02", 4, "Health and Medical Procedures"),
  checklist("chk-4-03", 4, "Hazard/Exposure Plan"),
  checklist("chk-4-04", 4, "Procedure of Missing/Runaway Individual"),
  checklist("chk-4-05", 4, "Severe Weather Protocols (Storms, Tornadoes, Floods, Earthquakes, etc.)"),
  checklist("chk-4-06", 4, "Med Sled Video (Practice should occur ONLY with the House Manager)"),
  checklist("chk-4-07", 4, "Location of Smoke Alarms, Carbon Monoxide Detectors"),
  checklist("chk-4-08", 4, "Water Temperature Check and Water Heater Controls"),
  // ---- Section 5: Staff Duties ----
  checklist("chk-5-01", 5, "Cleaning Duties, including how to use and care for Appliances"),
  checklist("chk-5-02", 5, "Trash Pick-up Day"),
  checklist("chk-5-03", 5, "Menu Planning, Meal Routines"),
  checklist("chk-5-04", 5, "Daily ISP Data and Notes"),
  checklist("chk-5-05", 5, "Annual Individual Training Plan Checklists, including Nursing Delegations"),
  checklist("chk-5-06", 5, "MARs Documentation, including BM Logs, Vitals, Seizure Logs, etc."),
  checklist("chk-5-07", 5, "Controlled Medication Count Sheet and Procedure"),
  checklist("chk-5-08", 5, "General Event Reports (GER)"),
  checklist("chk-5-09", 5, "Location of Money/Cards, Receipts, Logs"),
  checklist("chk-5-10", 5, "Community Integration, including Activities and Socialization"),
  checklist("chk-5-11", 5, "Promoting Self-Determination and Independence"),
  checklist(
    "chk-5-12",
    5,
    "Review of Rights of Individuals/Home and Community Based Staff Training (HCBS)",
  ),
  checklist("chk-5-13", 5, "Procedure of Reporting Abuse/Neglect"),
  checklist("chk-5-14", 5, "Positive Approach to Programming"),
  checklist("chk-5-15", 5, "Teamwork and Communication"),
  checklist("chk-5-16", 5, "Ethics and Mission Statement"),
  checklist("chk-5-17", 5, "Professionalism in the Workplace"),
  // ---- Section 6: Individualized Trainings (once per individual) ----
  checklist("chk-6-01", 6, "Review of Personal Likes/Dislikes"),
  checklist("chk-6-02", 6, "Review of Communication Style"),
  checklist("chk-6-03", 6, "Supports Needed, including Degree of Protective Oversight"),
  checklist("chk-6-04", 6, "Special Needs, including Wheelchair & Transfer Procedure"),
  checklist("chk-6-05", 6, "Nursing Protocols, including Seizure, BM, Choking, etc."),
  checklist("chk-6-06", 6, "Bathing Schedule/Procedure"),
  checklist("chk-6-07", 6, "Special Diets"),
  checklist("chk-6-08", 6, "Guardianship Status & Authorized Family Contacts"),
  checklist("chk-6-09", 6, "Behavioral Support Plans"),
  checklist("chk-6-10", 6, "Medications & General Health Information"),
  checklist("chk-6-11", 6, "Employment/Day Placements"),
  checklist("chk-6-12", 6, "Vitals Signs/Equipment, including Glucometer Training"),
];

function supplemental(
  id: string,
  section: 1 | 2 | 3 | 4 | 5 | 6,
  title: string,
  setName: string,
  opts: { perIndividual?: boolean; scope?: "agency" | "site"; reusableTemplate?: boolean } = {},
): TrainingTopic {
  return {
    id,
    section,
    title,
    perIndividual: opts.perIndividual ?? false,
    scope: opts.scope ?? "agency",
    reusableTemplate: opts.reusableTemplate ?? false,
    source: "supplemental",
    setName,
  };
}

/**
 * A1 — Safety & Training Plan: G-tube Medication Administration.
 * Individual-specific in the source; stored as a reusable per-individual
 * template with the [Individual] placeholder (Joshua's build decision:
 * "G-tube competency as reusable template").
 */
const GTUBE_TOPICS: TrainingTopic[] = [
  supplemental(
    "gt-01",
    5,
    "Be certified in Medication Administration (Level I or higher as required by Missouri DMH regulations).",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-02",
    5,
    "Receive hands-on G-tube training from a licensed nurse or DPM before administering any medication via G-tube.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-03",
    5,
    "Complete annual refresher training and competency assessments.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-04",
    5,
    "Review [Individual]'s Individual Support Plan (ISP) and Medication Administration Record (MAR) to understand his/her specific medical needs.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-05",
    5,
    "Competency validation: correct identification of [Individual] and his/her medications.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-06",
    5,
    "Competency validation: proper handwashing and glove use.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-07",
    5,
    "Competency validation: accurate preparation of medications (crushing, diluting, labeling, etc.).",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-08",
    5,
    "Competency validation: safe connection/disconnection of G-tube.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-09",
    5,
    "Competency validation: proper flushing procedures (before, between, and after meds).",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-10",
    5,
    "Competency validation: accurate documentation in the MAR and Therap.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-11",
    5,
    "Competency validation: correct response to common G-tube issues (leakage, blockage, dislodgement).",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-12",
    4,
    "Emergency preparedness: recognize signs of complications (e.g., leakage, redness, swelling, clogged tube, or pain).",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-13",
    4,
    "Emergency preparedness: stop the procedure immediately and contact on-call nurse/HM/DPM if issues arise.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-14",
    4,
    "Emergency preparedness: call 911 if the G-tube becomes dislodged or [Individual] shows signs of respiratory distress, vomiting, or altered consciousness.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-15",
    4,
    "Emergency preparedness: maintain emergency supplies (syringes, extension sets, gloves, sterile water) in a designated, clearly labeled area.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-16",
    5,
    "Infection control: always wash hands before and after medication administration.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-17",
    5,
    "Infection control: use clean equipment for every administration.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-18",
    5,
    "Infection control: store medications properly, following instructions for temperature and expiration dates.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-19",
    5,
    "Infection control: disinfect surfaces before and after each procedure.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-20",
    5,
    "Documentation & communication: document each administration in the MAR immediately after giving medication.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-21",
    5,
    "Documentation & communication: if medication is refused, spilled, or delayed, include a detailed explanation in the comments.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-22",
    5,
    "Documentation & communication: notify the House Manager and DPM immediately of any changes in the G-tube site or unusual reactions.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-23",
    5,
    "Documentation & communication: include G-tube care and medication notes in shift handovers to ensure continuity of care.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
];

/** A2 — Lawton House Staff Expectations (house-specific, English only per build decision). */
const LAWTON_TOPICS: TrainingTopic[] = [
  supplemental(
    "law-01",
    5,
    "Unified Support — all staff involved in care of both individuals equally.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-02",
    5,
    "Respectful behavior — treat individuals and colleagues with respect and professionalism.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-03",
    1,
    "Dress code — presentable attire; no slippers.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-04",
    5,
    "Note writing — complete and submit notes accurately; start at least 15 minutes before shift ends; submitted right after shift.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-05",
    5,
    "Daily check-ins — HM checks notes daily before 12:00 midnight; all documentation up-to-date by then.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-06",
    1,
    "Chain of command — follow proper chain of command for reporting and issues.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-07",
    5,
    "Equal attention to both individuals regardless of informal assignments.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-08",
    5,
    "Medication administration — for liquid medications, one staff member must act as an observer to ensure accuracy.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-09",
    5,
    "Overnight shifts — check each individual at least every 2–3 hours.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-10",
    5,
    "Phone usage — limit phone calls during shifts.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-11",
    5,
    "Breaks and supervision — no staff in backyard continuously >15 min without a second staff member present in the house.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-12",
    5,
    "One-on-one training — HM meets each staff during their shift to redo note writing training and discuss personal expectations.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-13",
    5,
    "Responsibility — be proactive; know and comply with all expectations and policies.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-14",
    5,
    "Clean environment after each shift.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-15",
    4,
    "Emergency preparedness — be familiar with emergency procedures; safety equipment checked regularly.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
];

/** A3 — training-compliance items lifted from the HM Weekly Checklist. */
const HM_WEEKLY_TOPICS: TrainingTopic[] = [
  supplemental(
    "hmw-01",
    5,
    "All staff have been properly trained and signed off on all trainings/delegations.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-02",
    5,
    "Staff daily documentation is checked — if missing, addressed and then re-verified.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-03",
    5,
    "MAR checked daily for missing initials and PRN documentation.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-04",
    5,
    "Physician ordered vital signs are documented in Therap as prescribed.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-05",
    5,
    "BMs documented in Therap on each shift and PRN medications administered per BM protocol.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-06",
    6,
    "Evidence that rights restrictions are being followed (i.e. knives are locked up, internet is restricted).",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-07",
    4,
    "Smoke detectors/water temp/CO2 monitors/fire extinguishers checked.",
    "HM weekly checklist training items",
  ),
  supplemental("hmw-08", 4, "Drills completed according to drill schedule.", "HM weekly checklist training items"),
  supplemental(
    "hmw-09",
    2,
    "First Aid Kit and CPR face shields in home and car – no products expired.",
    "HM weekly checklist training items",
  ),
];

/** A5 — mandatory corrective refresher topics (Plan of Correction, T.M.). */
const CORRECTIVE_TOPICS: TrainingTopic[] = [
  supplemental(
    "cor-01",
    5,
    "Definitions of abuse and neglect under CSR 10-5.200.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-02",
    5,
    "Agency policy on Misuse of Funds/Property.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-03",
    5,
    "Agency policy on Leaving Individuals Alone.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-04",
    5,
    "Case examples of what is and is not permitted.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-05",
    5,
    "Signed acknowledgment forms maintained in personnel files; short knowledge check for comprehension.",
    "Corrective refresher topics",
  ),
];

/** A6 — task-specific training acknowledgments on file. */
const ACK_TOPICS: TrainingTopic[] = [
  supplemental(
    "ack-wheelchair",
    6,
    "I have read, understood, and had the opportunity to ask questions on how to assist [Individual] with his/her wheelchair (tie-downs).",
    "Task-specific acknowledgments",
    { perIndividual: true },
  ),
  supplemental(
    "ack-bsp",
    6,
    "I acknowledge that I have received training and reviewed the Behavior Support Plan (BSP) for [Individual].",
    "Task-specific acknowledgments",
    { perIndividual: true },
  ),
  supplemental(
    "ack-isp",
    6,
    "I have read and understood the Annual Person-Centered Support Plan (PCSP) for [Individual], implemented on [date]. I had the opportunity to ask questions and receive clarification.",
    "Task-specific acknowledgments",
    { perIndividual: true },
  ),
];

export const TRAINING_TOPICS: TrainingTopic[] = [
  ...CHECKLIST_TOPICS,
  ...GTUBE_TOPICS,
  ...LAWTON_TOPICS,
  ...HM_WEEKLY_TOPICS,
  ...CORRECTIVE_TOPICS,
  ...ACK_TOPICS,
];

export const TRAINING_TOPIC_BY_ID: Record<string, TrainingTopic> = Object.fromEntries(
  TRAINING_TOPICS.map((topic) => [topic.id, topic]),
);

/** Full checklist: sections 1–5 once per staff per site. */
export function siteChecklistTopics(): TrainingTopic[] {
  return TRAINING_TOPICS.filter(
    (topic) => topic.source === "checklist" && topic.section >= 1 && topic.section <= 5,
  );
}

/** Section 6: once per staff per individual. */
export function individualChecklistTopics(): TrainingTopic[] {
  return TRAINING_TOPICS.filter((topic) => topic.source === "checklist" && topic.section === 6);
}

/** Retraining targets when a plan/document version changes for an individual. */
export function planUpdateRetrainingTopicIds(): string[] {
  return ["ack-isp", "ack-bsp"];
}

/** Render an individual-specific template title with the individual's name. */
export function renderTopicTitle(topic: TrainingTopic, individualName?: string | null): string {
  if (!individualName) return topic.title;
  return topic.title.replaceAll("[Individual]", individualName);
}
