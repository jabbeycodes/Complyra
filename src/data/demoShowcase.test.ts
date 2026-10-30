import { test } from "node:test";
import assert from "node:assert/strict";
import { todayIso } from "./chart";
import { dueItemClock } from "./operatingReminders";
import { addDaysIso, blankItemNumbers, weekOfSundayIso } from "./hmChecklist";
import { monthKeyFrom } from "./monthlyChecks";
import { createEvergreenSeed } from "./seed";
import { centralTodayIso } from "./menuRecords";
import { isSiteReviewInPlace, siteFactsFrom } from "./siteReview";

function seed() {
  return createEvergreenSeed();
}

function person(db: ReturnType<typeof seed>, name: string) {
  const row = db.individuals.find((item) => item.fullName === name);
  assert.ok(row, name);
  return row;
}

test("walkthrough charts are filled for all four individuals", () => {
  const db = seed();
  assert.equal(db.showcaseRevision, 7);
  for (const name of ["Ellis Hart", "Morgan Pruitt", "Reese Lang", "Harper Soto"]) {
    const row = person(db, name);
    assert.ok(row.profile?.phone, `${name} phone`);
    assert.ok((row.profile?.allergies.length ?? 0) > 0, `${name} allergies`);
    assert.ok(
      db.medications.some((med) => med.individualId === row.id),
      `${name} medications`,
    );
  }
  const ellis = person(db, "Ellis Hart");
  assert.ok(db.medications.some((med) => med.id === `${ellis.id}-med-keppra`));
  const today = todayIso();
  assert.equal(
    db.medDoseMarks.some(
      (mark) => mark.medicationId === `${ellis.id}-med-keppra` && mark.doseDate === today && mark.doseTime === "08:00",
    ),
    false,
    "Ellis's 8:00 levetiracetam stays unmarked",
  );
});

test("both houses have a current-month mileage log and a filled checklist", () => {
  const db = seed();
  const month = monthKeyFrom(todayIso());
  for (const siteName of ["Cedar House", "Willow House"]) {
    const site = db.sites.find((row) => row.name === siteName)!;
    assert.ok(
      db.mileageTrips.some((trip) => trip.siteId === site.id && trip.tripDate.startsWith(month)),
      `${siteName} mileage`,
    );
    const submitted = (db.weeklyChecklists ?? []).filter(
      (row) => row.siteId === site.id && row.status === "submitted",
    );
    assert.ok(submitted.length >= 1, `${siteName} submitted checklist`);
    assert.deepEqual(blankItemNumbers(submitted[0].items), []);
    const open = (db.weeklyChecklists ?? []).find(
      (row) => row.siteId === site.id && row.status === "open" && row.weekOf === weekOfSundayIso(todayIso()),
    );
    assert.ok(open, `${siteName} current week is open`);
    assert.deepEqual(blankItemNumbers(open.items), []);
  }
});

test("each person has two weeks of shift notes, and Morgan's program stays a single draft", () => {
  const db = seed();
  const yesterday = dueItemClock().serviceDate;
  const windowStart = addDaysIso(yesterday, -13);
  const morgan = person(db, "Morgan Pruitt");
  const alex = db.profiles.find((row) => row.fullName === "Alex Morgan")!;
  assert.equal(
    db.shiftNotes.some(
      (note) =>
        !note.deletedAt &&
        note.individualId === morgan.id &&
        note.staffUserId === alex.id &&
        note.noteDate === yesterday &&
        note.shift === "7a–3p",
    ),
    false,
    "Alex still owes Morgan's day note",
  );
  const morganPrograms = db.ispPrograms.filter((program) => program.individualId === morgan.id);
  assert.equal(morganPrograms.length, 1);
  assert.equal(morganPrograms[0].status, "draft");

  const reese = person(db, "Reese Lang");
  assert.ok(
    db.ispPrograms.some(
      (program) => program.individualId === reese.id && program.status === "approved",
    ),
  );

  for (const name of ["Ellis Hart", "Morgan Pruitt", "Reese Lang", "Harper Soto"]) {
    const row = person(db, name);
    const notes = db.shiftNotes.filter(
      (note) =>
        !note.deletedAt &&
        note.individualId === row.id &&
        note.noteDate >= windowStart &&
        note.noteDate <= yesterday,
    );
    assert.ok(notes.length >= 10, `${name} has ${notes.length} notes in the window`);
    assert.ok(
      db.shiftNotes.filter((note) => note.individualId === row.id && !note.deletedAt).length <= 30,
      `${name} stays inside the chart's 30-note window`,
    );
  }
});

test("the mobile Health home opens populated for Ellis and Harper", () => {
  const db = seed();
  const today = centralTodayIso();
  // Both open with today-dated entries; Harper's skin check sits two days
  // back on purpose, so her home also shows a "last logged" state.
  const todayKinds: Record<string, string[]> = {
    "Ellis Hart": ["intake", "elimination", "vitals", "glucose", "skin"],
    "Harper Soto": ["intake", "elimination", "vitals", "glucose"],
  };
  for (const [name, kinds] of Object.entries(todayKinds)) {
    const row = person(db, name);
    for (const kind of kinds) {
      assert.ok(
        db.healthTrackEntries.some(
          (entry) =>
            entry.individualId === row.id &&
            entry.kind === kind &&
            entry.occurredOn === today,
        ),
        `${name} has a ${kind} entry today`,
      );
    }
  }
  const harperRow = person(db, "Harper Soto");
  assert.ok(
    db.healthTrackEntries.some(
      (entry) =>
        entry.individualId === harperRow.id &&
        entry.kind === "skin" &&
        entry.occurredOn < today,
    ),
    "Harper has an earlier skin check",
  );
  // Episodic kinds carry a last-logged date, not a today entry.
  const ellis = person(db, "Ellis Hart");
  const seizure = db.healthTrackEntries.find(
    (entry) => entry.individualId === ellis.id && entry.kind === "seizure",
  );
  assert.ok(seizure);
  assert.ok(seizure.occurredOn < today);
  const harper = person(db, "Harper Soto");
  assert.ok(
    db.healthTrackEntries.some(
      (entry) => entry.individualId === harper.id && entry.kind === "menses",
    ),
  );
});

test("printable site reviews, monthly checks, QA, and Reese's delegation are ready", () => {
  const db = seed();
  const today = todayIso();
  const month = monthKeyFrom(today);
  for (const site of db.sites) {
    const review = db.siteReviews.find((row) => row.siteId === site.id);
    assert.equal(isSiteReviewInPlace(review, siteFactsFrom(site), today), true, site.name);
    assert.ok(
      db.emergencyDrills.some((drill) => drill.siteId === site.id && drill.monthKey === month && drill.date),
      `${site.name} current-month drill`,
    );
    assert.ok(
      db.qaAudits.some(
        (audit) => audit.siteId === site.id && audit.status === "finalized" && audit.score,
      ),
      `${site.name} QA`,
    );
  }
  const ellis = person(db, "Ellis Hart");
  const ellisDelegation = db.obligations.find(
    (item) => item.individualId === ellis.id && item.kind === "delegation",
  );
  assert.equal(ellisDelegation?.enabled, false);
  assert.equal(ellisDelegation?.proposed, true);

  const reese = person(db, "Reese Lang");
  const delegation = db.obligations.find(
    (item) => item.individualId === reese.id && item.kind === "delegation" && item.enabled,
  );
  assert.ok(delegation?.delegationForm?.delegatingRn.signatureName);
  assert.equal(delegation?.delegationForm?.roster.filter((row) => row.signedAt).length, 2);

  const alexSheet = db.trainingChecklists.find(
    (row) => row.individualId === ellis.id && row.staffName === "Taylor Reed",
  );
  assert.ok(alexSheet?.staffSignedAt);
  assert.ok(alexSheet?.hmSignedAt);
});
