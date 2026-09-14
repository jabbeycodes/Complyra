/**
 * Complyrer-original training topics (P2 seed data).
 *
 * Every topic carries the SAME training content and coverage as the legacy
 * agency documents they replace, but in Complyrer's own WORDING and ORDER —
 * no item mirrors a source document's phrasing or sequence. Topic `id`s and
 * `section` numbers are stable (data compatibility); only titles were
 * rewritten and the within-section order reshuffled. See
 * docs/coverage-map.md for the original → new wording map.
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
  // ---- Section 1: getting started & agency policies ----
  checklist("chk-1-04", 1, "Clocking in and payroll basics"),
  checklist("chk-1-10", 1, "Dress code, including closed-toe shoes"),
  checklist("chk-1-01", 1, "Reporting lines, key contacts, and staff expectations"),
  checklist("chk-1-06", 1, "Calling in sick or late — the call-in procedure (LPMM-110)"),
  checklist("chk-1-02", 1, "When to call nursing, and the related policy (LPMM-207)"),
  checklist("chk-1-05", 1, "Therap documentation cut-off times"),
  checklist("chk-1-07", 1, "Probationary period (90 days), and PTO procedure where it applies"),
  checklist("chk-1-03", 1, "What your performance plan requires"),
  checklist("chk-1-08", 1, "Progressive discipline guidelines"),
  checklist("chk-1-09", 1, "Smoking rules and cigarette disposal"),
  // ---- Section 2: around the home ----
  checklist("chk-2-08", 2, "Posted emergency phone numbers"),
  checklist("chk-2-09", 2, "Emergency exit maps and evacuation routes"),
  checklist("chk-2-06", 2, "First aid kit — location and contents"),
  checklist("chk-2-07", 2, "CPR face masks / shields"),
  checklist("chk-2-10", 2, "Emergency kit and backup supplies"),
  checklist("chk-2-02", 2, "Medication administration records (MARs)"),
  checklist("chk-2-03", 2, "Where medications are stored and secured"),
  checklist("chk-2-04", 2, "Controlled-medication storage and handling"),
  checklist("chk-2-11", 2, "Utility shutoffs, fire extinguishers, and house keys"),
  checklist("chk-2-01", 2, "Individual record books and training plans"),
  checklist("chk-2-05", 2, "Blank forms and where to find them"),
  // ---- Section 3: vehicle use ----
  checklist("chk-3-05", 3, "Transporting individuals safely"),
  checklist("chk-3-06", 3, "Wheelchair lifts and adaptive equipment"),
  checklist("chk-3-01", 3, "Logging mileage for every trip"),
  checklist("chk-3-04", 3, "Vehicle upkeep and fueling"),
  checklist("chk-3-03", 3, "What to do after a vehicle accident"),
  checklist("chk-3-02", 3, "Vehicle policies (LPMM-108)"),
  checklist("chk-3-07", 3, "Emergency gear in the vehicle: first aid kit, CPR masks, roadside kit, fire extinguisher"),
  // ---- Section 4: emergencies ----
  checklist("chk-4-05", 4, "Severe weather response — storms, tornadoes, floods, earthquakes"),
  checklist("chk-4-01", 4, "Fire emergency response"),
  checklist("chk-4-07", 4, "Smoke and carbon monoxide alarm locations"),
  checklist("chk-4-04", 4, "Missing-individual procedure"),
  checklist("chk-4-02", 4, "Health and medical emergency procedures"),
  checklist("chk-4-03", 4, "Hazardous-material exposure plan"),
  checklist("chk-4-08", 4, "Hot-water temperature checks and water heater controls"),
  checklist("chk-4-06", 4, "Med sled video, plus hands-on practice with the house manager only"),
  // ---- Section 5: daily duties ----
  checklist("chk-5-04", 5, "Daily support-plan data and shift notes"),
  checklist("chk-5-06", 5, "MAR documentation, including bowel logs, vitals, and seizure logs"),
  checklist("chk-5-07", 5, "Controlled-medication count procedure"),
  checklist("chk-5-08", 5, "General event reports (GERs) — when and how to write them"),
  checklist("chk-5-05", 5, "Annual training-plan checklists and nursing delegations"),
  checklist("chk-5-13", 5, "Reporting abuse and neglect"),
  checklist("chk-5-12", 5, "Individual rights and home/community-based services (HCBS) training"),
  checklist("chk-5-14", 5, "Positive approaches to support"),
  checklist("chk-5-11", 5, "Supporting self-determination and independence"),
  checklist("chk-5-10", 5, "Community integration — activities and socialization"),
  checklist("chk-5-09", 5, "Individual funds: cards, cash, receipts, and logs"),
  checklist("chk-5-03", 5, "Meal planning and mealtime routines"),
  checklist("chk-5-01", 5, "House cleaning duties and appliance care"),
  checklist("chk-5-02", 5, "Trash and recycling pickup days"),
  checklist("chk-5-15", 5, "Teamwork and shift communication"),
  checklist("chk-5-16", 5, "Ethics and the agency mission"),
  checklist("chk-5-17", 5, "Professional conduct at work"),
  // ---- Section 6: individual-specific training (once per individual) ----
  checklist("chk-6-10", 6, "Medications and general health information"),
  checklist("chk-6-05", 6, "Nursing protocols — seizure, bowel, choking response, and others"),
  checklist("chk-6-04", 6, "Special needs, including wheelchair and transfer procedures"),
  checklist("chk-6-06", 6, "Bathing schedule and procedure"),
  checklist("chk-6-07", 6, "Special diets and mealtime supports"),
  checklist("chk-6-03", 6, "Support needs and level of protective oversight"),
  checklist("chk-6-01", 6, "Personal likes and dislikes"),
  checklist("chk-6-02", 6, "Communication style and preferences"),
  checklist("chk-6-08", 6, "Guardianship status and approved family contacts"),
  checklist("chk-6-09", 6, "Behavior support plans (BSP)"),
  checklist("chk-6-11", 6, "Employment and day program placements"),
  checklist("chk-6-12", 6, "Vital signs and equipment, including glucometer use"),
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
 * Content coverage identical to the source plan; wording is Complyrer's own.
 */
const GTUBE_TOPICS: TrainingTopic[] = [
  supplemental(
    "gt-01",
    5,
    "Hold medication-administration certification at Level I or higher, as Missouri DMH regulations require.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-02",
    5,
    "Get hands-on G-tube training from a licensed nurse or DPM before giving any medication through a G-tube.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-03",
    5,
    "Finish the annual refresher and pass the yearly competency checks.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-04",
    5,
    "Read [Individual]'s support plan (ISP) and medication administration record (MAR) to learn their specific medical needs.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-05",
    5,
    "Competency check — correctly identify [Individual] and their medications.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-06",
    5,
    "Competency check — proper hand hygiene and glove use.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-07",
    5,
    "Competency check — accurate medication prep: crushing, diluting, and labeling.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-08",
    5,
    "Competency check — safe G-tube connection and disconnection.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-09",
    5,
    "Competency check — correct flushing before, between, and after medications.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-10",
    5,
    "Competency check — accurate charting in the MAR and Therap.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-11",
    5,
    "Competency check — correct response to common G-tube problems: leaking, blockage, dislodgement.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-12",
    4,
    "Emergency readiness — spot warning signs of complications: leaking, redness, swelling, a clogged tube, or pain.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-13",
    4,
    "Emergency readiness — stop the procedure at once and call the on-call nurse, house manager, or DPM if anything goes wrong.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-14",
    4,
    "Emergency readiness — call 911 if the G-tube comes out or [Individual] shows trouble breathing, vomiting, or a change in alertness.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-15",
    4,
    "Emergency readiness — keep emergency supplies (syringes, extension sets, gloves, sterile water) in a marked, dedicated spot.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-16",
    5,
    "Infection control — wash hands before and after every medication pass.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-17",
    5,
    "Infection control — use clean equipment for each administration.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-18",
    5,
    "Infection control — store medications as labeled: right temperature, and check expiration dates.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-19",
    5,
    "Infection control — clean and disinfect work surfaces before and after each procedure.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-20",
    5,
    "Documentation & communication — chart each administration in the MAR right after giving the medication.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-21",
    5,
    "Documentation & communication — if a medication is refused, spilled, or late, write a detailed note in the comments.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-22",
    5,
    "Documentation & communication — tell the house manager and DPM right away about any change at the G-tube site or any unusual reaction.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
  supplemental(
    "gt-23",
    5,
    "Documentation & communication — include G-tube care and medication notes in shift handover so care stays continuous.",
    "G-tube competency template",
    { perIndividual: true, reusableTemplate: true },
  ),
];

/** A2 — House staff expectations (house-specific, English only per build decision). Same coverage, Complyrer wording. */
const LAWTON_TOPICS: TrainingTopic[] = [
  supplemental(
    "law-01",
    5,
    "Shared care — every staff member shares care of both individuals.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-02",
    5,
    "Treat individuals and coworkers with respect and professionalism.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-03",
    1,
    "Dress presentably for shift — no slippers.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-04",
    5,
    "Notes must be accurate; start writing at least 15 minutes before your shift ends and submit right after.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-05",
    5,
    "Daily review — the HM checks notes every day before midnight; all documentation current by then.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-06",
    1,
    "Use the proper chain of command for reporting and concerns.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-07",
    5,
    "Give both individuals equal attention, regardless of informal assignments.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-08",
    5,
    "Liquid medications — a second staff member observes to verify accuracy.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-09",
    5,
    "Overnight rounds — check on each individual at least every 2–3 hours.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-10",
    5,
    "Keep personal phone use minimal during shifts.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-11",
    5,
    "Breaks — no one stays in the backyard more than 15 minutes without a second staff member in the house.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-12",
    5,
    "One-on-one coaching — the HM meets each staff member during their shift to re-teach note writing and review expectations.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-13",
    5,
    "Take initiative — know every expectation and policy and follow them.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-14",
    5,
    "Leave the home clean at the end of every shift.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
  supplemental(
    "law-15",
    4,
    "Know the emergency procedures; safety equipment gets checked on schedule.",
    "House staff expectations (Lawton)",
    { scope: "site" },
  ),
];

/** A3 — training-compliance items drawn from the weekly house manager checklist. Same coverage, Complyrer wording. */
const HM_WEEKLY_TOPICS: TrainingTopic[] = [
  supplemental(
    "hmw-01",
    5,
    "Every staff member is fully trained and signed off on trainings and delegations.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-02",
    5,
    "Daily staff documentation is reviewed — gaps get addressed, then re-checked.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-03",
    5,
    "The MAR is reviewed daily for missing initials and PRN entries.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-04",
    5,
    "Doctor-ordered vital signs are charted in Therap as prescribed.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-05",
    5,
    "Bowel movements are charted each shift; PRN medications follow the bowel protocol.",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-06",
    6,
    "Rights restrictions are visibly followed (e.g., knives secured, internet limited).",
    "HM weekly checklist training items",
  ),
  supplemental(
    "hmw-07",
    4,
    "Smoke detectors, water temperature, CO monitors, and fire extinguishers are checked.",
    "HM weekly checklist training items",
  ),
  supplemental("hmw-08", 4, "Drills run on the posted drill schedule.", "HM weekly checklist training items"),
  supplemental(
    "hmw-09",
    2,
    "First aid kits and CPR shields are stocked in the home and vehicle, with nothing expired.",
    "HM weekly checklist training items",
  ),
];

/** A5 — mandatory corrective refresher topics (Plan of Correction, T.M.). Same coverage, Complyrer wording. */
const CORRECTIVE_TOPICS: TrainingTopic[] = [
  supplemental(
    "cor-01",
    5,
    "What counts as abuse and neglect under CSR 10-5.200.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-02",
    5,
    "Agency policy on misuse of funds and property.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-03",
    5,
    "Agency policy on leaving individuals unsupervised.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-04",
    5,
    "Real examples of allowed and prohibited conduct.",
    "Corrective refresher topics",
  ),
  supplemental(
    "cor-05",
    5,
    "Signed acknowledgment sheets stay in personnel files; a brief knowledge check confirms understanding.",
    "Corrective refresher topics",
  ),
];

/** A6 — task-specific training acknowledgments on file. Same coverage, Complyrer wording. */
const ACK_TOPICS: TrainingTopic[] = [
  supplemental(
    "ack-wheelchair",
    6,
    "I've read and understood how to assist [Individual] with their wheelchair (tie-downs), and I had a chance to ask questions.",
    "Task-specific acknowledgments",
    { perIndividual: true },
  ),
  supplemental(
    "ack-bsp",
    6,
    "I've been trained on and reviewed [Individual]'s behavior support plan (BSP).",
    "Task-specific acknowledgments",
    { perIndividual: true },
  ),
  supplemental(
    "ack-isp",
    6,
    "I've read and understood [Individual]'s annual person-centered support plan (PCSP), effective [date], and I had a chance to ask questions and get clarification.",
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
