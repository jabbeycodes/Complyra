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
import { canRecordLifeEvents, defaultPermissions } from "./permissions";
import {
  LIFE_EVENT_CATEGORIES,
  isLifeEventCategory,
  lifeEventCategoryLabel,
  validateLifeEventDraft,
  validateVoidReason,
} from "./lifeEvents";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PW };
}

test("the category list is the fixed Complyrer list, in order", () => {
  assert.deepEqual(
    LIFE_EVENT_CATEGORIES.map((row) => row.label),
    [
      "Admission or move-in",
      "Home transfer",
      "Hospital or ER stay",
      "Family change",
      "Guardianship or legal change",
      "Day program change",
      "School change",
      "Bereavement",
      "Milestone",
      "Other",
    ],
  );
  assert.equal(isLifeEventCategory("hospital_er_stay"), true);
  assert.equal(isLifeEventCategory("vacation"), false);
  assert.equal(lifeEventCategoryLabel("bereavement"), "Bereavement");
  assert.equal(lifeEventCategoryLabel("nonsense"), "Other");
});

test("draft validation: title, real calendar date, category, note size", () => {
  const ok = validateLifeEventDraft({
    eventDate: "2026-03-14",
    category: "milestone",
    title: "  First full week at the day program  ",
    note: "Went well.",
  });
  assert.equal(ok.title, "First full week at the day program");
  assert.equal(ok.relatedGerId, null);
  assert.throws(
    () =>
      validateLifeEventDraft({
        eventDate: "2026-03-14",
        category: "milestone",
        title: "   ",
      }),
    /short title/,
  );
  assert.throws(
    () =>
      validateLifeEventDraft({
        eventDate: "",
        category: "milestone",
        title: "No date",
      }),
    /date/,
  );
  assert.throws(
    () =>
      validateLifeEventDraft({
        eventDate: "2026-02-30",
        category: "milestone",
        title: "Impossible date",
      }),
    /real calendar date/,
  );
  assert.throws(
    () =>
      validateLifeEventDraft({
        eventDate: "2026-03-14",
        category: "vacation",
        title: "Wrong list",
      }),
    /category/,
  );
  assert.throws(
    () =>
      validateLifeEventDraft({
        eventDate: "2026-03-14",
        category: "other",
        title: "Long note",
        note: "x".repeat(2001),
      }),
    /2000/,
  );
});

test("a void always needs a reason", () => {
  assert.equal(validateVoidReason("  Wrong chart  "), "Wrong chart");
  assert.throws(() => validateVoidReason("   "), /voided/);
});

test("the editor gate: five roles in, DSP/auditor/HR out", () => {
  for (const roleKey of [
    "administrator",
    "compliance_admin",
    "program_manager",
    "house_manager",
    "nurse",
  ]) {
    assert.equal(
      canRecordLifeEvents({ roleKey, permissions: defaultPermissions(roleKey) }),
      true,
      `${roleKey} records life events`,
    );
  }
  for (const roleKey of ["dsp", "auditor", "hr"]) {
    assert.equal(
      canRecordLifeEvents({ roleKey, permissions: defaultPermissions(roleKey) }),
      false,
      `${roleKey} never records life events`,
    );
  }
  // The permission half must agree with the role half: an editor role
  // whose template lost the permission is out, and a DSP handed the
  // permission by a mistaken template edit is still out.
  assert.equal(
    canRecordLifeEvents({ roleKey: "house_manager", permissions: {} }),
    false,
  );
  assert.equal(
    canRecordLifeEvents({
      roleKey: "dsp",
      permissions: { "lifeEvents.record": true },
    }),
    false,
  );
});

interface Cast {
  api: LocalApi;
  /** An Individual at Cedar House (the nurse's and DSP Alex's home). */
  individualId: string;
  /** An Individual at Willow House (the house manager's home). */
  otherSiteIndividualId: string;
}

async function cast(): Promise<Cast> {
  const memory = store();
  const api = new LocalApi(memory);
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(admin);
  const first = workspace.individuals[0];
  const otherSite = workspace.individuals.find(
    (row) => row.site !== first.site,
  );
  assert.ok(otherSite, "the demo seed has Individuals at more than one home");
  return { api, individualId: first.id, otherSiteIndividualId: otherSite.id };
}

test("editors record, the timeline sorts newest first, and nobody gets a bell entry", async () => {
  const { api, individualId } = await cast();
  const bellsBefore = (await api.listNotifications()).length;

  const created = await api.createLifeEvent({
    individualId,
    eventDate: "2025-11-20",
    category: "family_change",
    title: "Sister moved to Kansas City",
    note: "Weekly video calls on Sundays.",
  });
  assert.equal(created.categoryLabel, "Family change");
  assert.equal(created.recordedByName, "Sarah Mitchell");
  assert.equal(created.voided, false);
  assert.equal(created.siteId.length > 0, true);
  assert.equal(
    (await api.listNotifications()).length,
    bellsBefore,
    "recording a life event raises no bell entry for the recorder",
  );

  await api.signOut();
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const nurseBellsBefore = (await api.listNotifications()).length;
  const newer = await api.createLifeEvent({
    individualId,
    eventDate: "2026-03-14",
    category: "hospital_er_stay",
    title: "ER visit in March",
    relatedGerId: "ger-demo-123",
  });
  assert.equal(newer.recordedByName, "Cameron Price");
  assert.equal(newer.relatedGerId, "ger-demo-123");

  const timeline = await api.listLifeEvents(individualId);
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].title, "ER visit in March", "newest event first");
  assert.equal(timeline[1].title, "Sister moved to Kansas City");

  assert.equal(
    (await api.listNotifications()).length,
    nurseBellsBefore,
    "life events never raise notifications (context, not compliance)",
  );
});

test("a house manager records at their own home and nowhere else", async () => {
  const { api, individualId, otherSiteIndividualId } = await cast();
  await api.signOut();
  await api.signIn(login(DEMO_HM_USERNAME));
  const own = await api.createLifeEvent({
    individualId: otherSiteIndividualId,
    eventDate: "2026-01-05",
    category: "admission_move_in",
    title: "Moved in",
  });
  assert.equal(own.recordedByName, "James Wilson");
  await assert.rejects(
    api.createLifeEvent({
      individualId,
      eventDate: "2026-01-06",
      category: "milestone",
      title: "Another home's business",
    }),
    /assigned access/,
  );
});

test("a DSP reads their Individual's timeline but cannot write to it", async () => {
  const { api, individualId, otherSiteIndividualId } = await cast();
  await api.createLifeEvent({
    individualId,
    eventDate: "2026-01-05",
    category: "admission_move_in",
    title: "Moved in",
  });

  await api.signOut();
  const dsp = await api.signIn(login(DEMO_DSP_USERNAME));
  assert.ok(dsp);
  const visible = await api.listLifeEvents(individualId);
  assert.equal(visible.length, 1, "the assigned DSP sees the timeline");
  assert.equal(visible[0].title, "Moved in");

  await assert.rejects(
    api.createLifeEvent({
      individualId,
      eventDate: "2026-04-01",
      category: "milestone",
      title: "DSP entry",
    }),
    /permission/,
  );
  await assert.rejects(
    api.updateLifeEvent(visible[0].id, {
      eventDate: "2026-01-05",
      category: "admission_move_in",
      title: "Edited by a DSP",
    }),
    /permission/,
  );
  await assert.rejects(api.voidLifeEvent(visible[0].id, "Nope"), /permission/);

  const otherSite = await api.listLifeEvents(otherSiteIndividualId);
  assert.equal(
    otherSite.length,
    0,
    "an Individual at another home is outside the DSP's read scope",
  );
});

test("corrections stamp the editor; a reasoned void retires the entry for good", async () => {
  const { api, individualId } = await cast();
  const created = await api.createLifeEvent({
    individualId,
    eventDate: "2026-03-14",
    category: "hospital_er_stay",
    title: "ER visit in March",
  });

  await api.signOut();
  await api.signIn(login(DEMO_NURSE_USERNAME));
  const edited = await api.updateLifeEvent(created.id, {
    eventDate: "2026-03-14",
    category: "hospital_er_stay",
    title: "ER visit in March (updated)",
    note: "Released the same evening.",
  });
  assert.equal(edited.title, "ER visit in March (updated)");
  assert.equal(edited.updatedByName, "Cameron Price");
  assert.ok(edited.updatedAt, "the edit carries a timestamp");

  await assert.rejects(api.voidLifeEvent(created.id, "   "), /voided/);

  const voided = await api.voidLifeEvent(
    created.id,
    "Recorded on the wrong chart.",
  );
  assert.equal(voided.voided, true);
  assert.equal(voided.voidReason, "Recorded on the wrong chart.");
  assert.equal(voided.voidedByName, "Cameron Price");

  assert.equal(
    (await api.listLifeEvents(individualId)).length,
    0,
    "the voided entry leaves the timeline",
  );
  await assert.rejects(
    api.updateLifeEvent(created.id, {
      eventDate: "2026-03-14",
      category: "hospital_er_stay",
      title: "Editing a voided entry",
    }),
    /voided/,
  );
  await assert.rejects(
    api.voidLifeEvent(created.id, "Voiding twice"),
    /already voided/,
  );
});

test("invalid entries are refused at the API, not just in the form", async () => {
  const { api, individualId } = await cast();
  await assert.rejects(
    api.createLifeEvent({
      individualId,
      eventDate: "2026-02-30",
      category: "milestone",
      title: "Impossible date",
    }),
    /real calendar date/,
  );
  await assert.rejects(
    api.createLifeEvent({
      individualId,
      eventDate: "2026-03-14",
      category: "vacation",
      title: "Not a category",
    }),
    /category/,
  );
  await assert.rejects(
    api.createLifeEvent({
      individualId: "no-such-individual",
      eventDate: "2026-03-14",
      category: "milestone",
      title: "Nobody home",
    }),
    /not found|assigned access/,
  );
});
