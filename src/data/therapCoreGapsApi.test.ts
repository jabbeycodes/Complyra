/**
 * therapCoreGapsApi.test.ts — THERAP-CORE-GAPS-1 through the local API:
 * event reports (draft -> submit -> approve, follow-up lifecycle, manager
 * alerts), behavior plans + log, and health trackers with alerts.
 *
 * Run: node --import tsx --test src/data/therapCoreGapsApi.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD as DEMO_PW } from "./types";

function makeStore() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

const login = (username: string) => ({
  agencyCode: DEMO_AGENCY_CODE,
  username,
  password: DEMO_PW,
});

/** An individual who lives at the demo house manager's site. */
function personAtHmSite(store: MemoryStore, hmSiteId: string | null) {
  const person = store.db.individuals.find((row) => row.siteId === hmSiteId);
  assert.ok(person, "seed has an individual at the HM site");
  return person!;
}

test("ger api: draft -> submit alerts managers -> approve -> resolve", async () => {
  const store = makeStore();
  const api = new LocalApi(store);

  const hm = await api.signIn(login(DEMO_HM_USERNAME));
  const person = personAtHmSite(store, hm.siteId);

  const draft = await api.createGerReport({
    siteId: person.siteId,
    individualId: person.id,
    eventDate: "2026-10-26",
    eventTime: "09:15",
    location: "Kitchen",
    eventType: "Fall",
    severity: "High",
    description: "Slipped on a wet floor.",
    immediateActions: "First aid; vitals checked.",
    notificationsMade: [{ party: "Guardian", name: "Mary", atTime: "09:40" }],
    reporterName: "House Manager",
    reporterSignature: "House Manager",
    reporterDate: "2026-10-26",
  });
  assert.equal(draft.status, "draft");
  assert.equal(draft.resolutionStatus, "unaddressed");

  const submitted = await api.submitGerReport(draft.id);
  assert.equal(submitted.status, "submitted");

  // Alerts: HM direct + program_manager + nurse broadcasts, deduped.
  const alerts = store.db.notifications.filter((n) =>
    n.dedupeKey.startsWith(`incident.followup:ger:${draft.id}:`),
  );
  assert.ok(alerts.some((n) => n.userId === hm.userId), "HM got a direct alert");
  assert.ok(alerts.some((n) => n.roleKey === "program_manager"));
  assert.ok(alerts.some((n) => n.roleKey === "nurse"));
  assert.ok(!alerts.some((n) => n.roleKey === "auditor"), "auditors get no alerts");
  const alertCount = alerts.length;
  await api.listAgencyGerReports();
  const after = store.db.notifications.filter((n) =>
    n.dedupeKey.startsWith(`incident.followup:ger:${draft.id}:`),
  );
  assert.equal(after.length, alertCount, "relisting never duplicates alerts");

  // Dashboard list includes the submitted report for the HM.
  const agencyRows = await api.listAgencyGerReports();
  assert.ok(agencyRows.some((r) => r.id === draft.id));

  // A DSP cannot review.
  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(() => api.reviewGerReport(draft.id, "approved"));

  // The nurse approves, then works the follow-up to resolution.
  await api.signOut();
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const approved = await api.reviewGerReport(draft.id, "approved", "Reviewed.");
  assert.equal(approved.status, "approved");

  await assert.rejects(() =>
    api.updateGerResolution(draft.id, { resolutionStatus: "resolved" }),
  );
  const resolved = await api.updateGerResolution(draft.id, {
    resolutionStatus: "resolved",
    assignedManagerUserId: hm.userId,
    resolutionDueOn: "2026-10-30",
    closureNote: "Floor mat replaced; guardian updated.",
  });
  assert.equal(resolved.resolutionStatus, "resolved");
  assert.ok(resolved.resolvedAt);

  // Approved reports are locked against edits.
  await assert.rejects(() =>
    api.updateGerReport(draft.id, {
      siteId: person.siteId,
      individualId: person.id,
      eventDate: "2026-10-26",
      eventTime: "09:15",
      location: "Kitchen",
      eventType: "Fall",
      severity: "Low",
      description: "Changed.",
      immediateActions: "",
      reporterName: "House Manager",
      reporterSignature: "House Manager",
      reporterDate: "2026-10-26",
    }),
  );
});

test("behavior api: plan is manager-owned, log is open to DSP", async () => {
  const store = makeStore();
  const api = new LocalApi(store);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  void admin;
  const person = store.db.individuals[0];

  const plan = await api.saveBehaviorPlan(person.id, {
    targetBehaviors: "Verbal outbursts\nLeaving the area",
    interventions: "Offer a break and a quiet space.",
    crisisSteps: "1. Step back. 2. Give space. 3. Call the house manager.",
  });
  assert.equal(plan.individualId, person.id);
  const fetched = await api.getBehaviorPlan(person.id);
  assert.equal(fetched?.id, plan.id);

  await api.signOut();
  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(() =>
    api.saveBehaviorPlan(person.id, {
      targetBehaviors: "X",
      interventions: "Y",
      crisisSteps: "Z",
    }),
  );
  const entry = await api.addBehaviorEntry(person.id, {
    occurredOn: "2026-10-26",
    occurredAtTime: "18:20",
    behavior: "Verbal outbursts",
    antecedent: "Dinner ran late",
    durationMinutes: 8,
    intensity: "Moderate",
    interventionUsed: "Offered a break",
    outcome: "Calmed",
  });
  assert.equal(entry.behavior, "Verbal outbursts");
  const entries = await api.listBehaviorEntries(person.id);
  assert.equal(entries.length, 1);
});

test("health api: flagged lab alerts managers; overdue immunization alerts once", async () => {
  const store = makeStore();
  const api = new LocalApi(store);
  const hm = await api.signIn(login(DEMO_HM_USERNAME));
  const person = personAtHmSite(store, hm.siteId);

  const lab = await api.addHealthTrackEntry(person.id, {
    kind: "lab",
    occurredOn: "2026-10-26",
    details: { testName: "A1C", resultValue: "9.4", unit: "%" },
    flaggedAbnormal: true,
  });
  const labAlerts = store.db.notifications.filter((n) =>
    n.dedupeKey.startsWith(`incident.followup:health:${lab.id}:`),
  );
  assert.ok(labAlerts.some((n) => n.roleKey === "nurse"));
  assert.ok(labAlerts.some((n) => n.userId === hm.userId));

  // A plain sleep record alerts nobody.
  const before = store.db.notifications.length;
  await api.addHealthTrackEntry(person.id, {
    kind: "sleep",
    occurredOn: "2026-10-26",
    details: { hoursSlept: "6", quality: "Fair", interruptions: "2" },
  });
  assert.equal(store.db.notifications.length, before);

  // Overdue immunization: the alert fires when the list is read, once.
  const shot = await api.addHealthTrackEntry(person.id, {
    kind: "immunization",
    occurredOn: "2025-10-01",
    details: { vaccineName: "Influenza", doseLabel: "Annual", nextDueOn: "2026-10-01" },
  });
  await api.listHealthTrackEntries({ individualId: person.id, kind: "immunization" });
  const firstCount = store.db.notifications.filter((n) =>
    n.dedupeKey.startsWith(`incident.followup:health:${shot.id}:`),
  ).length;
  assert.ok(firstCount > 0, "overdue immunization alerted");
  await api.listHealthTrackEntries({ individualId: person.id, kind: "immunization" });
  const secondCount = store.db.notifications.filter((n) =>
    n.dedupeKey.startsWith(`incident.followup:health:${shot.id}:`),
  ).length;
  assert.equal(secondCount, firstCount, "overdue alert is deduped");
});

test("ger api: a report filed under the wrong home is rejected", async () => {
  const store = makeStore();
  const api = new LocalApi(store);
  const hm = await api.signIn(login(DEMO_HM_USERNAME));
  const person = personAtHmSite(store, hm.siteId);
  const otherSite = store.db.sites.find(
    (row) => row.id !== person.siteId && row.agencyId === hm.agencyId,
  );
  assert.ok(otherSite, "seed has a second site");

  // Claiming another home for this Individual must fail: the report, its
  // dashboard rows, and its alerts belong to the Individual's home.
  await assert.rejects(
    () =>
      api.createGerReport({
        siteId: otherSite!.id,
        individualId: person.id,
        eventDate: "2026-10-26",
        eventTime: "10:00",
        location: "Kitchen",
        immediateActions: "Checked on them.",
        eventType: "Fall",
        severity: "Low",
        description: "Filed under the wrong home.",
        reporterName: "House Manager",
        reporterSignature: "House Manager",
        reporterDate: "2026-10-26",
      }),
    /must be filed under the home/,
  );
});

test("ger api: a linked Individual from another home is rejected", async () => {
  const store = makeStore();
  const api = new LocalApi(store);
  const hm = await api.signIn(login(DEMO_HM_USERNAME));
  const person = personAtHmSite(store, hm.siteId);
  const elsewhere = store.db.individuals.find(
    (row) => row.siteId !== person.siteId && row.agencyId === hm.agencyId,
  );
  assert.ok(elsewhere, "seed has an individual at another home");

  await assert.rejects(
    () =>
      api.createGerReport({
        siteId: person.siteId,
        individualId: person.id,
        linkedIndividualIds: [elsewhere!.id],
        eventDate: "2026-10-26",
        eventTime: "10:00",
        location: "Kitchen",
        immediateActions: "Checked on them.",
        eventType: "Fall",
        severity: "Low",
        description: "Links an Individual from another home.",
        reporterName: "House Manager",
        reporterSignature: "House Manager",
        reporterDate: "2026-10-26",
      }),
    /linked Individual must live/,
  );
});

test("ger api: changing the Individual on a draft re-derives the home", async () => {
  const store = makeStore();
  const api = new LocalApi(store);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const first = store.db.individuals.find((row) => row.agencyId === admin.agencyId);
  assert.ok(first);
  const second = store.db.individuals.find(
    (row) => row.agencyId === admin.agencyId && row.siteId !== first!.siteId,
  );
  assert.ok(second, "seed has an individual at a second home");

  const created = await api.createGerReport({
    siteId: first!.siteId,
    individualId: first!.id,
    eventDate: "2026-10-26",
    eventTime: "10:00",
    location: "Kitchen",
    immediateActions: "Checked on them.",
    eventType: "Fall",
    severity: "Low",
    description: "About the first Individual.",
    reporterName: "Admin",
    reporterSignature: "Admin",
    reporterDate: "2026-10-26",
  });
  assert.equal(created.siteId, first!.siteId);

  // The edit form still carries the OLD siteId; the stored report must
  // follow the new Individual's home, not the stale form value.
  const updated = await api.updateGerReport(created.id, {
    siteId: first!.siteId,
    individualId: second!.id,
    eventDate: "2026-10-26",
    eventTime: "10:00",
    location: "Kitchen",
    immediateActions: "Checked on them.",
    eventType: "Fall",
    severity: "Low",
    description: "Corrected to the second Individual.",
    reporterName: "Admin",
    reporterSignature: "Admin",
    reporterDate: "2026-10-26",
  });
  assert.equal(updated.individualId, second!.id);
  assert.equal(updated.siteId, second!.siteId);
});

test("behavior api: a correction needs a rationale and preserves the original", async () => {
  const store = makeStore();
  const api = new LocalApi(store);
  const person = store.db.individuals[0];

  await api.signIn(login(DEMO_DSP_USERNAME));
  const entry = await api.addBehaviorEntry(person.id, {
    occurredOn: "2026-10-26",
    occurredAtTime: "18:20",
    behavior: "Verbal outbursts",
    antecedent: "Dinner ran late",
    durationMinutes: 8,
    intensity: "Moderate",
    interventionUsed: "Offered a break",
    outcome: "Calmed",
  });

  // The nurse may correct another recorder's entry — but never without
  // stating the reason.
  await api.signOut();
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(
    () =>
      api.correctBehaviorEntry(
        entry.id,
        {
          occurredOn: "2026-10-26",
          occurredAtTime: "18:20",
          behavior: "Verbal outbursts",
          antecedent: "Dinner ran late",
          durationMinutes: 8,
          intensity: "Moderate",
          interventionUsed: "Offered a break",
          outcome: "De-escalated",
        },
        "   ",
      ),
    /reason for the correction/,
  );

  const corrected = await api.correctBehaviorEntry(
    entry.id,
    {
      occurredOn: "2026-10-26",
      occurredAtTime: "18:20",
      behavior: "Verbal outbursts",
      antecedent: "Dinner ran late",
      durationMinutes: 8,
      intensity: "Moderate",
      interventionUsed: "Offered a break",
      outcome: "De-escalated",
    },
    "Outcome confirmed with the home team by phone.",
  );
  assert.equal(corrected.outcome, "De-escalated");
  assert.equal(corrected.recordedByUserId, entry.recordedByUserId);

  const history = store.db.behaviorEntryHistory.filter(
    (row) => row.entryId === entry.id,
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].outcome, "Calmed");
  assert.equal(history[0].isCorrection, true);
  assert.equal(
    history[0].correctionRationale,
    "Outcome confirmed with the home team by phone.",
  );
  assert.ok(history[0].replacedByUserId);
});

test("health api: a correction needs a rationale and preserves the original", async () => {
  const store = makeStore();
  const api = new LocalApi(store);
  const hm = await api.signIn(login(DEMO_HM_USERNAME));
  const person = personAtHmSite(store, hm.siteId);

  const lab = await api.addHealthTrackEntry(person.id, {
    kind: "lab",
    occurredOn: "2026-10-26",
    details: { testName: "A1C", resultValue: "9.4", unit: "%" },
    flaggedAbnormal: true,
    note: "Result phoned in",
  });

  await api.signOut();
  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(
    () =>
      api.correctHealthTrackEntry(
        lab.id,
        {
          kind: "lab",
          occurredOn: "2026-10-26",
          details: { testName: "A1C", resultValue: "7.9", unit: "%" },
          flaggedAbnormal: true,
          note: "Result phoned in",
        },
        "",
      ),
    /reason for the correction/,
  );

  const corrected = await api.correctHealthTrackEntry(
    lab.id,
    {
      kind: "lab",
      occurredOn: "2026-10-26",
      details: { testName: "A1C", resultValue: "7.9", unit: "%" },
      flaggedAbnormal: true,
      note: "Result phoned in",
    },
    "Result value verified against the lab portal.",
  );
  assert.equal(corrected.details.resultValue, "7.9");
  assert.equal(corrected.recordedByUserId, lab.recordedByUserId);

  const history = store.db.healthTrackEntryHistory.filter(
    (row) => row.entryId === lab.id,
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].details.resultValue, "9.4");
  assert.equal(history[0].isCorrection, true);
  assert.equal(
    history[0].correctionRationale,
    "Result value verified against the lab portal.",
  );
});
