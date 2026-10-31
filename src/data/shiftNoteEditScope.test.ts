/**
 * Wave 6 item 3 pin: shift-note Edit/Delete is limited to the note's
 * author plus house managers, program managers and administrators
 * (canEditShiftNoteRow) — in the UI (ShiftNoteSection gates its buttons
 * on the same helper via the view's canEdit flag) and in both APIs.
 * The simulation's batch-37 claim said a DSP could edit beyond his own
 * notes; these tests pin the shipped rule so it cannot silently widen.
 */
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
import { canEditShiftNoteRow } from "./shiftNotes";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

test("canEditShiftNoteRow: author + HM/PM/admin only", () => {
  const note = { staffUserId: "user-author" };
  assert.equal(canEditShiftNoteRow("dsp", "user-author", note), true, "author DSP");
  assert.equal(canEditShiftNoteRow("dsp", "user-other", note), false, "other DSP");
  assert.equal(canEditShiftNoteRow("nurse", "user-other", note), false, "nurse is own-only");
  assert.equal(canEditShiftNoteRow("nurse", "user-author", note), true, "author nurse");
  assert.equal(canEditShiftNoteRow("house_manager", "user-other", note), true, "HM");
  assert.equal(canEditShiftNoteRow("program_manager", "user-other", note), true, "PM");
  assert.equal(canEditShiftNoteRow("administrator", "user-other", note), true, "admin");
  assert.equal(canEditShiftNoteRow("auditor", "user-other", note), false, "auditor read-only");
  assert.equal(canEditShiftNoteRow("hr", "user-other", note), false, "HR is not an editor");
});

test("LocalApi refuses a nurse editing or deleting a DSP's note; the author still can", async () => {
  const api = new LocalApi(store());
  const admin = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(admin);
  const ellis = workspace.individuals.find((i) => i.name === "Ellis Hart")!;
  const chart = await api.getIspData(ellis.id);
  const program = chart.programs.find((row) => row.status === "approved");
  assert.ok(program);
  const alexNote = chart.notes.find((note) => note.staffName === "Alex Morgan");
  assert.ok(alexNote, "seed carries a note authored by Alex Morgan");

  await api.signIn(login(DEMO_NURSE_USERNAME));
  await assert.rejects(
    () =>
      api.saveShiftNote({
        noteId: alexNote.id,
        individualId: ellis.id,
        programId: program.id,
        noteDate: alexNote.noteDate,
        shift: alexNote.shift,
        summary: "Nurse trying to rewrite the DSP's note.",
        timeSpentMinutes: alexNote.timeSpentMinutes,
        scores: [],
      }),
    /You can only edit your own shift notes/,
  );
  await assert.rejects(
    () => api.deleteShiftNote(alexNote.id),
    /You can only delete your own shift notes/,
  );

  // The author DSP can still edit his own note.
  await api.signIn(login(DEMO_DSP_USERNAME));
  const editedId = await api.saveShiftNote({
    noteId: alexNote.id,
    individualId: ellis.id,
    programId: program.id,
    noteDate: alexNote.noteDate,
    shift: alexNote.shift,
    summary: alexNote.summary || "Evening note filed.",
    timeSpentMinutes: alexNote.timeSpentMinutes,
    scores: [],
  });
  assert.equal(editedId, alexNote.id);
});
