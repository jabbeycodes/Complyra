/**
 * Agency walkthrough layer on top of the Evergreen seed.
 *
 * The base seed keeps a few intentional gaps (Morgan's draft ISP, one missing
 * Cedar shift note, Ellis's unmarked morning dose, Ellis's unsigned
 * delegation). This layer fills everything else an agency would expect to
 * open and print: charts, medications, two weeks of shift notes, mileage,
 * checklists, monthly checks, site reviews, a finalized QA audit, and one
 * completed RN delegation.
 *
 * Dates follow the same UTC "today" the screens use (`todayIso`), except the
 * protected shift-note gap, which uses the detector's own yesterday.
 */
import { todayIso } from "./chart";
import { dueItemClock } from "./operatingReminders";
import { addDaysIso, buildChecklistItems, weekOfSundayIso } from "./hmChecklist";
import {
  blankSafetyLines,
  drillsForMonth,
  monthKeyFrom,
  type EmergencyDrill,
  type EquipmentMonthLog,
  type HomeSafetyReport,
} from "./monthlyChecks";
import type { AllergiesStamp, IndividualProfile } from "./planStack";
import {
  buildQaAuditItems,
  scoreQaAudit,
  scoreQaItemState,
  type QaAudit,
  type StoredQaAuditItem,
} from "./qaAudit";
import type { LocalDatabase } from "./seed";
import type { IspProgram, IspProgramTask, ShiftNote, ShiftNoteTaskScore } from "./shiftNotes";
import { applyWellWaterDefault, mergeSiteReviewLines, siteFactsFrom } from "./siteReview";
import {
  blankDelegationForm,
  DELEGATION_COMPETENCY_ITEMS,
  type DelegationForm,
  type HmWeeklyChecklist,
  type MileageTrip,
  type MedDoseMark,
  type MedInventoryRecord,
} from "./types";
import type { Appointment } from "./appointments";
import type { Medication } from "./chart";

/** hmChecklist.test.ts assigns this Sunday as an open prior week. Don't occupy it. */
const CHECKLIST_TEST_WEEK = "2026-09-06";

/**
 * Bump when the walkthrough seed changes. A browser that saved an older
 * Evergreen workspace reloads this seed once so the demo is actually visible.
 */
export const SHOWCASE_REVISION = 3;

const DAY_SHIFT = "7a–3p";
const EVENING_SHIFT = "3p–11p";

export function applyAgencyDemo(db: LocalDatabase): void {
  db.showcaseRevision = SHOWCASE_REVISION;
  fillProfiles(db);
  addMedications(db);
  addAppointments(db);
  addMileage(db);
  addChecklists(db);
  addIspPrograms(db);
  addShiftNotes(db);
  addCurrentMonthChecks(db);
  completeOpenSiteReviews(db);
  signTrainingExample(db);
  addQaAudits(db);
  addReeseDelegation(db);
}

function idOf(db: LocalDatabase, fullName: string): string {
  const row = db.individuals.find((person) => person.fullName === fullName);
  if (!row) throw new Error(`Demo individual missing: ${fullName}`);
  return row.id;
}

function userId(db: LocalDatabase, fullName: string): string {
  const row = db.profiles.find((profile) => profile.fullName === fullName);
  if (!row) throw new Error(`Demo staff missing: ${fullName}`);
  return row.id;
}

function siteId(db: LocalDatabase, name: string): string {
  const row = db.sites.find((site) => site.name === name);
  if (!row) throw new Error(`Demo site missing: ${name}`);
  return row.id;
}

function agencyId(db: LocalDatabase): string {
  return db.agencies[0]?.id ?? "";
}

/** Same Central yesterday the due-item detector uses. */
function detectorYesterday(now = new Date()): string {
  return dueItemClock(now).serviceDate;
}

function stampFor(name: string, user: string, at: string): AllergiesStamp {
  return {
    createdBy: user,
    createdByName: name,
    createdAt: at,
    updatedBy: "",
    updatedByName: "",
    updatedAt: "",
  };
}

function fillProfiles(db: LocalDatabase) {
  const nurse = userId(db, "Cameron Price");
  const stamped = stampFor("Cameron Price", nurse, "2026-01-20T16:00:00.000Z");
  const extras: Record<string, Partial<IndividualProfile>> = {
    "Morgan Pruitt": {
      phone: "573-555-0162",
      implementationStart: "2026-02-01",
      implementationEnd: "2027-01-31",
      enrolledOn: "2024-06-12",
      allergies: [
        { allergen: "Penicillin", reaction: "Rash", status: "active" },
      ],
      allergiesStamp: stamped,
      guardians: [
        {
          name: "Robin Pruitt",
          relationship: "Parent",
          phone: "573-555-0170",
          email: "robin.pruitt@example.com",
          preferredContact: "Phone",
          address: "88 Ash Street, Columbia, MO 65201",
          notes: "Prefers a call before weekend visits.",
        },
      ],
      providerContacts: [
        {
          id: "provider-showcase-morgan-pcp",
          name: "Dr. Helen Cho",
          role: "PCP",
          phone: "573-555-0181",
          email: "cho.office@example.com",
          address: "410 N Providence Rd, Columbia, MO 65203",
          notes: "Annual physical on file.",
        },
        {
          id: "provider-showcase-morgan-pharmacy",
          name: "Kilgore Pharmacy",
          role: "pharmacy",
          phone: "573-555-0188",
          email: "",
          address: "210 Broadway, Columbia, MO 65201",
          notes: "Blister packs delivered Mondays.",
        },
      ],
    },
    "Reese Lang": {
      phone: "573-555-0168",
      implementationStart: "2026-01-15",
      implementationEnd: "2027-01-14",
      enrolledOn: "2023-11-04",
      allergies: [{ allergen: "Latex", reaction: "Hives", status: "active" }],
      allergiesStamp: stamped,
      guardians: [
        {
          name: "Pat Lang",
          relationship: "Guardian",
          phone: "573-555-0174",
          email: "pat.lang@example.com",
          preferredContact: "Email",
          address: "15 Locust Lane, Columbia, MO 65203",
          notes: "Attends nutrition appointments.",
        },
      ],
      providerContacts: [
        {
          id: "provider-showcase-reese-pcp",
          name: "Dr. Omar Haddad",
          role: "PCP",
          phone: "573-555-0190",
          email: "haddad.office@example.com",
          address: "1 Hospital Dr, Columbia, MO 65212",
          notes: "Orders the enteral formula.",
        },
        {
          id: "provider-showcase-reese-dietitian",
          name: "Nina Alvarez, RD",
          role: "specialist",
          phone: "573-555-0194",
          email: "nina.alvarez@example.com",
          address: "1 Hospital Dr, Columbia, MO 65212",
          notes: "Reviews formula volume quarterly.",
        },
      ],
    },
    "Harper Soto": {
      phone: "573-555-0164",
      implementationStart: "2026-03-01",
      implementationEnd: "2027-02-28",
      enrolledOn: "2025-03-01",
      allergies: [
        { allergen: "Sulfa", reaction: "Rash", status: "active" },
      ],
      allergiesStamp: stamped,
      guardians: [
        {
          name: "Luis Soto",
          relationship: "Sibling",
          phone: "573-555-0177",
          email: "luis.soto@example.com",
          preferredContact: "Phone",
          address: "640 Paris Rd, Columbia, MO 65201",
          notes: "Visits Tuesday evenings.",
        },
      ],
      providerContacts: [
        {
          id: "provider-showcase-harper-pcp",
          name: "Dr. Grace Ibarra",
          role: "PCP",
          phone: "573-555-0196",
          email: "ibarra.office@example.com",
          address: "1200 Medical Plaza Dr, Columbia, MO 65201",
          notes: "Blood pressure check every visit.",
        },
      ],
    },
  };
  for (const person of db.individuals) {
    const extra = extras[person.fullName];
    if (!extra || !person.profile) continue;
    person.profile = { ...person.profile, ...extra };
  }
}

function med(
  db: LocalDatabase,
  individualId: string,
  slug: string,
  fields: Omit<Medication, "id" | "agencyId" | "individualId">,
): Medication {
  return {
    id: `${individualId}-med-${slug}`,
    agencyId: agencyId(db),
    individualId,
    ...fields,
  };
}

function addMedications(db: LocalDatabase) {
  const today = todayIso();
  const morgan = idOf(db, "Morgan Pruitt");
  const reese = idOf(db, "Reese Lang");
  const harper = idOf(db, "Harper Soto");
  const alex = userId(db, "Alex Morgan");
  const added: Medication[] = [
    med(db, morgan, "sertraline", {
      name: "Sertraline",
      strength: "50 mg tablet",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 1,
      remainingPills: 28,
      lastDeliveryOn: today,
      lastCountdownOn: today,
    }),
    med(db, morgan, "melatonin", {
      name: "Melatonin",
      strength: "3 mg tablet",
      kind: "prn",
      controlled: false,
      pillsPerDay: 0,
      remainingPills: 20,
      lastDeliveryOn: today,
      lastCountdownOn: today,
    }),
    med(db, reese, "omeprazole", {
      name: "Omeprazole",
      strength: "20 mg capsule",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 1,
      remainingPills: 30,
      lastDeliveryOn: today,
      lastCountdownOn: today,
    }),
    med(db, reese, "peg", {
      name: "Polyethylene glycol",
      strength: "17 g packet",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 1,
      remainingPills: 24,
      lastDeliveryOn: today,
      lastCountdownOn: today,
    }),
    med(db, reese, "lorazepam", {
      name: "Lorazepam",
      strength: "0.5 mg tablet",
      kind: "prn",
      controlled: true,
      pillsPerDay: 0,
      remainingPills: 8,
      lastDeliveryOn: today,
      lastCountdownOn: today,
    }),
    med(db, harper, "lisinopril", {
      name: "Lisinopril",
      strength: "10 mg tablet",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 1,
      remainingPills: 30,
      lastDeliveryOn: today,
      lastCountdownOn: today,
    }),
    med(db, harper, "vitamin-d", {
      name: "Vitamin D",
      strength: "1000 IU tablet",
      kind: "scheduled",
      controlled: false,
      pillsPerDay: 1,
      remainingPills: 40,
      lastDeliveryOn: today,
      lastCountdownOn: today,
    }),
  ];
  const existing = new Set(db.medications.map((row) => row.id));
  for (const row of added) {
    if (existing.has(row.id)) continue;
    db.medications.push(row);
    if (row.kind !== "scheduled") continue;
    // A dose time without a mark becomes an Overview due item. Mark today's
    // new doses Given so the only unmarked scheduled dose stays Ellis's 8:00.
    const inventory: MedInventoryRecord = {
      id: `mi-showcase-${row.id}`,
      agencyId: row.agencyId,
      individualId: row.individualId,
      medicationId: row.id,
      lowThresholdDays: 7,
      doseTimes: ["08:00"],
      reorderAcknowledgedOn: null,
      updatedAt: `${today}T12:00:00.000Z`,
    };
    db.medInventory = db.medInventory ?? [];
    db.medInventory.push(inventory);
    const mark: MedDoseMark = {
      id: `mm-showcase-${row.id}`,
      agencyId: row.agencyId,
      individualId: row.individualId,
      medicationId: row.id,
      doseDate: today,
      doseTime: "08:00",
      status: "given",
      markedBy: alex,
      markedByName: "Alex Morgan",
      markedAt: `${today}T08:05:00.000Z`,
    };
    db.medDoseMarks.push(mark);
  }
}

/**
 * Showcase appointments are upserted into the hosted `appointments` table,
 * whose id column is a uuid — slug-style ids (`appt-showcase-…-next`) are
 * rejected by Postgres and break `seed:local`. These fixed UUIDs keep the
 * seeded rows stable across re-seeds (upsert on id) like every other seed id.
 */
const SHOWCASE_APPOINTMENT_IDS: Record<string, { next: string; last: string }> = {
  "Morgan Pruitt": {
    next: "ca508f08-16f7-454f-a255-565f5ad29dde",
    last: "c02072cc-4d85-4ed4-a6bd-8e31e5ae2362",
  },
  "Reese Lang": {
    next: "9fd0021e-7a22-4349-9111-df07992cc51f",
    last: "af69fea1-dee2-452b-9c1a-99aca57649a9",
  },
  "Harper Soto": {
    next: "b187d019-f4d9-4e69-b374-481d86b526f8",
    last: "2925495a-1f54-4803-ac99-9762615cd1b9",
  },
  "Ellis Hart": {
    next: "0e5ea2a6-6cf2-4d54-9027-e2c6bfcf406a",
    last: "cf5ae731-8e6f-4e9e-97b5-f03e1c1c0ac5",
  },
};

function addAppointments(db: LocalDatabase) {
  const today = todayIso();
  const nurse = userId(db, "Cameron Price");
  const people = ["Morgan Pruitt", "Reese Lang", "Harper Soto", "Ellis Hart"];
  const specs: Record<string, { consultant: string; specialty: string; reason: string; comments: string }> = {
    "Morgan Pruitt": {
      consultant: "Dr. Helen Cho",
      specialty: "Primary care",
      reason: "Annual physical and mood follow-up",
      comments: "Mood stable on sertraline. Continue current dose. Next labs in six months.",
    },
    "Reese Lang": {
      consultant: "Nina Alvarez, RD",
      specialty: "Nutrition",
      reason: "Enteral formula review",
      comments: "Bolus volume unchanged. Weight stable. Staff to keep the latex-free gloves at the tube site.",
    },
    "Harper Soto": {
      consultant: "Dr. Grace Ibarra",
      specialty: "Primary care",
      reason: "Blood pressure follow-up",
      comments: "Blood pressure at goal on lisinopril. Continue the shower chair. No sulfa products.",
    },
    "Ellis Hart": {
      consultant: "Dr. Priya Shah",
      specialty: "Neurology",
      reason: "Seizure follow-up",
      comments: "No seizures this month. Continue levetiracetam. Brought the seizure log.",
    },
  };
  for (const name of people) {
    const individualId = idOf(db, name);
    const spec = specs[name];
    const hasUpcoming = db.appointments.some(
      (row) =>
        row.individualId === individualId &&
        !row.deletedAt &&
        row.startsOn >= today,
    );
    if (!hasUpcoming) {
      db.appointments.push(
        appointment(db, individualId, nurse, {
          id: SHOWCASE_APPOINTMENT_IDS[name].next,
          startsOn: addDaysIso(today, 10),
          consultant: spec.consultant,
          specialty: spec.specialty,
          reason: spec.reason,
          address: db.individuals.find((p) => p.id === individualId)?.profile?.address ?? "",
          completed: false,
          comments: "",
        }),
      );
    }
    const hasCommented = db.appointments.some(
      (row) =>
        row.individualId === individualId &&
        !row.deletedAt &&
        row.visitComments.trim().length > 0,
    );
    if (!hasCommented) {
      db.appointments.push(
        appointment(db, individualId, nurse, {
          id: SHOWCASE_APPOINTMENT_IDS[name].last,
          startsOn: addDaysIso(today, -6),
          consultant: spec.consultant,
          specialty: spec.specialty,
          reason: spec.reason,
          address: db.individuals.find((p) => p.id === individualId)?.profile?.address ?? "",
          completed: true,
          comments: spec.comments,
        }),
      );
    }
  }
}

function appointment(
  db: LocalDatabase,
  individualId: string,
  nurseId: string,
  input: {
    id: string;
    startsOn: string;
    consultant: string;
    specialty: string;
    reason: string;
    address: string;
    completed: boolean;
    comments: string;
  },
): Appointment {
  const at = `${input.startsOn}T15:00:00.000Z`;
  return {
    id: input.id,
    agencyId: agencyId(db),
    individualId,
    startsOn: input.startsOn,
    startTime: "10:00",
    endTime: "10:45",
    timezone: "America/Chicago",
    consultant: input.consultant,
    specialty: input.specialty,
    reason: input.reason,
    visitAddress: input.address,
    createdBy: nurseId,
    createdByName: "Cameron Price",
    createdAt: at,
    updatedBy: nurseId,
    updatedByName: "Cameron Price",
    updatedAt: at,
    deletedBy: "",
    deletedByName: "",
    deletedAt: null,
    completedBy: input.completed ? nurseId : "",
    completedByName: input.completed ? "Cameron Price" : "",
    completedAt: input.completed ? at : null,
    visitComments: input.comments,
    consultationFileId: null,
  };
}

function addMileage(db: LocalDatabase) {
  const today = todayIso();
  const dayNum = Number(today.slice(8, 10));
  const span = Math.min(14, dayNum);
  const houses: Array<{
    site: string;
    start: number;
    drivers: [string, string];
    riders: [string, string];
  }> = [
    {
      site: "Cedar House",
      start: 84210,
      drivers: ["Alex Morgan", "Taylor Reed"],
      riders: ["Ellis Hart", "Morgan Pruitt"],
    },
    {
      site: "Willow House",
      start: 61040,
      drivers: ["Jordan Lee", "Casey Adams"],
      riders: ["Reese Lang", "Harper Soto"],
    },
  ];
  const reasons = [
    "Day program",
    "Grocery",
    "Pharmacy",
    "Community outing",
    "Doctor appointment",
  ];
  for (const house of houses) {
    let odometer = house.start;
    const site = siteId(db, house.site);
    const riderIds = house.riders.map((name) => idOf(db, name));
    for (let ago = span - 1; ago >= 0; ago -= 1) {
      const tripDate = addDaysIso(today, -ago);
      if (!tripDate.startsWith(today.slice(0, 7))) continue;
      const miles = 8 + ((span - ago) % 7);
      const doctor = (span - ago) % 5 === 0;
      const driver = house.drivers[(span - ago) % 2];
      const trip: MileageTrip = {
        id: `trip-showcase-${slug(house.site)}-${tripDate}`,
        agencyId: agencyId(db),
        siteId: site,
        tripDate,
        odometerStart: odometer,
        odometerEnd: odometer + miles,
        miles,
        riderIds: doctor ? [riderIds[0]] : riderIds,
        reason: reasons[(span - ago) % reasons.length],
        backfilled: false,
        driverName: driver,
        signatureName: driver,
        createdBy: userId(db, driver),
        createdAt: `${tripDate}T20:00:00.000Z`,
      };
      db.mileageTrips.push(trip);
      odometer += miles;
    }
  }
}

function checklistPrintWeek(currentWeek: string): string {
  const previous = addDaysIso(currentWeek, -7);
  if (previous === CHECKLIST_TEST_WEEK || previous === currentWeek) {
    return addDaysIso(currentWeek, -14);
  }
  return previous;
}

function answeredChecklist(
  items: ReturnType<typeof buildChecklistItems>,
  house: "cedar" | "willow",
) {
  return items.map((item) => {
    if (item.key === "c9") {
      return {
        ...item,
        answer: "N" as const,
        note:
          house === "cedar"
            ? "Kitchen faucet drips. Work order filed with maintenance."
            : "Bathroom exhaust fan is loud. Work order filed with maintenance.",
      };
    }
    if (item.key === "c6") {
      return {
        ...item,
        answer: "Y" as const,
        note: house === "cedar" ? "Ellis: weekly blood pressure." : "Harper: weekly blood pressure. Reese: weekly weight.",
      };
    }
    if (item.key === "c21") {
      return {
        ...item,
        answer: "Y" as const,
        note: "Assigned staff are signed off on the current plans.",
        autoComputed: true,
      };
    }
    return { ...item, answer: "Y" as const, note: "" };
  });
}

function addChecklists(db: LocalDatabase) {
  const today = todayIso();
  const currentWeek = weekOfSundayIso(today);
  const printWeek = checklistPrintWeek(currentWeek);
  const sarah = userId(db, "Sarah Mitchell");
  const james = userId(db, "James Wilson");
  const houses: Array<{ site: string; hmId: string; hmName: string; house: "cedar" | "willow" }> = [
    { site: "Cedar House", hmId: sarah, hmName: "Sarah Mitchell", house: "cedar" },
    { site: "Willow House", hmId: james, hmName: "James Wilson", house: "willow" },
  ];
  const rows: HmWeeklyChecklist[] = [];
  for (const house of houses) {
    const site = siteId(db, house.site);
    rows.push(
      checklistRow(db, {
        id: `cl-showcase-${house.house}-current`,
        siteId: site,
        weekOf: currentWeek,
        hmId: house.hmId,
        hmName: house.hmName,
        status: "open",
        submittedAt: null,
        house: house.house,
      }),
    );
    rows.push(
      checklistRow(db, {
        id: `cl-showcase-${house.house}-print`,
        siteId: site,
        weekOf: printWeek,
        hmId: house.hmId,
        hmName: house.hmName,
        status: "submitted",
        submittedAt: `${addDaysIso(printWeek, 1)}T20:00:00.000Z`,
        house: house.house,
      }),
    );
  }
  db.weeklyChecklists = rows;
}

function checklistRow(
  db: LocalDatabase,
  input: {
    id: string;
    siteId: string;
    weekOf: string;
    hmId: string;
    hmName: string;
    status: "open" | "submitted";
    submittedAt: string | null;
    house: "cedar" | "willow";
  },
): HmWeeklyChecklist {
  const created = `${input.weekOf}T14:00:00.000Z`;
  return {
    id: input.id,
    agencyId: agencyId(db),
    siteId: input.siteId,
    weekOf: input.weekOf,
    assignedToUserId: input.hmId,
    assignedByUserId: userId(db, "Sarah Mitchell"),
    status: input.status,
    submittedAt: input.submittedAt,
    items: answeredChecklist(buildChecklistItems(), input.house),
    serviceLogs: [
      {
        id: `${input.id}-log-1`,
        kind: "direct_care",
        detail: "Covered a day-program pickup when the van returned late.",
        staffName: input.house === "cedar" ? "Alex Morgan" : "Jordan Lee",
        dateTime: `${addDaysIso(input.weekOf, 2)}T16:00:00.000Z`,
        createdAt: created,
      },
      {
        id: `${input.id}-log-2`,
        kind: "issue",
        detail: "Maintenance work order called in. No one was hurt.",
        staffName: input.hmName,
        dateTime: `${addDaysIso(input.weekOf, 3)}T11:00:00.000Z`,
        createdAt: created,
      },
    ],
    attestation: {
      signedBy: input.hmName,
      signedAt: input.submittedAt ?? `${input.weekOf}T21:00:00.000Z`,
      signatureMark: input.hmName,
    },
    createdAt: created,
    updatedAt: input.submittedAt ?? created,
  };
}

function addIspPrograms(db: LocalDatabase) {
  const method = db.ispScoringMethods[0];
  if (!method) return;
  const sarah = userId(db, "Sarah Mitchell");
  const specs: Array<{ name: string; person: string; tasks: string[] }> = [
    {
      name: "2026 ISP — Nutrition and mealtime",
      person: "Reese Lang",
      tasks: [
        "Prepare and give the prescribed bolus feeding",
        "Follow the texture-modified diet at meals",
        "Complete oral care after meals",
      ],
    },
    {
      name: "2026 ISP — Safety and daily living",
      person: "Harper Soto",
      tasks: [
        "Use the shower chair and ask for standby help",
        "Take morning medications with staff present",
        "Attend the Tuesday and Thursday volunteer shift",
      ],
    },
  ];
  for (const spec of specs) {
    const individualId = idOf(db, spec.person);
    if (db.ispPrograms.some((program) => program.individualId === individualId && program.status === "approved")) {
      continue;
    }
    const programId = `isp-showcase-${slug(spec.person)}`;
    const program: IspProgram = {
      id: programId,
      agencyId: agencyId(db),
      individualId,
      planYear: "2026",
      name: spec.name,
      effectiveOn: "2026-01-01",
      expiresOn: "2026-12-31",
      schedule: "per_shift",
      maxEntriesPerDay: 3,
      scoringMethodId: method.id,
      status: "approved",
      approvedBy: sarah,
      approvedByName: "Sarah Mitchell",
      approvedAt: "2026-01-08T15:00:00.000Z",
      createdBy: sarah,
      createdByName: "Sarah Mitchell",
      createdAt: "2026-01-07T15:00:00.000Z",
      updatedAt: "2026-01-08T15:00:00.000Z",
    };
    db.ispPrograms.push(program);
    spec.tasks.forEach((title, index) => {
      const task: IspProgramTask = {
        id: `${programId}-task-${index + 1}`,
        programId,
        title,
        instructions: "",
        sortOrder: index,
      };
      db.ispProgramTasks.push(task);
    });
  }
}

function programIdFor(db: LocalDatabase, individualId: string): string {
  const approved = db.ispPrograms.find(
    (program) => program.individualId === individualId && program.status === "approved",
  );
  if (approved) return approved.id;
  return (
    db.ispPrograms.find((program) => program.individualId === individualId)?.id ?? ""
  );
}

function addShiftNotes(db: LocalDatabase) {
  const yesterday = detectorYesterday();
  const method = db.ispScoringMethods[0];
  const yes = method?.levels.find((level) => level.caption === "Yes")?.id ?? "";
  const no = method?.levels.find((level) => level.caption === "No")?.id ?? "";

  // Willow notes were seeded before those programs existed, so they had no program.
  for (const note of db.shiftNotes) {
    if (!note.programId) note.programId = programIdFor(db, note.individualId);
    if (/shift documented\.$/.test(note.summary)) {
      note.summary = narrativeFor(db, note.individualId, note.shift, 0);
    }
  }

  const houses: Array<{ people: string[]; staff: [string, string] }> = [
    { people: ["Ellis Hart", "Morgan Pruitt"], staff: ["Alex Morgan", "Taylor Reed"] },
    { people: ["Reese Lang", "Harper Soto"], staff: ["Jordan Lee", "Casey Adams"] },
  ];

  for (let ago = 0; ago < 14; ago += 1) {
    const noteDate = addDaysIso(yesterday, -ago);
    for (const house of houses) {
      const writerName = house.staff[ago % 2];
      for (const personName of house.people) {
        const individualId = idOf(db, personName);
        // pushNote refuses Morgan · Day · Alex · yesterday so Overview keeps that one gap.
        pushNote(db, {
          individualId,
          staffName: writerName,
          staffUserId: userId(db, writerName),
          noteDate,
          shift: DAY_SHIFT,
          ago,
        });
        // A few evening notes on Cedar stay under the 30-note chart cap.
        if (house.people[0] === "Ellis Hart" && ago >= 1 && ago <= 7) {
          const eveningWriter = house.staff[(ago + 1) % 2];
          pushNote(db, {
            individualId,
            staffName: eveningWriter,
            staffUserId: userId(db, eveningWriter),
            noteDate,
            shift: EVENING_SHIFT,
            ago,
          });
        }
      }
    }
  }

  const scored = new Set(db.shiftNoteScores.map((score) => score.noteId));
  for (const note of db.shiftNotes) {
    if (note.deletedAt || scored.has(note.id) || !yes) continue;
    const tasks = db.ispProgramTasks.filter((task) => task.programId === note.programId);
    const dayIndex = Math.abs(note.noteDate.charCodeAt(note.noteDate.length - 1));
    tasks.forEach((task, index) => {
      const missed = dayIndex % 4 === 0 && index === 0;
      const score: ShiftNoteTaskScore = {
        id: `score-showcase-${note.id}-${index}`,
        noteId: note.id,
        taskId: task.id,
        levelId: missed ? no : yes,
        comment: missed ? "Needed extra prompts. Will try again next shift." : "",
      };
      db.shiftNoteScores.push(score);
    });
  }
}

function pushNote(
  db: LocalDatabase,
  input: {
    individualId: string;
    staffName: string;
    staffUserId: string;
    noteDate: string;
    shift: string;
    ago: number;
  },
) {
  const morgan = idOf(db, "Morgan Pruitt");
  const alex = userId(db, "Alex Morgan");
  if (
    input.individualId === morgan &&
    input.staffUserId === alex &&
    input.noteDate === detectorYesterday() &&
    input.shift === DAY_SHIFT
  ) {
    return;
  }
  const exists = db.shiftNotes.some(
    (note) =>
      !note.deletedAt &&
      note.individualId === input.individualId &&
      note.staffUserId === input.staffUserId &&
      note.noteDate === input.noteDate &&
      note.shift === input.shift,
  );
  if (exists) return;
  const shiftKey = input.shift === DAY_SHIFT ? "day" : input.shift === EVENING_SHIFT ? "eve" : "noc";
  const note: ShiftNote = {
    id: `sn-showcase-${input.individualId.slice(-4)}-${input.noteDate}-${shiftKey}-${input.staffUserId.slice(-4)}`,
    agencyId: agencyId(db),
    individualId: input.individualId,
    programId: programIdFor(db, input.individualId),
    noteDate: input.noteDate,
    shift: input.shift,
    summary: narrativeFor(db, input.individualId, input.shift, input.ago),
    timeSpentMinutes: 60 + (input.ago % 4) * 15,
    staffUserId: input.staffUserId,
    staffName: input.staffName,
    createdAt: `${input.noteDate}T19:00:00.000Z`,
    updatedAt: `${input.noteDate}T19:00:00.000Z`,
    deletedAt: null,
  };
  db.shiftNotes.push(note);
}

function narrativeFor(db: LocalDatabase, individualId: string, shift: string, ago: number): string {
  const name = db.individuals.find((person) => person.id === individualId)?.fullName ?? "They";
  const first = name.split(" ")[0];
  const lines: Record<string, string[]> = {
    "Ellis Hart": [
      `${first} completed the morning routine with one prompt and used the communication device to ask for coffee.`,
      `${first} joined the day program outing, stayed in the wheelchair for the longer walk, and ate the texture-modified lunch without trouble.`,
      `${first} was tired after program. Evening meds were taken. No seizure activity observed.`,
    ],
    "Morgan Pruitt": [
      `${first} left for community employment on time and called when the shift ended.`,
      `${first} cooked pasta with standby help and talked through the bus route for tomorrow.`,
      `${first} spent the evening at home, took sertraline, and declined a walk because of the rain.`,
    ],
    "Reese Lang": [
      `${first} took the bolus feeding without distress. Tube site is clean. Latex-free gloves used.`,
      `${first} ate the texture-modified lunch with pacing prompts and finished oral care afterward.`,
      `${first} rested after program. Formula tolerance was good. No vomiting or residual concerns.`,
    ],
    "Harper Soto": [
      `${first} used the shower chair and asked for standby help before stepping out.`,
      `${first} attended the volunteer shift and took lisinopril with staff present.`,
      `${first} blood pressure was in the usual range this morning. Evening was quiet.`,
    ],
  };
  const bank = lines[name] ?? [`${first} had a routine ${shift} with no new concerns.`];
  const when = shift === EVENING_SHIFT ? "Evening" : shift === "11p–7a" ? "Overnight" : "Day";
  return `${when}: ${bank[ago % bank.length]}`;
}

function addCurrentMonthChecks(db: LocalDatabase) {
  const today = todayIso();
  const month = monthKeyFrom(today);
  const checkedOn = `${month}-04`;
  for (const item of db.adaptiveEquipment) {
    if (!item.active) continue;
    const exists = db.equipmentMonthLogs.some(
      (log) => log.equipmentId === item.id && log.monthKey === month,
    );
    if (exists) continue;
    const person = db.individuals.find((row) => row.id === item.individualId);
    const initials = person?.siteId === siteId(db, "Willow House") ? "JW" : "AM";
    const log: EquipmentMonthLog = {
      id: `eq-showcase-${item.id}-${month}`,
      equipmentId: item.id,
      monthKey: month,
      checkedOn,
      initials,
      checkedByUserId: null,
      comments: "In good repair.",
    };
    db.equipmentMonthLogs.push(log);
  }
  // Dates sit late in the month so tests can still record drills on the 3rd–5th.
  const drillDays = [20, 22, 24, 26, 27, 28];
  for (const site of db.sites) {
    const types = drillsForMonth(month);
    types.forEach((drillType, index) => {
      const exists = db.emergencyDrills.some(
        (row) => row.siteId === site.id && row.monthKey === month && row.drillType === drillType,
      );
      if (exists) return;
      const leader = site.name === "Cedar House" ? "Alex Morgan" : "James Wilson";
      const participants =
        site.name === "Cedar House"
          ? "Alex Morgan, Taylor Reed, Ellis Hart, Morgan Pruitt"
          : "James Wilson, Jordan Lee, Casey Adams, Reese Lang, Harper Soto";
      const day = String(drillDays[index] ?? 20).padStart(2, "0");
      const drill: EmergencyDrill = {
        id: `drill-showcase-${slug(site.name)}-${drillType}-${month}`,
        agencyId: agencyId(db),
        siteId: site.id,
        monthKey: month,
        drillType,
        date: `${month}-${day}`,
        time: "14:10",
        evacTime: "2:15",
        leaderName: leader,
        participants,
        awakeOrSleep: drillType === "fire" ? "awake" : "",
      };
      db.emergencyDrills.push(drill);
    });
    const safetyExists = db.homeSafetyReports.some(
      (row) => row.siteId === site.id && row.monthKey === month,
    );
    if (safetyExists) continue;
    const checker = site.name === "Cedar House" ? "Alex Morgan" : "James Wilson";
    const report: HomeSafetyReport = {
      id: `safety-showcase-${slug(site.name)}-${month}`,
      agencyId: agencyId(db),
      siteId: site.id,
      monthKey: month,
      lines: blankSafetyLines().map((line) => ({
        ...line,
        dateChecked: checkedOn,
        location:
          line.key.includes("smoke") || line.key === "co_1"
            ? "Hallway"
            : line.key.includes("faucet")
              ? "Kitchen"
              : "",
        temp: line.key.includes("faucet") ? "116 F" : "",
        extra: line.key === "fire_extinguisher" ? "2027-03 / full" : "",
        checkedBy: checker,
        signature: checker,
      })),
    };
    db.homeSafetyReports.push(report);
  }
}

function completeOpenSiteReviews(db: LocalDatabase) {
  const today = todayIso();
  db.siteReviews = db.siteReviews.map((review) => {
    if (review.reviewerName.trim() && review.reviewedOn && review.part2Verified) return review;
    const site = db.sites.find((row) => row.id === review.siteId);
    if (!site) return review;
    const reviewer = site.name === "Willow House" ? "James Wilson" : "Sarah Mitchell";
    return applyWellWaterDefault(
      {
        ...review,
        reviewerName: reviewer,
        supportCoordinator: site.name === "Willow House" ? "Ashley Allen" : "Jason Briscoe",
        reviewedOn: addDaysIso(today, -18),
        providerOwnedControlled: true,
        heightenedScrutiny: false,
        meetsIndividualNeeds: true,
        part2Verified: true,
        lines: mergeSiteReviewLines(
          review.lines.map((line) => ({
            ...line,
            status: line.id === "int-well-water" ? "na" : "satisfactory",
          })),
        ),
        updatedAt: `${today}T16:00:00.000Z`,
      },
      siteFactsFrom(site),
    );
  });
}

function signTrainingExample(db: LocalDatabase) {
  const ellis = idOf(db, "Ellis Hart");
  // Alex's sheet stays unsigned: the chart tests walk that DSP through check-off.
  const row = db.trainingChecklists.find(
    (checklist) => checklist.individualId === ellis && checklist.staffName === "Taylor Reed",
  );
  if (!row || row.staffSignedAt) return;
  const signedAt = `${addDaysIso(todayIso(), -21)}T15:30:00.000Z`;
  row.items = row.items.map((line) => ({ ...line, initialedAt: signedAt }));
  row.staffSignedAt = signedAt;
  row.staffSignatureName = "Taylor Reed";
  row.hmSignedAt = signedAt;
  row.hmSignatureName = "Sarah Mitchell";
}

function addQaAudits(db: LocalDatabase) {
  const today = todayIso();
  const year = Number(today.slice(0, 4));
  const quarter = (Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
  const sarah = userId(db, "Sarah Mitchell");
  const signedAt = `${addDaysIso(today, -20)}T18:00:00.000Z`;
  for (const site of db.sites) {
    if (db.qaAudits.some((audit) => audit.siteId === site.id && audit.year === year && audit.quarter === quarter)) {
      continue;
    }
    const people = db.individuals
      .filter((person) => person.siteId === site.id)
      .map((person) => ({ id: person.id, fullName: person.fullName }));
    const states = buildQaAuditItems(people).map((item) => {
      if (site.name === "Cedar House" && item.itemId === "home.clean-odor-free") {
        return scoreQaItemState(
          item,
          "no",
          "Kitchen trash was full at arrival. Staff emptied it before the visit ended.",
          sarah,
          "Sarah Mitchell",
        );
      }
      return scoreQaItemState(item, "yes", "", sarah, "Sarah Mitchell");
    });
    const auditId = `qa-showcase-${slug(site.name)}-${year}-q${quarter}`;
    const audit: QaAudit = {
      id: auditId,
      agencyId: agencyId(db),
      siteId: site.id,
      year,
      quarter,
      status: "finalized",
      auditorId: sarah,
      auditorName: "Sarah Mitchell",
      auditorSignatureName: "Sarah Mitchell",
      auditorSignatureMark: "Sarah Mitchell",
      signedAt,
      score: scoreQaAudit(states),
      createdAt: signedAt,
      updatedAt: signedAt,
    };
    db.qaAudits.push(audit);
    const stored: StoredQaAuditItem[] = states.map((item, index) => ({
      ...item,
      id: `${auditId}-item-${index + 1}`,
      auditId,
      agencyId: agencyId(db),
    }));
    db.qaAuditItems.push(...stored);
    db.qaSchedules.push({
      id: `qa-sched-${slug(site.name)}`,
      agencyId: agencyId(db),
      siteId: site.id,
      nextDue: addDaysIso(today, 70),
      assignedAuditorId: sarah,
      assignedAuditorName: "Sarah Mitchell",
      active: true,
      createdAt: signedAt,
      updatedAt: signedAt,
    });
  }
}

function addReeseDelegation(db: LocalDatabase) {
  const reese = idOf(db, "Reese Lang");
  if (
    db.obligations.some(
      (item) => item.individualId === reese && item.kind === "delegation" && item.enabled,
    )
  ) {
    return;
  }
  const cameron = userId(db, "Cameron Price");
  const today = todayIso();
  const signedOn = addDaysIso(today, -40);
  const form: DelegationForm = blankDelegationForm("complyrer_improved");
  form.purpose =
    "Reese receives bolus enteral nutrition through a gastrostomy tube at lunch and dinner. This delegation covers preparing and giving that bolus for Reese only.";
  form.procedures = [
    "Wash hands and put on latex-free gloves.",
    "Check the formula name, amount, and expiration against the current order.",
    "Sit Reese upright and confirm the tube is the gastrostomy tube.",
    "Flush with the prescribed water, give the bolus slowly, then flush again.",
    "Stop and call the nurse if Reese coughs, vomits, or the site looks red, swollen, or is leaking.",
  ].join("\n");
  form.observeReportDo =
    "Watch for coughing, vomiting, formula leaking at the site, or a blocked tube. Stop the feeding, keep Reese upright, and call Cameron Price. If Reese has trouble breathing, call 911.";
  form.nonTransferableAcknowledged = true;
  form.inspectionInterval = "Monthly";
  form.inspectionCadence = "Monthly";
  form.reviewDate = addDaysIso(today, 90);
  form.instructingProfessional = {
    name: "Nina Alvarez, RD",
    title: "Registered dietitian",
    signedAt: signedOn,
    contactNumber: "573-555-0194",
  };
  form.delegatingRn = {
    name: "Cameron Price",
    signatureName: "Cameron Price",
    dateSigned: signedOn,
    contactNumber: "573-555-0108",
  };
  form.rescindReason = null;
  const rosterNames = [
    { name: "Jordan Lee", title: "DSP", initials: "JL" },
    { name: "Casey Adams", title: "DSP", initials: "CA" },
  ];
  rosterNames.forEach((member, index) => {
    form.roster[index] = {
      printName: member.name,
      title: member.title,
      staffSignature: member.name,
      signatureName: member.name,
      signedAt: `${signedOn}T18:00:00.000Z`,
      rescindedDate: null,
      initials: member.initials,
      competency: [...DELEGATION_COMPETENCY_ITEMS],
    };
  });
  db.obligations.push({
    id: "obl-showcase-reese-enteral",
    agencyId: agencyId(db),
    individualId: reese,
    kind: "delegation",
    mode: "required",
    title: "Bolus enteral feeding via gastrostomy tube",
    detail: "Lunch and dinner bolus. Latex-free supplies only. Stop and call the RN if the tube site changes.",
    sourcePage: 8,
    documentVersionId: null,
    enabled: true,
    frequency: "Each bolus",
    shiftPeriods: [DAY_SHIFT, EVENING_SHIFT],
    // Review date is a nurse reminder. The delegation does not expire on that date.
    expiresOn: null,
    createdFrom: "manual",
    inventoryState: "present",
    proposed: false,
    delegatingRnUserId: cameron,
    rnSignedAt: `${signedOn}T17:00:00.000Z`,
    rnSignatureName: "Cameron Price",
    rnSignatureMark: "Cameron Price",
    discontinuedAt: null,
    discontinueFileId: null,
    discontinueTitle: null,
    delegationForm: form,
  });
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}
