import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_NURSE_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { emailFor } from "./seed";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return {
    agencyCode: DEMO_AGENCY_CODE,
    username,
    password: DEMO_PASSWORD,
  };
}

const dspUsername = DEMO_DSP_USERNAME; // Alex Morgan, DSP at Cedar House
const hmUsername = emailFor("James Wilson").split("@")[0]; // James Wilson, HM at Willow House
const oakwoodDspUsername = emailFor("Jordan Lee").split("@")[0]; // Jordan Lee, DSP at Willow House

function userId(store: MemoryStore, username: string): string {
  const profile = store.db.profiles.find(
    (p) => p.username === username,
  );
  assert.ok(profile, `profile for ${username}`);
  return profile!.id;
}

test("DSP rates assigned HM: creates rating, history, and one notification", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(oakwoodDspUsername)); // Jordan Lee, Oakwood
  const hmId = userId(s, hmUsername); // James Wilson, Oakwood HM — same site

  const saved = await api.submitDspHmRating({ hmUserId: hmId, rating: 4 });
  assert.equal(saved.rating, 4);

  const current = await api.getMyDspHmRating(hmId);
  assert.ok(current);
  assert.equal(current!.rating, 4);

  const aboutMe = await api.signIn(login(hmUsername)).then(() => api.listDspHmRatingsAboutMe());
  assert.equal(aboutMe.length, 1);
  assert.equal(aboutMe[0].rating, 4);
  assert.equal(aboutMe[0].history.length, 1);
  assert.equal(aboutMe[0].history[0].oldRating, null);
  assert.equal(aboutMe[0].history[0].newRating, 4);

  // One notification for the reviewed HM, deduped on the change id.
  const notes = s.db.notifications.filter(
    (n) => n.type === "rating.changed",
  );
  assert.equal(notes.length, 1);
  assert.equal(notes[0].userId, hmId);
  assert.ok(notes[0].dedupeKey.includes(aboutMe[0].history[0].id));
});

test("same-value rating submit is a no-op: no history, no notification", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(oakwoodDspUsername));
  const hmId = userId(s, hmUsername);

  await api.submitDspHmRating({ hmUserId: hmId, rating: 4 });
  const histBefore = s.db.dspHmRatingHistory.length;
  const notesBefore = s.db.notifications.length;

  await api.submitDspHmRating({ hmUserId: hmId, rating: 4 });
  assert.equal(s.db.dspHmRatingHistory.length, histBefore);
  assert.equal(s.db.notifications.length, notesBefore);
});

test("rating change appends history and notifies again with a new dedupe key", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(oakwoodDspUsername));
  const hmId = userId(s, hmUsername);

  await api.submitDspHmRating({ hmUserId: hmId, rating: 4 });
  await api.submitDspHmRating({ hmUserId: hmId, rating: 5 });

  const me = await api.getMyDspHmRating(hmId);
  assert.equal(me!.rating, 5);

  await api.signIn(login(hmUsername));
  const aboutMe = await api.listDspHmRatingsAboutMe();
  assert.equal(aboutMe[0].history.length, 2);
  const latest = aboutMe[0].history[0]; // newest first
  assert.equal(latest.oldRating, 4);
  assert.equal(latest.newRating, 5);

  const notes = s.db.notifications.filter(
    (n) => n.type === "rating.changed",
  );
  assert.equal(notes.length, 2);
  assert.notEqual(notes[0].dedupeKey, notes[1].dedupeKey);
});

test("HM reviews assigned DSP: history and notification mirror the rating path", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(hmUsername)); // James Wilson, Oakwood HM
  const dspId = userId(s, oakwoodDspUsername); // Jordan Lee, Oakwood DSP

  await api.submitHmDspReview({ dspUserId: dspId, rating: 3 });
  await api.submitHmDspReview({ dspUserId: dspId, rating: 3 }); // no-op
  await api.submitHmDspReview({ dspUserId: dspId, rating: 5 });

  const current = await api.getMyHmDspReview(dspId);
  assert.equal(current!.rating, 5);

  await api.signIn(login(oakwoodDspUsername));
  const aboutMe = await api.listHmDspReviewsAboutMe();
  assert.equal(aboutMe.length, 1);
  assert.equal(aboutMe[0].history.length, 2);

  const notes = s.db.notifications.filter(
    (n) => n.type === "review.changed",
  );
  assert.equal(notes.length, 2);
  assert.equal(notes[0].userId, dspId);
});

test("cross-site rating is rejected: only assigned pairs may rate/review", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(dspUsername)); // Alex Morgan, Cedar House DSP
  const oakwoodHmId = userId(s, hmUsername); // James Wilson, Oakwood HM

  await assert.rejects(
    api.submitDspHmRating({ hmUserId: oakwoodHmId, rating: 4 }),
    /assigned site/,
  );
  assert.equal(s.db.dspHmRatings.length, 0);
});

test("cross-site review is rejected for HMs", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(hmUsername)); // Oakwood HM
  const mapleDspId = userId(s, dspUsername); // Maple DSP

  await assert.rejects(
    api.submitHmDspReview({ dspUserId: mapleDspId, rating: 4 }),
    /assigned site/,
  );
});

test("roles are enforced: DSPs cannot review, HMs cannot rate", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(dspUsername));
  const hmId = userId(s, hmUsername);
  // DSPs lack the review_dsp permission entirely — the permission gate fires.
  await assert.rejects(
    api.submitHmDspReview({ dspUserId: hmId, rating: 4 }),
    /permission/,
  );

  await api.signIn(login(hmUsername));
  const dspId = userId(s, oakwoodDspUsername);
  // HMs lack the rate_hm permission entirely.
  await assert.rejects(
    api.submitDspHmRating({ hmUserId: dspId, rating: 4 }),
    /permission/,
  );
});

test("self-rating is rejected", async () => {
  const s = store();
  const api = new LocalApi(s);
  // Give the Oakwood DSP a second (house_manager) membership at the same
  // site so the subject lookup succeeds and the self-check is reached.
  const dspId = userId(s, oakwoodDspUsername);
  const oakwoodSite = s.db.memberships.find(
    (m) => m.userId === dspId,
  )!.siteId;
  s.db.memberships.push({
    id: "test-dual-membership",
    agencyId: s.db.memberships[0].agencyId,
    userId: dspId,
    role: "manager",
    roleKey: "house_manager",
    siteId: oakwoodSite,
    expiresOn: null,
  });
  await api.signIn(login(oakwoodDspUsername));
  await assert.rejects(
    api.submitDspHmRating({ hmUserId: dspId, rating: 4 }),
    /yourself/,
  );
  assert.equal(s.db.dspHmRatings.length, 0);
});

test("invalid ratings are rejected", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(oakwoodDspUsername));
  const hmId = userId(s, hmUsername);
  for (const bad of [0, 6, 2.5, Number.NaN]) {
    await assert.rejects(
      api.submitDspHmRating({ hmUserId: hmId, rating: bad }),
      /1 to 5/,
    );
  }
});

test("winners are public-only: highlights stored, no scores, idempotent rerun", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(DEMO_ADMIN_USERNAME));

  const first = await api.runWeeklyRecognition();
  assert.ok(first.hmWinner);
  assert.ok(first.dspWinner);
  assert.equal(first.alreadyDecided, false);

  // Stored rows carry highlights only — never scores or breakdowns.
  for (const w of s.db.recognitionWinners) {
    assert.ok(Array.isArray(w.highlights));
    assert.ok(!("score" in w));
    assert.ok(!("breakdown" in w));
  }

  const second = await api.runWeeklyRecognition();
  assert.equal(second.alreadyDecided, true);
  assert.equal(
    second.hmWinner!.id,
    first.hmWinner!.id,
    "same winner after rerun",
  );

  const winners = await api.listRecognitionWinners();
  assert.equal(winners.length, 2);
  for (const w of winners) {
    assert.ok(w.winnerName);
    assert.ok(Array.isArray(w.highlights));
    assert.ok(!("score" in w));
    assert.ok(!("breakdown" in w));
    assert.ok(!("winnerId" in w));
  }
});

test("recognition feedback is private: DSPs cannot read the manager view", async () => {
  const s = store();
  const api = new LocalApi(s);
  await api.signIn(login(dspUsername));
  await assert.rejects(api.listRecognitionFeedback(), /permission/);

  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const feedback = await api.listRecognitionFeedback();
  assert.ok(Array.isArray(feedback.dspRatings));
  assert.ok(Array.isArray(feedback.hmReviews));
});

test("listRecognitionPartners returns only assigned counterparts", async () => {
  const s = store();
  const api = new LocalApi(s);

  await api.signIn(login(oakwoodDspUsername)); // Jordan Lee, Oakwood DSP
  const dspPartners = await api.listRecognitionPartners();
  const hmId = userId(s, hmUsername);
  assert.ok(
    dspPartners.some((p) => p.userId === hmId && p.roleKey === "house_manager"),
    "DSP sees their site HM",
  );
  assert.ok(
    !dspPartners.some((p) => p.userId === userId(s, dspUsername)),
    "never includes self",
  );

  await api.signIn(login(hmUsername)); // James Wilson, Oakwood HM
  const hmPartners = await api.listRecognitionPartners();
  assert.ok(
    hmPartners.some(
      (p) => p.userId === userId(s, oakwoodDspUsername) && p.roleKey === "dsp",
    ),
    "HM sees their site DSPs",
  );

  await api.signIn(login(DEMO_ADMIN_USERNAME));
  assert.deepEqual(await api.listRecognitionPartners(), []);
});

test("staff_assignments pair people across sites for ratings and partners", async () => {
  const s = store();
  const api = new LocalApi(s);
  const dspId = userId(s, dspUsername); // Alex Morgan, Cedar House DSP
  const hmId = userId(s, hmUsername); // James Wilson, Oakwood HM
  // Alex has no membership at Oakwood; link them with an active assignment.
  const oakwoodSite = s.db.memberships.find(
    (m) => m.userId === hmId && m.siteId,
  )!.siteId!;
  s.db.assignments.push({
    id: "test-asg-1",
    agencyId: s.db.agencies[0].id,
    userId: dspId,
    individualId: null,
    siteId: oakwoodSite,
    startsOn: "2026-01-01",
    endsOn: null,
  });

  await api.signIn(login(dspUsername));
  const partners = await api.listRecognitionPartners();
  assert.ok(
    partners.some((p) => p.userId === hmId && p.roleKey === "house_manager"),
    "DSP sees HM via staff_assignment",
  );
  // And can rate them.
  const saved = await api.submitDspHmRating({ hmUserId: hmId, rating: 5 });
  assert.equal(saved.rating, 5);
});

test("manager feedback is site-scoped: DPM sees only their sites' pairs", async () => {
  const s = store();
  const api = new LocalApi(s);
  // Jordan (Oakwood DSP) rates James (Oakwood HM).
  await api.signIn(login(oakwoodDspUsername));
  const hmId = userId(s, hmUsername);
  await api.submitDspHmRating({ hmUserId: hmId, rating: 4 });

  const nurseUsername = DEMO_NURSE_USERNAME;
  const nurseId = userId(s, nurseUsername);
  const oakwoodSite = s.db.memberships.find(
    (m) => m.userId === hmId && m.siteId,
  )!.siteId!;
  const mapleSite = s.db.memberships.find(
    (m) => m.userId === userId(s, dspUsername) && m.siteId,
  )!.siteId!;
  assert.notEqual(oakwoodSite, mapleSite, "seed has two sites");

  // Promote the nurse to DPM at Oakwood: sees the Oakwood pair.
  const membership = s.db.memberships.find((m) => m.userId === nurseId)!;
  membership.roleKey = "degreed_professional_manager";
  membership.siteId = oakwoodSite;
  await api.signIn(login(nurseUsername));
  let feedback = await api.listRecognitionFeedback();
  assert.equal(feedback.dspRatings.length, 1, "DPM at Oakwood sees the pair");

  // Same DPM moved to Maple: the Oakwood pair is hidden.
  membership.siteId = mapleSite;
  feedback = await api.listRecognitionFeedback();
  assert.equal(feedback.dspRatings.length, 0, "DPM at Maple sees nothing");

  // Administrators still see the whole agency.
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  feedback = await api.listRecognitionFeedback();
  assert.equal(feedback.dspRatings.length, 1, "admin sees everything");
});
