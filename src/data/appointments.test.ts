import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canManageAppointments,
  canSeeAppointments,
  formatAppointmentWhen,
  validateAppointmentDraft,
} from "./appointments";

test("RN and house manager can manage appointments; DSP cannot", () => {
  assert.equal(canManageAppointments("nurse"), true);
  assert.equal(canManageAppointments("house_manager"), true);
  assert.equal(canManageAppointments("administrator"), true);
  assert.equal(canManageAppointments("program_manager"), true);
  assert.equal(canManageAppointments("dsp"), false);
  assert.equal(canManageAppointments("auditor"), false);
  assert.equal(canManageAppointments("hr"), false);
});

test("assigned DSP can still view appointments", () => {
  assert.equal(canSeeAppointments("dsp"), true);
  assert.equal(canSeeAppointments("nurse"), true);
});

test("appointment draft requires consultant and a real time window", () => {
  const valid = validateAppointmentDraft({
    startsOn: "2026-09-22",
    startTime: "09:30",
    endTime: "10:15",
    timezone: "America/Chicago",
    consultant: "Dr. Priya Shah",
  });
  assert.equal(valid.consultant, "Dr. Priya Shah");
  assert.equal(valid.specialty, "");
  assert.throws(
    () =>
      validateAppointmentDraft({
        startsOn: "2026-09-22",
        startTime: "10:15",
        endTime: "09:30",
        timezone: "America/Chicago",
        consultant: "Dr. Priya Shah",
      }),
    /End time/,
  );
  assert.throws(
    () =>
      validateAppointmentDraft({
        startsOn: "2026-09-22",
        startTime: "09:30",
        endTime: "10:15",
        timezone: "America/Chicago",
        consultant: "  ",
      }),
    /consultant/,
  );
});

test("appointment when-label is human readable", () => {
  assert.equal(
    formatAppointmentWhen({
      startsOn: "2026-09-22",
      startTime: "09:30",
      endTime: "10:15",
      timezone: "America/Chicago",
    }),
    "September 22, 2026 · 9:30 AM–10:15 AM · America/Chicago",
  );
});
