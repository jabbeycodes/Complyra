import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildDrillSchedulePdf,
  drillScheduleFileName,
} from "./drillSchedulePdf";
import {
  buildHmChecklistsPdf,
  buildServiceLogsPdf,
  hmChecklistsFileName,
  serviceLogsFileName,
} from "./checklistsPdf";
import { drillScheduleYearSummary } from "../data/drillSchedule";
import type { EmergencyDrill } from "../data/monthlyChecks";
import type { HmWeeklyChecklist } from "../data/types";

const FORBIDDEN = ["client", "patient", "T-Log", "t-log"];

function assertIndividualSafe(text: string, label: string) {
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN) {
    assert.ok(
      !lower.includes(word.toLowerCase()),
      `${label} contains forbidden wording "${word}"`,
    );
  }
}

test("drill schedule pdf renders the full year with late flags", () => {
  const records: EmergencyDrill[] = [
    {
      id: "d1",
      agencyId: "a1",
      siteId: "s1",
      monthKey: "2026-08",
      drillType: "fire",
      date: "2026-08-05",
      time: "10:00 AM",
      evacTime: "3 minutes",
      leaderName: "Dana Staff",
      participants: "Team A",
      awakeOrSleep: "awake",
    },
    {
      id: "d2",
      agencyId: "a1",
      siteId: "s1",
      monthKey: "2026-08",
      drillType: "tornado",
      date: "2026-08-09",
      time: null,
      evacTime: null,
      leaderName: null,
      participants: "",
      awakeOrSleep: "",
    },
  ];
  const months = drillScheduleYearSummary(2026, records);
  const doc = buildDrillSchedulePdf({
    agencyName: "Test Agency",
    siteName: "Maple House",
    year: 2026,
    months,
  });
  assert.ok(doc.getNumberOfPages() >= 1, "produces at least one page");
  const text = doc.output() as string;
  assert.ok(text.includes("Emergency Drills Schedule"), "has the schedule title");
  assert.ok(text.includes("January"), "lists January");
  assert.ok(text.includes("December"), "lists December");
  assert.ok(text.includes("Late"), "flags the late tornado drill");
  assert.ok(text.includes("Not logged"), "shows missing drills");
  assert.ok(text.includes("7th of each month"), "states the due-day rule");
  assertIndividualSafe(text, "drill schedule pdf");
});

test("drill schedule file name is the documented format", () => {
  assert.equal(
    drillScheduleFileName("Maple House", 2026),
    "complyrer-emergency-drill-schedule-maple-house-2026.pdf",
  );
});

function checklist(): HmWeeklyChecklist {
  return {
    id: "c1",
    agencyId: "a1",
    siteId: "s1",
    weekOf: "2026-09-13",
    assignedToUserId: "u1",
    assignedByUserId: null,
    status: "submitted",
    submittedAt: "2026-09-15T10:00:00Z",
    items: [
      { key: "i1", prompt: "Medications are stored securely.", answer: "Y", note: "" },
      { key: "i2", prompt: "Smoke detectors working.", answer: "N", note: "Replaced battery." },
    ],
    serviceLogs: [],
    attestation: null,
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
  };
}

test("hm checklists pdf renders a filtered month", () => {
  const doc = buildHmChecklistsPdf({
    agencyName: "Test Agency",
    siteName: "Maple House",
    scopeLabel: "September 2026",
    checklists: [checklist()],
  });
  assert.ok(doc.getNumberOfPages() >= 1);
  const text = doc.output() as string;
  assert.ok(text.includes("September 2026"), "shows the scope label");
  assert.ok(text.includes("Medications are stored securely."), "renders items");
  assert.ok(text.includes("Replaced battery."), "renders notes");
  assertIndividualSafe(text, "hm checklists pdf");
});

test("service logs pdf renders log entries", () => {
  const doc = buildServiceLogsPdf({
    agencyName: "Test Agency",
    siteName: "Maple House",
    scopeLabel: "All months",
    logs: [
      {
        id: "l1",
        kind: "class_reminder",
        detail: "Reminder about the weekend outing.",
        staffName: "Dana Staff",
        dateTime: "2026-09-14",
        createdAt: "2026-09-14T10:00:00Z",
        weekOf: "2026-09-13",
      },
    ],
  });
  assert.ok(doc.getNumberOfPages() >= 1);
  const text = doc.output() as string;
  assert.ok(text.includes("Reminder about the weekend outing."), "renders the log");
  assertIndividualSafe(text, "service logs pdf");
});

test("checklist and service-log file names reflect the month scope", () => {
  assert.equal(
    hmChecklistsFileName("Maple House", "September 2026"),
    "complyrer-hm-weekly-checklists-maple-house-september-2026.pdf",
  );
  assert.equal(
    serviceLogsFileName("Maple House", "All months"),
    "complyrer-weekly-service-logs-maple-house-all-months.pdf",
  );
});

test("drill schedule file name supports a month scope", () => {
  assert.equal(
    drillScheduleFileName("Maple House", 2026, 9),
    "complyrer-emergency-drill-schedule-maple-house-2026-09.pdf",
  );
  assert.equal(
    drillScheduleFileName("Maple House", 2026, null),
    "complyrer-emergency-drill-schedule-maple-house-2026.pdf",
  );
});

test("drill schedule pdf renders a single-month scope with form fields", () => {
  const records: EmergencyDrill[] = [
    {
      id: "d1",
      agencyId: "a1",
      siteId: "s1",
      monthKey: "2026-09",
      drillType: "fire",
      date: "2026-09-05",
      time: "10:00 AM",
      evacTime: "3 minutes",
      leaderName: "Dana Staff",
      participants: "Team A",
      awakeOrSleep: "sleep",
    },
    {
      id: "d2",
      agencyId: "a1",
      siteId: "s1",
      monthKey: "2026-09",
      drillType: "missing_person",
      date: "2026-09-06",
      time: "11:00 PM",
      evacTime: "",
      leaderName: "Dana Staff",
      participants: "Team B",
      awakeOrSleep: "",
    },
  ];
  const months = drillScheduleYearSummary(2026, records).filter(
    (m) => m.month.month === 9,
  );
  const doc = buildDrillSchedulePdf({
    agencyName: "Test Agency",
    siteName: "Maple House",
    year: 2026,
    months,
    scopeLabel: "September 2026",
  });
  const text = doc.output() as string;
  assert.ok(text.includes("September 2026"), "shows the month scope label");
  assert.ok(!text.includes("August ·"), "does not include other month sections");
  assert.ok(text.includes("Awake / sleep"), "shows the awake/sleep form field");
  assert.ok(text.includes("Sleep"), "renders the awake/sleep value");
  assert.ok(text.includes("Evacuation time"), "shows drill form fields");
  assert.ok(text.includes("Drill leader"), "shows the drill leader field");
  assertIndividualSafe(text, "month-scoped drill schedule pdf");
});
