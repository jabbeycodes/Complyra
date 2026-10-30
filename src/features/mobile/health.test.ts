import { test } from "node:test";
import assert from "node:assert/strict";
import type { HealthTrackEntry } from "../../data/healthTrack";
import {
  EPISODIC_HEALTH_KINDS,
  MOBILE_HEALTH_KINDS,
  healthHomeStatuses,
  initialHealthDetails,
  todaysHealthEntryCount,
  trackerStatus,
} from "./health";

const TODAY = "2026-10-29";

function entry(
  partial: Partial<HealthTrackEntry> & Pick<HealthTrackEntry, "kind" | "occurredOn">,
): HealthTrackEntry {
  return {
    id: `e-${partial.kind}-${partial.occurredOn}-${Math.random()}`,
    agencyId: "agency",
    individualId: "person",
    title: "Entry",
    details: {},
    flaggedAbnormal: false,
    note: "",
    recordedByUserId: "staff",
    createdAt: `${partial.occurredOn}T12:00:00.000Z`,
    ...partial,
  };
}

test("the mobile home carries exactly the seven day-to-day trackers", () => {
  assert.deepEqual([...MOBILE_HEALTH_KINDS], [
    "intake",
    "elimination",
    "vitals",
    "glucose",
    "skin",
    "seizure",
    "menses",
  ]);
  // Medications are the MAR's own view — never a tracker kind here.
  assert.ok(!(MOBILE_HEALTH_KINDS as readonly string[]).includes("medications"));
});

test("a tracker with entries today reports the count and the latest headline", () => {
  const entries = [
    entry({
      kind: "intake",
      occurredOn: TODAY,
      title: "Breakfast — ate most",
      createdAt: `${TODAY}T13:00:00.000Z`,
    }),
    entry({
      kind: "intake",
      occurredOn: TODAY,
      title: "Water — 8 oz",
      createdAt: `${TODAY}T15:30:00.000Z`,
    }),
    entry({ kind: "intake", occurredOn: "2026-10-28", title: "Dinner — ate all" }),
  ];
  const status = trackerStatus(entries, "intake", TODAY);
  assert.equal(status.todayCount, 2);
  assert.equal(status.text, "2 logged today · latest: Water — 8 oz");
});

test("a single entry today names it without a count prefix", () => {
  const entries = [
    entry({
      kind: "elimination",
      occurredOn: TODAY,
      title: "Bowel movement — medium, formed",
      details: { timeOfDay: "09:15" },
    }),
  ];
  const status = trackerStatus(entries, "elimination", TODAY);
  assert.equal(status.todayCount, 1);
  assert.equal(
    status.text,
    "Logged today · Bowel movement — medium, formed · 9:15 AM",
  );
});

test("a daily tracker with nothing today points at the last entry", () => {
  const entries = [
    entry({ kind: "vitals", occurredOn: "2026-10-27", title: "Temp 98.4°F" }),
  ];
  const status = trackerStatus(entries, "vitals", TODAY);
  assert.equal(status.todayCount, 0);
  assert.equal(
    status.text,
    "Nothing yet today · last: Tue, Oct 27 · Temp 98.4°F",
  );
});

test("episodic kinds report the last-logged date, never a missing-today frame", () => {
  assert.ok(EPISODIC_HEALTH_KINDS.has("seizure"));
  assert.ok(EPISODIC_HEALTH_KINDS.has("menses"));
  const entries = [
    entry({
      kind: "seizure",
      occurredOn: "2026-09-14",
      title: "Tonic-clonic — 2 min",
    }),
  ];
  const status = trackerStatus(entries, "seizure", TODAY);
  assert.equal(status.todayCount, 0);
  assert.equal(status.text, "Last logged Mon, Sep 14 · Tonic-clonic — 2 min");
});

test("a tracker never logged says so plainly", () => {
  const status = trackerStatus([], "skin", TODAY);
  assert.equal(status.todayCount, 0);
  assert.equal(status.lastEntry, null);
  assert.equal(status.text, "Nothing logged yet");
});

test("the home statuses come back in display order for all seven kinds", () => {
  const statuses = healthHomeStatuses(
    [entry({ kind: "glucose", occurredOn: TODAY, title: "Glucose 96 mg/dL" })],
    TODAY,
  );
  assert.deepEqual(
    statuses.map((row) => row.kind),
    [...MOBILE_HEALTH_KINDS],
  );
  assert.equal(statuses.find((row) => row.kind === "glucose")?.todayCount, 1);
});

test("today's entry count sums the seven trackers and nothing else", () => {
  const entries = [
    entry({ kind: "intake", occurredOn: TODAY }),
    entry({ kind: "intake", occurredOn: TODAY }),
    entry({ kind: "seizure", occurredOn: TODAY }),
    entry({ kind: "vitals", occurredOn: "2026-10-28" }),
    // Chart-only kinds are not part of the mobile seven — never counted.
    entry({ kind: "lab", occurredOn: TODAY }),
    entry({ kind: "sleep", occurredOn: TODAY }),
  ];
  assert.equal(todaysHealthEntryCount(entries, TODAY), 3);
  assert.equal(todaysHealthEntryCount([], TODAY), 0);
});

test("quick-log sheets prefill the time of day only for kinds that carry one", () => {
  const now = new Date("2026-10-29T14:05:00.000Z"); // 9:05 AM Central (CDT)
  assert.equal(initialHealthDetails("seizure", now).timeOfDay, "09:05");
  assert.equal(initialHealthDetails("glucose", now).timeOfDay, "09:05");
  assert.deepEqual(initialHealthDetails("vitals", now), {});
  assert.deepEqual(initialHealthDetails("skin", now), {});
});
