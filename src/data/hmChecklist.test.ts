import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso } from "./chart";
import {
  ITEM_21_KEY,
  WEEKLY_CHECKLIST_ITEMS,
  applyItem21,
  blankItemNumbers,
  buildChecklistItems,
  computeItem21,
  deadlineMondayIso,
  deadlinePassed,
  weekOfSundayIso,
} from "./hmChecklist";

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

test("checklist has 26 verbatim items with item 21 as the training item", () => {
  assert.equal(WEEKLY_CHECKLIST_ITEMS.length, 26);
  assert.equal(
    WEEKLY_CHECKLIST_ITEMS[20].prompt,
    "All staff have been properly trained and signed off on all trainings/delegations",
  );
  assert.equal(WEEKLY_CHECKLIST_ITEMS[20].key, ITEM_21_KEY);
  assert.equal(
    WEEKLY_CHECKLIST_ITEMS[0].prompt,
    "Staff daily documentation is check – if missing, addressed and then re-verified",
  );
  const fresh = buildChecklistItems();
  assert.equal(fresh.length, 26);
  assert.ok(fresh.every((item) => item.answer === null));
  assert.deepEqual(blankItemNumbers(fresh).length, 26);
  assert.equal(
    fresh.find((item) => item.key === ITEM_21_KEY)?.autoComputed,
    true,
  );
});

test("week normalization and Monday-4pm deadline helpers", () => {
  // 2026-09-13 is a Sunday.
  assert.equal(weekOfSundayIso("2026-09-13"), "2026-09-13");
  assert.equal(weekOfSundayIso("2026-09-16"), "2026-09-13");
  assert.equal(weekOfSundayIso("2026-09-19"), "2026-09-13");
  assert.equal(deadlineMondayIso("2026-09-13"), "2026-09-14");
  assert.equal(
    deadlinePassed("2026-09-13", new Date("2026-09-14T15:59:59")),
    false,
  );
  assert.equal(
    deadlinePassed("2026-09-13", new Date("2026-09-14T16:00:00")),
    true,
  );
  assert.equal(
    deadlinePassed("2026-09-13", new Date("2026-09-15T09:00:00")),
    true,
  );
});

test("item 21 auto-compute: Y when all signed off, N naming the pending", () => {
  assert.deepEqual(computeItem21([]), {
    answer: "N",
    note: "No staff roster on file for this home — verify training manually before answering Yes.",
  });
  const all = computeItem21([
    { staffId: "a", staffName: "Amy", fullySignedOff: true },
    { staffId: "b", staffName: "Bob", fullySignedOff: true },
  ]);
  assert.equal(all.answer, "Y");
  const some = computeItem21([
    { staffId: "a", staffName: "Amy", fullySignedOff: true },
    { staffId: "b", staffName: "Bob", fullySignedOff: false },
  ]);
  assert.equal(some.answer, "N");
  assert.match(some.note, /Bob/);
  const stamped = applyItem21(buildChecklistItems(), some);
  const item21 = stamped.find((item) => item.key === ITEM_21_KEY)!;
  assert.equal(item21.answer, "N");
  assert.equal(item21.autoComputed, true);
});

test("admin assigns, HM fills every item and submits with attestation", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const site = ws.sites[0];
  const hmStaff = ws.staff.find((s) => s.roleKey === "house_manager")!;
  const week = weekOfSundayIso(todayIso());

  const created = await api.assignWeeklyChecklist({
    siteId: site.id,
    hmUserId: hmStaff.id,
    weekOf: week,
  });
  assert.equal(created.items.length, 26);
  assert.equal(created.status, "open");
  assert.ok(created.items.find((i) => i.key === ITEM_21_KEY)!.answer !== null);

  const hm = await api.signIn(login(hmStaff.username));
  assert.equal(hm.userId, hmStaff.id);
  for (const item of created.items) {
    if (item.key === ITEM_21_KEY) continue;
    await api.answerChecklistItem(created.id, item.key, "Y");
  }
  const entry = await api.addServiceLogEntry(created.id, {
    kind: "call_in",
    detail: "Alex called in sick Tuesday.",
    staffName: "Alex Morgan",
  });
  assert.equal(entry.kind, "call_in");

  await api.submitWeeklyChecklist(created.id, hmStaff.name);
  const [submitted] = await api.listWeeklyChecklists({ siteId: site.id });
  assert.equal(submitted.status, "submitted");
  assert.equal(submitted.attestation?.signedBy, hmStaff.name);
  assert.ok(submitted.attestation?.signedAt);
  assert.equal(submitted.serviceLogs.length, 1);
});

test("submit rejects blank items, naming them", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const site = ws.sites[0];
  const hmStaff = ws.staff.find((s) => s.roleKey === "house_manager")!;
  const created = await api.assignWeeklyChecklist({
    siteId: site.id,
    hmUserId: hmStaff.id,
    weekOf: weekOfSundayIso(todayIso()),
  });
  await api.signIn(login(hmStaff.username));
  await api.answerChecklistItem(created.id, "c1", "Y");
  await assert.rejects(
    () => api.submitWeeklyChecklist(created.id, hmStaff.name),
    /do not leave blanks.*#2/,
  );
});

test("only DPM/admin can assign; item 21 cannot be answered by hand", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const site = ws.sites[0];
  const hmStaff = ws.staff.find((s) => s.roleKey === "house_manager")!;
  const created = await api.assignWeeklyChecklist({
    siteId: site.id,
    hmUserId: hmStaff.id,
    weekOf: weekOfSundayIso(todayIso()),
  });

  await api.signIn(login(DEMO_DSP_USERNAME));
  await assert.rejects(
    () =>
      api.assignWeeklyChecklist({
        siteId: site.id,
        hmUserId: hmStaff.id,
        weekOf: weekOfSundayIso(todayIso()),
      }),
    /Only a DPM or agency administrator/,
  );

  await api.signIn(login(hmStaff.username));
  await assert.rejects(
    () => api.answerChecklistItem(created.id, ITEM_21_KEY, "Y"),
    /auto-checked/,
  );
  await assert.rejects(
    () => api.assignWeeklyChecklist({
      siteId: site.id,
      hmUserId: hmStaff.id,
      weekOf: weekOfSundayIso(todayIso()),
    }),
    /Only a DPM or agency administrator/,
  );
});

test("rollover locks prior open weeks as overdue and is idempotent", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const site = ws.sites[0];
  const hmStaff = ws.staff.find((s) => s.roleKey === "house_manager")!;
  const currentWeek = weekOfSundayIso(todayIso());

  await api.assignWeeklyChecklist({
    siteId: site.id,
    hmUserId: hmStaff.id,
    weekOf: currentWeek,
  });
  const priorWeek = "2026-09-06"; // a Sunday before the current week
  const prior =
    priorWeek === currentWeek
      ? null
      : await api.assignWeeklyChecklist({
          siteId: site.id,
          hmUserId: hmStaff.id,
          weekOf: priorWeek,
        });
  if (!prior) {
    // The "current week" is the fixture week itself; simulate staleness by
    // rolling twice after locking manually is not possible, so just verify
    // idempotency of the fresh-week path.
    const first = await api.rolloverWeeklyChecklists();
    const second = await api.rolloverWeeklyChecklists();
    assert.equal(second.created, 0);
    assert.equal(second.locked, 0);
    assert.ok(first.created >= 0);
    return;
  }

  const first = await api.rolloverWeeklyChecklists();
  assert.equal(first.locked, 1);
  const rows = await api.listWeeklyChecklists({ weekOf: priorWeek });
  assert.equal(rows[0].status, "overdue");
  // Locked weeks reject edits.
  await api.signIn(login(hmStaff.username));
  await assert.rejects(
    () => api.answerChecklistItem(prior.id, "c1", "Y"),
    /no longer open/,
  );

  const second = await api.rolloverWeeklyChecklists();
  assert.deepEqual(second, { created: 0, locked: 0 });
});

test("HM lists only their own checklists", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const hms = ws.staff.filter((s) => s.roleKey === "house_manager");
  assert.ok(hms.length >= 1);
  const site = ws.sites[0];
  await api.assignWeeklyChecklist({
    siteId: site.id,
    hmUserId: hms[0].id,
    weekOf: weekOfSundayIso(todayIso()),
  });
  await api.signIn(login(hms[0].username));
  const mine = await api.listWeeklyChecklists();
  assert.ok(mine.length >= 1);
  assert.ok(mine.every((c) => c.assignedToUserId === hms[0].id));
});

test("assign reuses the open instance for a site/week (idempotent)", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const ws = await api.loadWorkspace(admin);
  const site = ws.sites[0];
  const hmStaff = ws.staff.find((s) => s.roleKey === "house_manager")!;
  const input = {
    siteId: site.id,
    hmUserId: hmStaff.id,
    weekOf: weekOfSundayIso(todayIso()),
  };
  const first = await api.assignWeeklyChecklist(input);
  const second = await api.assignWeeklyChecklist(input);
  assert.equal(first.id, second.id);
  const rows = await api.listWeeklyChecklists({ weekOf: input.weekOf });
  assert.equal(rows.filter((c) => c.siteId === site.id).length, 1);
});
