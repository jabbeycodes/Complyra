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
import type { Medication, MedicationDelivery } from "./chart";
import type { CarePlan, CareScreeningData, Screening, ScreeningType } from "./careScreening";
import { emptyCareData } from "./careScreening";
import type { ConsentRecord } from "./consents";
import { HEALTH_SCOPE, PACKET_COPY_VERSION, PACKET_ITEMS, type ConsentPacket } from "./consentPackets";
import type { LifeEventRow } from "./lifeEvents";
import type { HouseCardEntryRow } from "./houseCard";
import type {
  PersonalSpendingEntryRow,
  PersonalSpendingMonthClose,
} from "./personalSpending";
import {
  centralTodayIso,
  weekDayIsos,
  weekStartMondayIso,
  type MenuEntry,
} from "./menuRecords";
import type { MessageParticipantRow, MessageRow, MessageThreadRow } from "./messaging";
import type {
  MedDoseException,
  MedicationOrder,
  MedicationReconciliation,
  MedicationReconciliationItem,
} from "./types";

/** hmChecklist.test.ts assigns this Sunday as an open prior week. Don't occupy it. */
const CHECKLIST_TEST_WEEK = "2026-09-06";

/**
 * Bump when the walkthrough seed changes. A browser that saved an older
 * Evergreen workspace reloads this seed once so the demo is actually visible.
 */
export const SHOWCASE_REVISION = 6;

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
  addDemoSurfaces(db);
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

/* ------------------------------------------------------------------ */
/* Demo surface data (2026-10-29): fills the newer feature surfaces the
 * walkthrough above predates — menu records, medication orders and a
 * reconciliation, med-count baselines, internal messaging, care plans
 * and screenings, the consent register, and life events — with the same
 * fictional Evergreen people. Dates are relative to the real "today"
 * the screens use, so the default views (this week's menu, today's MAR
 * countdown, recent messages) open populated. Deliberate gaps kept:
 * Ellis's 8:00 levetiracetam stays unmarked, Morgan's ISP stays a draft
 * with her one missing shift note, and Morgan's consent register stays
 * empty — the in-progress packet below is how hers get collected.     */

function addDemoSurfaces(db: LocalDatabase) {
  addMenuWeeks(db);
  addMedicationOrders(db);
  addMessagingThreads(db);
  addCarePlansAndScreenings(db);
  addConsentRegister(db);
  addLifeEvents(db);
  addHouseCardLedgers(db);
  addPersonalSpendingLedgers(db);
}

/**
 * House Card ledgers for both Evergreen homes, dated in the current
 * month so the tab opens on a live month: the agency's $600 funds credit
 * on the 1st, everyday purchases across every category (gas, health card,
 * and food stamps tied to named Individuals), one refund each, and one
 * voided-and-replaced pair each so corrections are visible. The numbers
 * reconcile exactly — Cedar closes the month so far at $153.68 and
 * Willow at $94.92, which trips Willow's "Low balance" flag.
 */
function addHouseCardLedgers(db: LocalDatabase) {
  db.houseCardEntries = db.houseCardEntries ?? [];
  db.houseCardCloses = db.houseCardCloses ?? [];
  const entries = db.houseCardEntries;
  const today = centralTodayIso();
  const monthPrefix = today.slice(0, 8);
  const todayDay = Number(today.slice(8, 10));
  const dayIso = (day: number) =>
    `${monthPrefix}${String(Math.min(day, todayDay)).padStart(2, "0")}`;
  const at = (day: number, seq: number) =>
    `${dayIso(day)}T${String(14 + (seq % 6)).padStart(2, "0")}:${String(
      (seq * 7) % 60,
    ).padStart(2, "0")}:00.000Z`;

  const james = userId(db, "James Wilson");
  const alex = userId(db, "Alex Morgan");
  const taylor = userId(db, "Taylor Reed");
  const jordan = userId(db, "Jordan Lee");
  const casey = userId(db, "Casey Adams");
  const cedar = siteId(db, "Cedar House");
  const willow = siteId(db, "Willow House");
  const ellis = idOf(db, "Ellis Hart");
  const morganP = idOf(db, "Morgan Pruitt");
  const reese = idOf(db, "Reese Lang");
  const harper = idOf(db, "Harper Soto");

  const push = (row: HouseCardEntryRow) => {
    if (!entries.some((entry) => entry.id === row.id)) entries.push(row);
  };
  const base = (
    id: string,
    site: string,
    day: number,
    seq: number,
    recorder: string,
    recorderName: string,
    recorderRole: string,
  ): HouseCardEntryRow => ({
    id,
    agencyId: agencyId(db),
    siteId: site,
    entryDate: dayIso(day),
    kind: "purchase",
    location: "",
    amountCents: 0,
    category: null,
    individualId: null,
    note: "",
    receiptPhoto: null,
    recordedBy: recorder,
    recordedByName: recorderName,
    recordedByRole: recorderRole,
    createdAt: at(day, seq),
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
  });

  /* ------------------------------ Cedar House ------------------------------
     Deposited $615.00 · Spent $461.32 · Balance $153.68 */
  push({
    ...base("housecard-showcase-cedar-credit", cedar, 1, 0, james, "James Wilson", "house_manager"),
    kind: "credit",
    amountCents: 60000,
    note: "Monthly house funds.",
  });
  push({
    ...base("housecard-showcase-cedar-g1", cedar, 2, 1, alex, "Alex Morgan", "dsp"),
    location: "Hy-Vee",
    amountCents: 8423,
    category: "groceries_household",
  });
  push({
    ...base("housecard-showcase-cedar-gas1", cedar, 3, 2, taylor, "Taylor Reed", "dsp"),
    location: "Casey's",
    amountCents: 4000,
    category: "gas",
    individualId: ellis,
  });
  push({
    ...base("housecard-showcase-cedar-health1", cedar, 5, 3, alex, "Alex Morgan", "dsp"),
    location: "CVS Pharmacy",
    amountCents: 1275,
    category: "health_card",
    individualId: morganP,
  });
  push({
    ...base("housecard-showcase-cedar-food1", cedar, 7, 4, taylor, "Taylor Reed", "dsp"),
    location: "Walmart",
    amountCents: 9650,
    category: "food_stamps",
    individualId: ellis,
  });
  push({
    ...base("housecard-showcase-cedar-g2", cedar, 9, 5, alex, "Alex Morgan", "dsp"),
    location: "ALDI",
    amountCents: 6320,
    category: "groceries_household",
  });
  push({
    ...base("housecard-showcase-cedar-gas2", cedar, 11, 6, taylor, "Taylor Reed", "dsp"),
    location: "QuikTrip",
    amountCents: 3550,
    category: "gas",
    individualId: morganP,
  });
  push({
    ...base("housecard-showcase-cedar-voided", cedar, 13, 7, alex, "Alex Morgan", "dsp"),
    location: "Dollar General",
    amountCents: 2199,
    category: "groceries_household",
    voidedBy: alex,
    voidedAt: at(13, 9),
    voidReason: "Amount keyed from the wrong receipt.",
    replacedByEntryId: "housecard-showcase-cedar-replacement",
  });
  push({
    ...base("housecard-showcase-cedar-replacement", cedar, 13, 8, alex, "Alex Morgan", "dsp"),
    location: "Dollar General",
    amountCents: 2499,
    category: "groceries_household",
    replacesEntryId: "housecard-showcase-cedar-voided",
  });
  push({
    ...base("housecard-showcase-cedar-refund", cedar, 15, 10, taylor, "Taylor Reed", "dsp"),
    kind: "refund",
    location: "Walmart",
    amountCents: 1500,
    note: "Returned unopened cleaning supplies.",
  });
  push({
    ...base("housecard-showcase-cedar-gas3", cedar, 17, 11, alex, "Alex Morgan", "dsp"),
    location: "Casey's",
    amountCents: 2875,
    category: "gas",
    individualId: ellis,
  });
  push({
    ...base("housecard-showcase-cedar-g3", cedar, 19, 12, taylor, "Taylor Reed", "dsp"),
    location: "Hy-Vee",
    amountCents: 7540,
    category: "groceries_household",
  });

  /* ------------------------------ Willow House -----------------------------
     Deposited $608.25 · Spent $513.33 · Balance $94.92 (low balance) */
  push({
    ...base("housecard-showcase-willow-credit", willow, 1, 0, james, "James Wilson", "house_manager"),
    kind: "credit",
    amountCents: 60000,
    note: "Monthly house funds.",
  });
  push({
    ...base("housecard-showcase-willow-g1", willow, 2, 1, jordan, "Jordan Lee", "dsp"),
    location: "Hy-Vee",
    amountCents: 9118,
    category: "groceries_household",
  });
  push({
    ...base("housecard-showcase-willow-gas1", willow, 4, 2, casey, "Casey Adams", "dsp"),
    location: "Shell",
    amountCents: 4500,
    category: "gas",
    individualId: reese,
  });
  push({
    ...base("housecard-showcase-willow-food1", willow, 6, 3, jordan, "Jordan Lee", "dsp"),
    location: "Walmart",
    amountCents: 10230,
    category: "food_stamps",
    individualId: harper,
  });
  push({
    ...base("housecard-showcase-willow-health1", willow, 8, 4, casey, "Casey Adams", "dsp"),
    location: "Walgreens",
    amountCents: 2340,
    category: "health_card",
    individualId: reese,
  });
  push({
    ...base("housecard-showcase-willow-g2", willow, 10, 5, jordan, "Jordan Lee", "dsp"),
    location: "ALDI",
    amountCents: 5575,
    category: "groceries_household",
  });
  push({
    ...base("housecard-showcase-willow-voided", willow, 12, 6, casey, "Casey Adams", "dsp"),
    location: "Casey's",
    amountCents: 3200,
    category: "gas",
    individualId: harper,
    voidedBy: casey,
    voidedAt: at(12, 8),
    voidReason: "Filled the agency van instead of the house car.",
    replacedByEntryId: "housecard-showcase-willow-replacement",
  });
  push({
    ...base("housecard-showcase-willow-replacement", willow, 12, 7, casey, "Casey Adams", "dsp"),
    location: "Casey's",
    amountCents: 3275,
    category: "gas",
    individualId: harper,
    replacesEntryId: "housecard-showcase-willow-voided",
  });
  push({
    ...base("housecard-showcase-willow-refund", willow, 14, 9, jordan, "Jordan Lee", "dsp"),
    kind: "refund",
    location: "Target",
    amountCents: 825,
    note: "Returned a duplicate kitchen item.",
  });
  push({
    ...base("housecard-showcase-willow-g3", willow, 16, 10, casey, "Casey Adams", "dsp"),
    location: "Hy-Vee",
    amountCents: 8890,
    category: "groceries_household",
  });
  push({
    ...base("housecard-showcase-willow-food2", willow, 18, 11, jordan, "Jordan Lee", "dsp"),
    location: "Save A Lot",
    amountCents: 4415,
    category: "food_stamps",
    individualId: reese,
  });
  push({
    ...base("housecard-showcase-willow-gas2", willow, 20, 12, casey, "Casey Adams", "dsp"),
    location: "Shell",
    amountCents: 2990,
    category: "gas",
    individualId: reese,
  });
}

/**
 * Personal Spending ledgers for Ellis Hart (Cedar) and Harper Soto
 * (Willow) — each person's OWN money, separate from the house card
 * above. Ellis's previous month is closed and signed with the dual
 * sign-off in its "Individual signed" state (closing $93.88), and his
 * current month carries that balance forward to $180.84. Harper's
 * current month deliberately includes one spend that takes her below
 * $0 (labeled "Over balance" by the guardrail) before a family deposit
 * brings her back to $10.20, so the flag is visible in the demo.
 */
function addPersonalSpendingLedgers(db: LocalDatabase) {
  db.personalSpendingEntries = db.personalSpendingEntries ?? [];
  db.personalSpendingCloses = db.personalSpendingCloses ?? [];
  const entries = db.personalSpendingEntries;
  const closes = db.personalSpendingCloses;
  const today = centralTodayIso();
  const monthPrefix = today.slice(0, 8);
  const todayDay = Number(today.slice(8, 10));
  const dayIso = (day: number) =>
    `${monthPrefix}${String(Math.min(day, todayDay)).padStart(2, "0")}`;
  const at = (day: number, seq: number) =>
    `${dayIso(day)}T${String(14 + (seq % 6)).padStart(2, "0")}:${String(
      (seq * 7) % 60,
    ).padStart(2, "0")}:00.000Z`;
  const [yearNum, monthNum] = today.split("-").map(Number);
  const prevFirst = new Date(Date.UTC(yearNum, monthNum - 2, 1));
  const prevPrefix = prevFirst.toISOString().slice(0, 8);
  const prevMonth = prevFirst.toISOString().slice(0, 7);
  const prevDayIso = (day: number) =>
    `${prevPrefix}${String(day).padStart(2, "0")}`;
  const prevAt = (day: number, seq: number) =>
    `${prevDayIso(day)}T${String(14 + (seq % 6)).padStart(2, "0")}:${String(
      (seq * 7) % 60,
    ).padStart(2, "0")}:00.000Z`;

  const james = userId(db, "James Wilson");
  const alex = userId(db, "Alex Morgan");
  const taylor = userId(db, "Taylor Reed");
  const jordan = userId(db, "Jordan Lee");
  const casey = userId(db, "Casey Adams");
  const cedar = siteId(db, "Cedar House");
  const willow = siteId(db, "Willow House");
  const ellis = idOf(db, "Ellis Hart");
  const harper = idOf(db, "Harper Soto");

  const push = (row: PersonalSpendingEntryRow) => {
    if (!entries.some((entry) => entry.id === row.id)) entries.push(row);
  };
  const base = (
    id: string,
    site: string,
    person: string,
    entryDate: string,
    createdAt: string,
    recorder: string,
    recorderName: string,
    recorderRole: string,
  ): PersonalSpendingEntryRow => ({
    id,
    agencyId: agencyId(db),
    siteId: site,
    individualId: person,
    entryDate,
    kind: "spend",
    location: "",
    purpose: "",
    amountCents: 0,
    note: "",
    receiptPhoto: null,
    recordedBy: recorder,
    recordedByName: recorderName,
    recordedByRole: recorderRole,
    createdAt,
    voidedBy: null,
    voidedAt: null,
    voidReason: null,
    replacesEntryId: null,
    replacedByEntryId: null,
  });

  /* --------------------- Ellis Hart — previous month ---------------------
     Deposited $185.00 · Spent $91.12 · Closed at $93.88 (Individual signed) */
  push({
    ...base("personalspending-showcase-ellis-prev-deposit", cedar, ellis, prevDayIso(1), prevAt(1, 0), james, "James Wilson", "house_manager"),
    kind: "deposit",
    location: "Monthly personal funds",
    amountCents: 18500,
  });
  push({
    ...base("personalspending-showcase-ellis-prev-s1", cedar, ellis, prevDayIso(5), prevAt(5, 1), taylor, "Taylor Reed", "dsp"),
    location: "Target",
    purpose: "Clothing — new jeans",
    amountCents: 3850,
  });
  push({
    ...base("personalspending-showcase-ellis-prev-s2", cedar, ellis, prevDayIso(9), prevAt(9, 2), alex, "Alex Morgan", "dsp"),
    location: "Regal Cinema",
    purpose: "Movie outing with housemates",
    amountCents: 1525,
  });
  push({
    ...base("personalspending-showcase-ellis-prev-s3", cedar, ellis, prevDayIso(14), prevAt(14, 3), alex, "Alex Morgan", "dsp"),
    location: "Great Clips",
    purpose: "Haircut",
    amountCents: 1600,
  });
  push({
    ...base("personalspending-showcase-ellis-prev-s4", cedar, ellis, prevDayIso(20), prevAt(20, 4), taylor, "Taylor Reed", "dsp"),
    location: "Walmart",
    purpose: "Personal care items — shampoo and soap",
    amountCents: 2137,
  });
  if (!closes.some((close) => close.id === "personalspending-showcase-ellis-close-prev")) {
    closes.push({
      id: "personalspending-showcase-ellis-close-prev",
      agencyId: agencyId(db),
      siteId: cedar,
      individualId: ellis,
      month: prevMonth,
      closingBalanceCents: 9388,
      printedName: "James Wilson",
      signatureText: "James Wilson",
      signedBy: james,
      signedByName: "James Wilson",
      signedAt: `${monthPrefix}01T15:00:00.000Z`,
      createdAt: `${monthPrefix}01T15:00:00.000Z`,
      individualSignoff: "individual_signed",
      secondStaffId: null,
      secondStaffName: null,
      secondStaffSignatureText: null,
    } satisfies PersonalSpendingMonthClose);
  }

  /* ---------------------- Ellis Hart — current month ----------------------
     Deposited $210.00 · Spent $123.04 · Month net +$86.96 · Balance $180.84 */
  push({
    ...base("personalspending-showcase-ellis-deposit", cedar, ellis, dayIso(1), at(1, 0), james, "James Wilson", "house_manager"),
    kind: "deposit",
    location: "Monthly personal funds",
    amountCents: 18500,
  });
  push({
    ...base("personalspending-showcase-ellis-s1", cedar, ellis, dayIso(3), at(3, 1), alex, "Alex Morgan", "dsp"),
    location: "Walmart",
    purpose: "Personal care items — shampoo, soap, toothpaste",
    amountCents: 2436,
  });
  push({
    ...base("personalspending-showcase-ellis-s2", cedar, ellis, dayIso(6), at(6, 2), taylor, "Taylor Reed", "dsp"),
    location: "Dollar Tree",
    purpose: "Snacks for the week",
    amountCents: 850,
  });
  push({
    ...base("personalspending-showcase-ellis-s3", cedar, ellis, dayIso(9), at(9, 3), alex, "Alex Morgan", "dsp"),
    location: "Target",
    purpose: "Clothing — new shoes",
    amountCents: 4299,
  });
  push({
    ...base("personalspending-showcase-ellis-s4", cedar, ellis, dayIso(12), at(12, 4), taylor, "Taylor Reed", "dsp"),
    location: "Regal Cinema",
    purpose: "Movie ticket and popcorn — community outing",
    amountCents: 1875,
  });
  push({
    ...base("personalspending-showcase-ellis-s5", cedar, ellis, dayIso(15), at(15, 5), alex, "Alex Morgan", "dsp"),
    location: "Great Clips",
    purpose: "Haircut",
    amountCents: 1600,
  });
  push({
    ...base("personalspending-showcase-ellis-s6", cedar, ellis, dayIso(18), at(18, 6), taylor, "Taylor Reed", "dsp"),
    location: "Hy-Vee",
    purpose: "Favorite foods — yogurt and berries",
    amountCents: 1244,
  });
  push({
    ...base("personalspending-showcase-ellis-deposit2", cedar, ellis, dayIso(20), at(20, 7), alex, "Alex Morgan", "dsp"),
    kind: "deposit",
    location: "Family",
    amountCents: 2500,
    note: "Birthday money from his sister.",
  });

  /* ---------------------- Harper Soto — current month ---------------------
     Deposited $170.00 · Spent $159.80 · Balance $10.20
     (the day-14 spend takes her to −$33.55: the over-balance example) */
  push({
    ...base("personalspending-showcase-harper-deposit", willow, harper, dayIso(1), at(1, 0), james, "James Wilson", "house_manager"),
    kind: "deposit",
    location: "Monthly personal funds",
    amountCents: 12000,
  });
  push({
    ...base("personalspending-showcase-harper-s1", willow, harper, dayIso(4), at(4, 1), casey, "Casey Adams", "dsp"),
    location: "Target",
    purpose: "Clothing — new sweater",
    amountCents: 3120,
  });
  push({
    ...base("personalspending-showcase-harper-s2", willow, harper, dayIso(8), at(8, 2), jordan, "Jordan Lee", "dsp"),
    location: "Walgreens",
    purpose: "Personal care items",
    amountCents: 1465,
  });
  push({
    ...base("personalspending-showcase-harper-s3", willow, harper, dayIso(11), at(11, 3), casey, "Casey Adams", "dsp"),
    location: "McDonald's",
    purpose: "Lunch out during a community outing",
    amountCents: 1130,
  });
  push({
    ...base("personalspending-showcase-harper-s4", willow, harper, dayIso(14), at(14, 4), jordan, "Jordan Lee", "dsp"),
    location: "Walmart",
    purpose: "Personal items and gifts for family",
    amountCents: 9640,
  });
  push({
    ...base("personalspending-showcase-harper-deposit2", willow, harper, dayIso(17), at(17, 5), casey, "Casey Adams", "dsp"),
    kind: "deposit",
    location: "Family",
    amountCents: 5000,
    note: "Money sent by her mother.",
  });
  push({
    ...base("personalspending-showcase-harper-s5", willow, harper, dayIso(19), at(19, 6), jordan, "Jordan Lee", "dsp"),
    location: "Dollar General",
    purpose: "Snacks",
    amountCents: 625,
  });
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

/* ------------------------------ Menu ------------------------------ */

const MENU_SLOTS = [
  { slot: "breakfast", at: "13:20:00.000Z" },
  { slot: "lunch", at: "17:40:00.000Z" },
  { slot: "dinner", at: "23:10:00.000Z" },
  { slot: "snack", at: "20:30:00.000Z" },
] as const;

const ELLIS_MENU: Record<string, string[]> = {
  breakfast: [
    "Scrambled eggs, wheat toast, and orange juice",
    "Oatmeal with brown sugar, a banana, and milk",
    "Pancakes with syrup, turkey sausage, and milk",
    "Cheese omelet, toast, and apple juice",
    "French toast sticks, yogurt, and mixed fruit",
    "Biscuits with gravy, scrambled eggs, and juice",
    "Cold cereal, a boiled egg, toast, and milk",
  ],
  lunch: [
    "Turkey sandwich, tomato soup, and a side salad",
    "Grilled chicken, rice, and steamed broccoli",
    "Beef stew with potatoes and carrots, and a roll",
    "Tuna salad sandwich, chips, and a fruit cup",
    "Spaghetti with meat sauce, green beans, and garlic bread",
    "Chicken quesadilla, corn, and applesauce",
    "Ham and cheese sandwich, vegetable soup, and crackers",
  ],
  dinner: [
    "Baked chicken, mashed potatoes, and peas",
    "Meatloaf, macaroni and cheese, and green beans",
    "Salmon patty, rice pilaf, and mixed vegetables",
    "Chicken Alfredo pasta, broccoli, and a roll",
    "Beef tacos with lettuce and tomato, and Spanish rice",
    "Pork chop, a baked potato, and corn",
    "Chicken and vegetable stir fry with rice",
  ],
  snack: [
    "Apple slices with peanut butter",
    "A yogurt cup and graham crackers",
    "A cheese stick and crackers",
    "A banana and a granola bar",
    "A mixed fruit cup",
    "Popcorn and juice",
    "Cottage cheese with peaches",
  ],
};

/** Reese eats a texture-modified diet alongside her bolus feedings. */
const REESE_MENU: Record<string, string[]> = {
  breakfast: [
    "Enteral formula bolus; pureed oatmeal with cinnamon",
    "Enteral formula bolus; pureed scrambled egg and applesauce",
    "Enteral formula bolus; cream of wheat and pureed peaches",
  ],
  lunch: [
    "Enteral formula bolus; pureed chicken and sweet potato by mouth",
    "Enteral formula bolus; texture-modified turkey and mashed potato",
    "Enteral formula bolus; pureed beef stew, strained",
  ],
  dinner: [
    "Enteral formula bolus; texture-modified meatloaf and mashed potato",
    "Enteral formula bolus; pureed chicken, carrots, and gravy",
    "Enteral formula bolus; texture-modified pasta with meat sauce",
  ],
  snack: [
    "Enteral formula bolus; an applesauce pouch",
    "Enteral formula bolus; pureed fruit cup",
    "Enteral formula bolus; yogurt, thinned",
  ],
};

function addMenuWeeks(db: LocalDatabase) {
  db.menuEntries ??= [];
  const today = centralTodayIso();
  const monday = weekStartMondayIso(today);
  // The full previous week, plus the current week through today — the two
  // weeks the menu screen opens on, with no meals recorded in the future.
  const dates = [
    ...weekDayIsos(addDaysIso(monday, -7)),
    ...weekDayIsos(monday).filter((date) => date <= today),
  ];
  const people: Array<{
    name: string;
    house: string;
    staff: [string, string];
    menu: Record<string, string[]>;
  }> = [
    { name: "Ellis Hart", house: "Cedar House", staff: ["Alex Morgan", "Taylor Reed"], menu: ELLIS_MENU },
    { name: "Reese Lang", house: "Willow House", staff: ["Jordan Lee", "Casey Adams"], menu: REESE_MENU },
  ];
  for (const person of people) {
    const individualId = idOf(db, person.name);
    const site = siteId(db, person.house);
    dates.forEach((entryDate, dayIndex) => {
      const recorderName = person.staff[dayIndex % 2];
      const recorder = userId(db, recorderName);
      for (const { slot, at } of MENU_SLOTS) {
        const id = `menu-showcase-${slug(person.name)}-${entryDate}-${slot}`;
        if (db.menuEntries!.some((row) => row.id === id)) continue;
        const choices = person.menu[slot];
        let amountEaten: MenuEntry["amountEaten"] = "all";
        let note = "";
        if (person.name === "Reese Lang") {
          amountEaten = dayIndex % 3 === 2 ? "some" : "most";
          if (slot === "lunch" && dayIndex % 4 === 1) {
            note = "Took the oral portion slowly; the bolus followed, per the feeding plan.";
          }
        } else if ((dayIndex * 4 + MENU_SLOTS.findIndex((s) => s.slot === slot)) % 9 === 4) {
          amountEaten = "some";
        }
        if (person.name === "Ellis Hart" && slot === "dinner" && entryDate === addDaysIso(today, -2)) {
          amountEaten = "none";
          note = "Said he was not hungry at dinner. Offered a snack later and he ate half of it.";
        }
        const stamp = `${entryDate}T${at}`;
        db.menuEntries!.push({
          id,
          agencyId: agencyId(db),
          siteId: site,
          individualId,
          entryDate,
          mealSlot: slot,
          foodText: choices[dayIndex % choices.length],
          amountEaten,
          note,
          recordedBy: recorder,
          recordedByName: recorderName,
          recordedByRole: "dsp",
          createdAt: stamp,
          updatedAt: stamp,
          deletedAt: null,
          voidedBy: null,
          voidReason: "",
        });
      }
    });
  }
}

/* ------------------- Medication orders + counts ------------------- */

function addMedicationOrders(db: LocalDatabase) {
  const today = todayIso();
  const yesterday = addDaysIso(today, -1);
  const nurse = userId(db, "Cameron Price");
  const ellis = idOf(db, "Ellis Hart");
  const morgan = idOf(db, "Morgan Pruitt");
  const reese = idOf(db, "Reese Lang");
  const harper = idOf(db, "Harper Soto");
  db.medicationOrders ??= [];
  const specs: Array<{
    slug: string;
    individualId: string;
    medicationId: string;
    medicationName: string;
    dose: string;
    schedule: string;
    scheduleTimes: string[];
    prescriberName: string;
    reason: string;
    startDate: string;
    reviewInDays: number;
  }> = [
    {
      slug: "levetiracetam", individualId: ellis, medicationId: `${ellis}-med-keppra`,
      medicationName: "Levetiracetam", dose: "500 mg", schedule: "BID",
      scheduleTimes: ["08:00", "20:00"], prescriberName: "Dr. Priya Shah",
      reason: "Seizure control", startDate: "2026-01-05", reviewInDays: 150,
    },
    {
      slug: "sertraline", individualId: morgan, medicationId: `${morgan}-med-sertraline`,
      medicationName: "Sertraline", dose: "50 mg", schedule: "Daily",
      scheduleTimes: ["08:00"], prescriberName: "Dr. Helen Cho",
      reason: "Mood and anxiety", startDate: "2026-02-15", reviewInDays: 120,
    },
    {
      slug: "omeprazole", individualId: reese, medicationId: `${reese}-med-omeprazole`,
      medicationName: "Omeprazole", dose: "20 mg", schedule: "Daily",
      scheduleTimes: ["08:00"], prescriberName: "Dr. Omar Haddad",
      reason: "Reflux protection with enteral feeding", startDate: "2026-01-20", reviewInDays: 90,
    },
    {
      slug: "lisinopril", individualId: harper, medicationId: `${harper}-med-lisinopril`,
      medicationName: "Lisinopril", dose: "10 mg", schedule: "Daily",
      scheduleTimes: ["08:00"], prescriberName: "Dr. Grace Ibarra",
      reason: "Blood pressure control", startDate: "2026-03-03", reviewInDays: 60,
    },
  ];
  for (const spec of specs) {
    const id = `order-showcase-${spec.slug}`;
    if (db.medicationOrders.some((row) => row.id === id)) continue;
    const order: MedicationOrder = {
      id,
      agencyId: agencyId(db),
      individualId: spec.individualId,
      medicationName: spec.medicationName,
      dose: spec.dose,
      route: "Oral",
      schedule: spec.schedule,
      scheduleTimes: spec.scheduleTimes,
      isPrn: false,
      startDate: spec.startDate,
      endReviewDate: addDaysIso(today, spec.reviewInDays),
      prescriberName: spec.prescriberName,
      reason: spec.reason,
      status: "active",
      medicationId: spec.medicationId,
      createdBy: nurse,
      createdByName: "Cameron Price",
      activatedBy: nurse,
      activatedByName: "Cameron Price",
      activatedAt: `${spec.startDate}T15:00:00.000Z`,
      discontinuedBy: null,
      discontinuedByName: "",
      discontinuedAt: null,
      discontinueReason: "",
      createdAt: `${spec.startDate}T14:00:00.000Z`,
      updatedAt: `${spec.startDate}T15:00:00.000Z`,
    };
    db.medicationOrders.push(order);
  }

  // One completed reconciliation: Morgan's list checked against the
  // hospital discharge list after a prescriber change.
  db.medicationReconciliations ??= [];
  db.medicationReconciliationItems ??= [];
  const recId = "rec-showcase-morgan";
  if (!db.medicationReconciliations.some((row) => row.id === recId)) {
    const day = addDaysIso(today, -5);
    const reconciliation: MedicationReconciliation = {
      id: recId,
      agencyId: agencyId(db),
      individualId: morgan,
      trigger: "order_change",
      status: "completed",
      startedBy: nurse,
      startedByName: "Cameron Price",
      startedAt: `${day}T16:00:00.000Z`,
      signedOffBy: nurse,
      signedOffByName: "Cameron Price",
      signedOffAt: `${day}T16:25:00.000Z`,
      signOffNote: "Compared against the discharge list with Dr. Cho's office; one item clarified below.",
      createdAt: `${day}T16:00:00.000Z`,
      updatedAt: `${day}T16:25:00.000Z`,
    };
    db.medicationReconciliations.push(reconciliation);
    const items: MedicationReconciliationItem[] = [
      {
        id: `${recId}-sertraline`, agencyId: agencyId(db), reconciliationId: recId,
        orderId: "order-showcase-sertraline", medicationId: `${morgan}-med-sertraline`,
        medicationLabel: "Sertraline 50 mg tablet — Daily", decision: "continue",
        discrepancy: false, note: "",
        createdAt: `${day}T16:05:00.000Z`, updatedAt: `${day}T16:05:00.000Z`,
      },
      {
        id: `${recId}-melatonin`, agencyId: agencyId(db), reconciliationId: recId,
        orderId: null, medicationId: `${morgan}-med-melatonin`,
        medicationLabel: "Melatonin 3 mg tablet — PRN at bedtime", decision: "continue",
        discrepancy: false, note: "Still used most nights.",
        createdAt: `${day}T16:08:00.000Z`, updatedAt: `${day}T16:08:00.000Z`,
      },
      {
        id: `${recId}-vitamin-d`, agencyId: agencyId(db), reconciliationId: recId,
        orderId: null, medicationId: null,
        medicationLabel: "Vitamin D3 1000 IU (hospital discharge list)", decision: "stop",
        discrepancy: true,
        note: "Appeared on the discharge list only; Dr. Cho's office confirmed it is not a home medication.",
        createdAt: `${day}T16:12:00.000Z`, updatedAt: `${day}T16:12:00.000Z`,
      },
    ];
    db.medicationReconciliationItems.push(...items);
  }

  // Med-count baselines: the newest count for each med anchors the MAR
  // supply countdown. Pill counts are set so the doses already marked
  // Given after each count land exactly on the chart's maintained count.
  const deliveries: MedicationDelivery[] = [
    {
      id: "md-showcase-levetiracetam", medicationId: `${ellis}-med-keppra`,
      countedOn: yesterday, countedAt: `${yesterday}T13:05:00.000Z`,
      remainingPills: 28, pillsPerDay: 2, recordedBy: nurse,
    },
    {
      id: "md-showcase-oxycodone", medicationId: `${ellis}-med-oxycodone`,
      countedOn: today, countedAt: `${today}T13:30:00.000Z`,
      remainingPills: 17, pillsPerDay: 2, recordedBy: userId(db, "Alex Morgan"),
    },
    {
      id: "md-showcase-sertraline", medicationId: `${morgan}-med-sertraline`,
      countedOn: addDaysIso(today, -2), countedAt: `${addDaysIso(today, -2)}T13:05:00.000Z`,
      remainingPills: 29, pillsPerDay: 1, recordedBy: nurse,
    },
    {
      id: "md-showcase-lisinopril", medicationId: `${harper}-med-lisinopril`,
      countedOn: yesterday, countedAt: `${yesterday}T13:05:00.000Z`,
      remainingPills: 31, pillsPerDay: 1, recordedBy: userId(db, "Jordan Lee"),
    },
  ];
  for (const delivery of deliveries) {
    if (!db.medicationDeliveries.some((row) => row.id === delivery.id)) {
      db.medicationDeliveries.push(delivery);
    }
  }

  // One held dose with its reason, on yesterday's MAR pass.
  const exception: MedDoseException = {
    id: "mde-showcase-lisinopril-held",
    agencyId: agencyId(db),
    individualId: harper,
    medicationId: `${harper}-med-lisinopril`,
    occurredOn: yesterday,
    kind: "held",
    pillsAffected: 1,
    reason:
      "Morning blood pressure was 98/62 before the dose, so it was held per prescriber guidance. Cameron Price (RN) was notified and a recheck was scheduled for the afternoon.",
    createdBy: userId(db, "Jordan Lee"),
    createdAt: `${yesterday}T13:20:00.000Z`,
  };
  if (!db.medDoseExceptions.some((row) => row.id === exception.id)) {
    db.medDoseExceptions.push(exception);
  }
}

/* ---------------------------- Messaging ---------------------------- */

function addMessagingThreads(db: LocalDatabase) {
  db.messageThreads ??= [];
  db.messageParticipants ??= [];
  db.messages ??= [];
  const sarah = userId(db, "Sarah Mitchell");
  const taylor = userId(db, "Taylor Reed");
  const jordan = userId(db, "Jordan Lee");
  const casey = userId(db, "Casey Adams");
  const harper = idOf(db, "Harper Soto");
  const agency = agencyId(db);

  const threads: Array<{
    thread: MessageThreadRow;
    participants: Array<{ userId: string; lastReadAt: string | null }>;
    messages: Array<{ senderId: string; body: string; at: string }>;
  }> = [
    {
      thread: {
        id: "thread-showcase-cedar-coverage", agencyId: agency, subject: "Saturday coverage at Cedar House",
        individualId: null, createdBy: taylor, createdAt: hoursAgo(30), lastMessageAt: hoursAgo(26),
      },
      participants: [
        { userId: taylor, lastReadAt: hoursAgo(25) },
        { userId: sarah, lastReadAt: hoursAgo(25) },
      ],
      messages: [
        { senderId: taylor, body: "Saturday — I can come in at 3 if that helps. I know Ellis has his community outing at 1.", at: hoursAgo(30) },
        { senderId: sarah, body: "That helps, thank you. Alex stays with Ellis for the outing and finishes at 3, then you take 3 to 11. I put both on the coverage board.", at: hoursAgo(28) },
        { senderId: taylor, body: "Works for me — see you Saturday.", at: hoursAgo(26) },
      ],
    },
    {
      thread: {
        id: "thread-showcase-harper-bp", agencyId: agency, subject: "Harper Soto — morning blood pressure recheck",
        individualId: harper, createdBy: jordan, createdAt: hoursAgo(5), lastMessageAt: hoursAgo(1),
      },
      participants: [
        { userId: jordan, lastReadAt: hoursAgo(0.5) },
        { userId: casey, lastReadAt: hoursAgo(0.5) },
        // Sarah has read Jordan's report but not Casey's reply: one unread.
        { userId: sarah, lastReadAt: hoursAgo(4.5) },
      ],
      messages: [
        { senderId: jordan, body: "Harper's morning reading was 104/68 before her dose — better than yesterday. The recheck is on the chart for 2 p.m.", at: hoursAgo(5) },
        { senderId: casey, body: "I will do the 2 p.m. recheck and put the reading in her chart. Sarah — flagging you here so you see the trend too.", at: hoursAgo(1) },
      ],
    },
  ];
  for (const spec of threads) {
    if (!db.messageThreads.some((row) => row.id === spec.thread.id)) {
      db.messageThreads.push(spec.thread);
    }
    for (const participant of spec.participants) {
      if (db.messageParticipants.some((row) => row.threadId === spec.thread.id && row.userId === participant.userId)) continue;
      const row: MessageParticipantRow = {
        threadId: spec.thread.id,
        agencyId: agency,
        userId: participant.userId,
        addedBy: sarah,
        addedAt: spec.thread.createdAt,
        lastReadAt: participant.lastReadAt,
        hiddenAt: null,
      };
      db.messageParticipants.push(row);
    }
    spec.messages.forEach((message, index) => {
      const id = `${spec.thread.id}-msg-${index + 1}`;
      if (db.messages!.some((row) => row.id === id)) return;
      const row: MessageRow = {
        id,
        threadId: spec.thread.id,
        agencyId: agency,
        senderId: message.senderId,
        kind: "user",
        body: message.body,
        createdAt: message.at,
      };
      db.messages!.push(row);
    });
  }
}

/* --------------------- Care plans + screenings --------------------- */

function addCarePlansAndScreenings(db: LocalDatabase) {
  const today = todayIso();
  const sarah = userId(db, "Sarah Mitchell");
  const james = userId(db, "James Wilson");
  const nurse = userId(db, "Cameron Price");
  const jordan = userId(db, "Jordan Lee");
  const casey = userId(db, "Casey Adams");
  const reese = idOf(db, "Reese Lang");
  const harper = idOf(db, "Harper Soto");
  const agency = agencyId(db);
  const data: CareScreeningData = db.careScreening ?? emptyCareData();
  db.careScreening = data;

  const types: ScreeningType[] = [
    { id: "stype-showcase-fall", agency_id: agency, name: "Fall risk assessment", due_soon_days: 30, enabled: true },
    { id: "stype-showcase-depression", agency_id: agency, name: "Depression screening (PHQ-2)", due_soon_days: 30, enabled: true },
    { id: "stype-showcase-skin", agency_id: agency, name: "Skin integrity check", due_soon_days: 14, enabled: true },
  ];
  for (const type of types) {
    if (!data.types.some((row) => row.id === type.id)) data.types.push(type);
  }

  const plans: CarePlan[] = [
    {
      id: "care-showcase-reese",
      agency_id: agency,
      individual_id: reese,
      title: "Enteral feeding and reflux precautions",
      items: [
        {
          need: "Gastrostomy tube feeding — bolus feeds must follow the prescribed volume and pace.",
          goal: "Take every bolus comfortably with no signs of reflux or aspiration.",
          interventions:
            "Give bolus feedings at the prescribed volume over 20 minutes; keep Reese upright during the feed and for 30 minutes after; stop and call the nurse if coughing, wet breathing, or tube-site changes appear. Latex-free supplies only.",
          roles: ["dsp", "nurse"],
          review_on: addDaysIso(today, 60),
        },
        {
          need: "Texture-modified diet for anything taken by mouth.",
          goal: "Enjoy oral tastes safely alongside the bolus plan.",
          interventions:
            "Offer only the texture-modified foods on the menu record; stay within arm's reach while Reese eats; complete oral care after meals.",
          roles: ["dsp"],
          review_on: addDaysIso(today, 60),
        },
      ],
      status: "active",
      previous_id: null,
      created_by: nurse,
      created_at: "2026-02-02T15:00:00.000Z",
      approved_by: sarah,
      approved_at: "2026-02-03T15:00:00.000Z",
      retired_at: null,
    },
    {
      id: "care-showcase-harper",
      agency_id: agency,
      individual_id: harper,
      title: "Blood pressure and safe mobility",
      items: [
        {
          need: "Hypertension — a morning blood pressure check comes before medication.",
          goal: "Keep morning readings in the range Dr. Ibarra set.",
          interventions:
            "Check blood pressure before the morning dose; hold the dose and call the nurse if the top number is under 100; record the reading in the chart.",
          roles: ["dsp", "nurse"],
          review_on: addDaysIso(today, 45),
        },
        {
          need: "Uses a shower chair and standby help for transfers.",
          goal: "Shower with standby help only.",
          interventions:
            "Set up the shower chair before every shower; stay within hearing; report any dizziness the same shift.",
          roles: ["dsp"],
          review_on: addDaysIso(today, 45),
        },
      ],
      status: "active",
      previous_id: null,
      created_by: james,
      created_at: "2026-03-04T15:00:00.000Z",
      approved_by: sarah,
      approved_at: "2026-03-05T15:00:00.000Z",
      retired_at: null,
    },
  ];
  for (const plan of plans) {
    if (!data.plans.some((row) => row.id === plan.id)) data.plans.push(plan);
  }
  const acks = [
    { plan_id: "care-showcase-reese", user_id: jordan, acknowledged_at: "2026-02-04T14:00:00.000Z" },
    { plan_id: "care-showcase-reese", user_id: casey, acknowledged_at: "2026-02-04T14:30:00.000Z" },
    { plan_id: "care-showcase-harper", user_id: jordan, acknowledged_at: "2026-03-06T14:00:00.000Z" },
  ];
  for (const ack of acks) {
    if (!data.acknowledgements.some((row) => row.plan_id === ack.plan_id && row.user_id === ack.user_id)) {
      data.acknowledgements.push(ack);
    }
  }

  const screenings: Screening[] = [
    {
      id: "screen-showcase-reese-fall", agency_id: agency, individual_id: reese,
      type_id: "stype-showcase-fall",
      last_completed_on: addDaysIso(today, -12), due_on: addDaysIso(today, 353),
      completed_on: addDaysIso(today, -12),
      result_note: "Low risk — transfers are steady with standby help.",
      follow_up: "",
    },
    {
      id: "screen-showcase-reese-skin", agency_id: agency, individual_id: reese,
      type_id: "stype-showcase-skin",
      last_completed_on: addDaysIso(today, -3), due_on: addDaysIso(today, 11),
      completed_on: addDaysIso(today, -3),
      result_note: "Skin intact, including around the tube site; barrier cream in place.",
      follow_up: "",
    },
    {
      id: "screen-showcase-harper-depression", agency_id: agency, individual_id: harper,
      type_id: "stype-showcase-depression",
      last_completed_on: addDaysIso(today, -170), due_on: addDaysIso(today, 10),
      completed_on: addDaysIso(today, -170),
      result_note: "Score 0 — no concerns at the last screening.",
      follow_up: "",
    },
    {
      id: "screen-showcase-harper-fall", agency_id: agency, individual_id: harper,
      type_id: "stype-showcase-fall",
      last_completed_on: addDaysIso(today, -360), due_on: addDaysIso(today, 5),
      completed_on: addDaysIso(today, -360),
      result_note: "Moderate risk at the last assessment — shower chair and standby help in place.",
      follow_up: "Reassess at the next nursing visit.",
    },
  ];
  for (const screening of screenings) {
    if (!data.screenings.some((row) => row.id === screening.id)) data.screenings.push(screening);
  }
}

/* ----------------------------- Consents ----------------------------- */

function addConsentRegister(db: LocalDatabase) {
  const today = todayIso();
  const sarah = userId(db, "Sarah Mitchell");
  const ellis = idOf(db, "Ellis Hart");
  const reese = idOf(db, "Reese Lang");
  const harper = idOf(db, "Harper Soto");
  const morgan = idOf(db, "Morgan Pruitt");
  const agency = agencyId(db);
  db.consents ??= [];
  db.consentRevocations ??= [];

  const make = (
    individualId: string,
    typeId: string,
    covers: string,
    giver: ConsentRecord["giver"],
    giverName: string,
    relationship: string,
    signedOn: string,
    reviewOn: string,
    outcome?: string,
  ): ConsentRecord => ({
    id: `consent-showcase-${individualId.slice(-4)}-${typeId}`,
    agencyId: agency,
    individualId,
    typeId,
    covers,
    giver,
    giverName,
    relationship,
    ...(outcome ? { outcome } : {}),
    signedOn,
    effectiveOn: signedOn,
    reviewOn,
    supersedesId: null,
    createdBy: sarah,
    createdAt: `${signedOn}T15:00:00.000Z`,
    activatedBy: sarah,
    activatedAt: `${signedOn}T15:05:00.000Z`,
  });

  const records: ConsentRecord[] = [
    // Ellis Hart — signed by his sister Dana at the January plan meeting.
    make(ellis, "service", "Residential services at Cedar House", "representative", "Dana Hart", "Sibling", "2026-01-12", "2027-01-12"),
    make(ellis, "medication", "All medications on the current MAR", "representative", "Dana Hart", "Sibling", "2026-01-12", "2027-01-12"),
    make(ellis, "information", "Health information exchange with treating providers", "representative", "Dana Hart", "Sibling", "2026-01-12", "2027-01-12"),
    make(ellis, "emergency", "Emergency medical care when the representative cannot be reached", "representative", "Dana Hart", "Sibling", "2026-01-12", "2027-01-12"),
    make(ellis, "rights", "Individual rights and grievance process acknowledgement", "representative", "Dana Hart", "Sibling", "2026-01-12", "2027-01-12"),
    make(ellis, "outings", "Supported community activities with staff", "representative", "Dana Hart", "Sibling", "2026-01-12", "2027-01-12"),
    // Ellis's media release is the one consent in its review window.
    make(ellis, "media", "Photographs and video for agency recreation and promotion", "representative", "Dana Hart", "Sibling", addDaysIso(today, -349), addDaysIso(today, 16), "group"),
    // Harper Soto — signed by her brother Luis in March.
    make(harper, "service", "Residential services at Willow House", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02"),
    make(harper, "medication", "All medications on the current MAR", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02"),
    make(harper, "information", "Health information exchange with treating providers", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02"),
    make(harper, "emergency", "Emergency medical care when the representative cannot be reached", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02"),
    make(harper, "rights", "Individual rights and grievance process acknowledgement", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02"),
    make(harper, "photograph", "Identification and recreation photographs", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02"),
    make(harper, "outings", "Supported community activities with staff", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02"),
    make(harper, "media", "Photographs and video for agency recreation and promotion", "representative", "Luis Soto", "Sibling", "2026-03-02", "2027-03-02", "group"),
    // Reese Lang — signed by her guardian Pat; the rest are still to collect.
    make(reese, "service", "Residential services at Willow House", "guardian", "Pat Lang", "Guardian", "2026-01-19", "2027-01-19"),
    make(reese, "medication", "All medications on the current MAR, including enteral feeding support", "guardian", "Pat Lang", "Guardian", "2026-01-19", "2027-01-19"),
    make(reese, "emergency", "Emergency medical care when the guardian cannot be reached", "guardian", "Pat Lang", "Guardian", "2026-01-19", "2027-01-19"),
  ];
  for (const record of records) {
    if (!db.consents.some((row) => row.id === record.id)) db.consents.push(record);
  }

  // One packet in progress: Morgan's annual packet, sent to her mother
  // Robin two days ago and awaiting signature.
  db.consentPackets ??= [];
  db.consentPacketAudit ??= [];
  const packetId = "packet-showcase-morgan";
  if (!db.consentPackets.some((row) => row.id === packetId)) {
    const packet: ConsentPacket = {
      id: packetId,
      agencyId: agency,
      individualId: morgan,
      createdBy: sarah,
      createdAt: hoursAgo(52),
      snapshot: {
        individualName: "Morgan Pruitt",
        agencyName: db.agencies[0]?.name ?? "Evergreen Care",
        signerName: "Robin Pruitt",
        effectiveOn: addDaysIso(today, 1),
        reviewOn: addDaysIso(today, 366),
        copyVersion: PACKET_COPY_VERSION,
        items: structuredClone(PACKET_ITEMS),
        healthScope: [...HEALTH_SCOPE],
      },
      status: "sent",
      generatedAt: hoursAgo(51),
      sentAt: hoursAgo(50),
      openedAt: null,
      signedAt: null,
      filedAt: null,
      linkExpiresAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
      outstandingAfterDays: 3,
      choices: null,
      signer: null,
      evidenceName: null,
    };
    db.consentPackets.push(packet);
    db.consentPacketAudit.push(
      { packetId, event: "draft", at: hoursAgo(52) },
      { packetId, event: "generated", at: hoursAgo(51) },
      { packetId, event: "sent", at: hoursAgo(50) },
    );
  }
}

/* ---------------------------- Life events ---------------------------- */

function addLifeEvents(db: LocalDatabase) {
  const today = todayIso();
  const james = userId(db, "James Wilson");
  const jordan = userId(db, "Jordan Lee");
  const willow = siteId(db, "Willow House");
  const harper = idOf(db, "Harper Soto");
  const reese = idOf(db, "Reese Lang");
  db.lifeEvents ??= [];
  const events: LifeEventRow[] = [
    {
      id: "life-showcase-harper-move-in", agencyId: agencyId(db), siteId: willow, individualId: harper,
      eventDate: "2025-03-01", category: "admission_move_in",
      title: "Moved into Willow House",
      note: "Admitted from a family home setting. Her brother Luis Soto is the emergency contact.",
      relatedGerId: null, recordedBy: james,
      createdAt: "2025-03-01T20:00:00.000Z", updatedBy: null, updatedAt: null,
      voidedBy: null, voidedAt: null, voidReason: null,
    },
    {
      id: "life-showcase-harper-er", agencyId: agencyId(db), siteId: willow, individualId: harper,
      eventDate: addDaysIso(today, -42), category: "hospital_er_stay",
      title: "Emergency department visit for dizziness",
      note: "Evaluated the same evening and discharged home. Her blood pressure medication was reviewed, and staff were told to log morning readings before the dose.",
      relatedGerId: null, recordedBy: james,
      createdAt: `${addDaysIso(today, -42)}T20:00:00.000Z`, updatedBy: null, updatedAt: null,
      voidedBy: null, voidedAt: null, voidReason: null,
    },
    {
      id: "life-showcase-harper-volunteer", agencyId: agencyId(db), siteId: willow, individualId: harper,
      eventDate: addDaysIso(today, -13), category: "milestone",
      title: "Started a Tuesday volunteer shift at the public library",
      note: "Two hours each Tuesday, with job-coach support for the first month.",
      relatedGerId: null, recordedBy: jordan,
      createdAt: `${addDaysIso(today, -13)}T20:00:00.000Z`, updatedBy: null, updatedAt: null,
      voidedBy: null, voidedAt: null, voidReason: null,
    },
    {
      id: "life-showcase-reese-program", agencyId: agencyId(db), siteId: willow, individualId: reese,
      eventDate: addDaysIso(today, -30), category: "day_program_change",
      title: "Began a weekday program at the Columbia Activity Center",
      note: "Attends Monday to Friday; the van pickup moved to 8:15 a.m.",
      relatedGerId: null, recordedBy: jordan,
      createdAt: `${addDaysIso(today, -30)}T20:00:00.000Z`, updatedBy: null, updatedAt: null,
      voidedBy: null, voidedAt: null, voidReason: null,
    },
  ];
  for (const event of events) {
    if (!db.lifeEvents.some((row) => row.id === event.id)) db.lifeEvents.push(event);
  }
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, "");
}
