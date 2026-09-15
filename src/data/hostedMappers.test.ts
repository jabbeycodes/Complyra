import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mapAdaptiveEquipment,
  mapAppointment,
  mapChartFile,
  mapClinicalRenewal,
  mapEmergencyDrill,
  mapEquipmentMonthLog,
  mapHomeSafetyReport,
  mapMedication,
  mapMedicationDelivery,
  mapObligation,
  mapObligationSignature,
  mapSiteReview,
  mapTrainingChecklist,
  obligationPatch,
  profileFromRow,
} from "./hostedMappers";

test("mapObligation converts a db row to an ObligationItem", () => {
  const item = mapObligation({
    id: "ob-1",
    agency_id: "ag-1",
    individual_id: "p-1",
    kind: "delegation",
    mode: "required",
    title: "G-tube feeds",
    detail: "Feed per orders",
    source_page: 12,
    document_version_id: "v-1",
    enabled: true,
    frequency: "Daily",
    shift_periods: ["am", "pm"],
    expires_on: "2026-12-31",
    created_from: "extraction",
    inventory_state: "present",
    proposed: false,
    delegating_rn_user_id: "nurse-1",
    rn_signed_at: "2026-09-01T10:00:00Z",
    rn_signature_name: "Nurse Nancy",
    rn_signature_mark: "data:image/png;base64,AAA",
    discontinued_at: null,
    discontinue_file_id: null,
    discontinue_title: null,
  });
  assert.equal(item.id, "ob-1");
  assert.equal(item.kind, "delegation");
  assert.equal(item.sourcePage, 12);
  assert.deepEqual(item.shiftPeriods, ["am", "pm"]);
  assert.equal(item.expiresOn, "2026-12-31");
  assert.equal(item.delegatingRnUserId, "nurse-1");
  assert.equal(item.rnSignedAt, "2026-09-01T10:00:00Z");
  assert.equal(item.documentVersionId, "v-1");
});

test("mapObligation defaults missing columns", () => {
  const item = mapObligation({ id: "ob-2" });
  assert.equal(item.kind, "protocol");
  assert.equal(item.mode, "required");
  assert.equal(item.enabled, false);
  assert.equal(item.frequency, "On plan update");
  assert.deepEqual(item.shiftPeriods, []);
  assert.equal(item.expiresOn, null);
  assert.equal(item.sourcePage, null);
  assert.equal(item.documentVersionId, null);
  assert.equal(item.discontinuedAt, null);
});

test("obligationPatch maps camelCase edits to db columns", () => {
  assert.deepEqual(
    obligationPatch({ title: "New", enabled: false, shiftPeriods: ["am"], inventoryState: "missing", proposed: true }),
    {
      title: "New",
      enabled: false,
      shift_periods: ["am"],
      inventory_state: "missing",
      proposed: true,
    },
  );
  assert.deepEqual(obligationPatch({}), {});
});

test("mapObligationSignature keeps opened/signed timestamps", () => {
  const row = mapObligationSignature({
    id: "s-1",
    agency_id: "ag-1",
    obligation_id: "ob-1",
    user_id: "u-1",
    staff_name: "Sam Staff",
    opened_at: "2026-09-10T08:00:00Z",
    signed_at: null,
    signature_name: null,
    signature_mark: null,
  });
  assert.equal(row.staffName, "Sam Staff");
  assert.equal(row.openedAt, "2026-09-10T08:00:00Z");
  assert.equal(row.signedAt, null);
});

test("mapClinicalRenewal reads interval and evidence fields", () => {
  const renewal = mapClinicalRenewal({
    id: "r-1",
    agency_id: "ag-1",
    individual_id: "p-1",
    kind: "annual_physical",
    title: "Annual physical",
    interval_months: 12,
    last_uploaded_on: "2026-01-15",
    next_due_on: "2027-01-15",
    last_document_title: "Physical 2026",
    last_evidence_kind: "upload",
    file_id: "f-1",
  });
  assert.equal(renewal.intervalMonths, 12);
  assert.equal(renewal.lastUploadedOn, "2026-01-15");
  assert.equal(renewal.nextDueOn, "2027-01-15");
  assert.equal(renewal.lastEvidenceKind, "upload");
  assert.equal(renewal.fileId, "f-1");
});

test("mapMedication and mapMedicationDelivery", () => {
  const med = mapMedication({
    id: "m-1",
    agency_id: "ag-1",
    individual_id: "p-1",
    name: "Lisinopril",
    strength: "10mg",
    kind: "scheduled",
    controlled: false,
    pills_per_day: 1,
    remaining_pills: 28,
    last_delivery_on: "2026-09-01",
    last_countdown_on: "2026-09-12",
  });
  assert.equal(med.name, "Lisinopril");
  assert.equal(med.pillsPerDay, 1);
  assert.equal(med.lastCountdownOn, "2026-09-12");
  const delivery = mapMedicationDelivery({
    id: "d-1",
    medication_id: "m-1",
    counted_on: "2026-09-01",
    remaining_pills: 28,
    pills_per_day: 1,
    recorded_by: "u-1",
  });
  assert.equal(delivery.countedOn, "2026-09-01");
  assert.equal(delivery.recordedBy, "u-1");
});

test("mapTrainingChecklist parses jsonb items", () => {
  const checklist = mapTrainingChecklist({
    id: "t-1",
    agency_id: "ag-1",
    individual_id: "p-1",
    staff_user_id: "u-1",
    staff_name: "Sam Staff",
    document_version_id: null,
    items: [
      { id: "l-1", title: "Fire safety", initialedAt: "2026-09-01T00:00:00Z" },
      { id: "l-2", title: "Med admin", initialedAt: null },
    ],
    staff_signed_at: null,
    staff_signature_name: null,
    hm_signed_at: null,
    hm_signature_name: null,
  });
  assert.equal(checklist.items.length, 2);
  assert.equal(checklist.items[0]?.title, "Fire safety");
  assert.equal(checklist.items[1]?.initialedAt, null);
  assert.equal(checklist.staffSignedAt, null);
});

test("mapAdaptiveEquipment, mapEquipmentMonthLog, mapEmergencyDrill", () => {
  const equipment = mapAdaptiveEquipment({
    id: "e-1",
    agency_id: "ag-1",
    individual_id: "p-1",
    name: "Shower chair",
    source: "manual",
    active: true,
  });
  assert.equal(equipment.name, "Shower chair");
  assert.equal(equipment.active, true);
  const log = mapEquipmentMonthLog({
    id: "el-1",
    equipment_id: "e-1",
    month_key: "2026-09",
    checked_on: "2026-09-05",
    initials: "JA",
    checked_by_user_id: "u-1",
    comments: "ok",
  });
  assert.equal(log.monthKey, "2026-09");
  assert.equal(log.initials, "JA");
  const drill = mapEmergencyDrill({
    id: "dr-1",
    agency_id: "ag-1",
    site_id: "s-1",
    month_key: "2026-09",
    drill_type: "fire",
    date: "2026-09-06",
    time: "10:00",
    evac_time: "3:12",
    leader_name: "Lead",
    participants: "Everyone",
    awake_or_sleep: "awake",
  });
  assert.equal(drill.drillType, "fire");
  assert.equal(drill.evacTime, "3:12");
});

test("mapHomeSafetyReport parses jsonb lines", () => {
  const report = mapHomeSafetyReport({
    id: "h-1",
    agency_id: "ag-1",
    site_id: "s-1",
    month_key: "2026-09",
    lines: [
      {
        key: "smoke",
        dateChecked: "2026-09-02",
        location: "hall",
        temp: "",
        extra: "",
        checkedBy: "Sam",
        signature: "Sam",
      },
    ],
  });
  assert.equal(report.lines.length, 1);
  assert.equal(report.lines[0]?.key, "smoke");
  assert.equal(report.lines[0]?.checkedBy, "Sam");
});

test("mapSiteReview keeps nullable tri-state answers", () => {
  const review = mapSiteReview({
    id: "sr-1",
    agency_id: "ag-1",
    site_id: "s-1",
    reviewer_name: "Rita",
    support_coordinator: "Sam",
    reviewed_on: "2026-09-08",
    provider_owned_controlled: true,
    heightened_scrutiny: null,
    meets_individual_needs: null,
    part2_verified: false,
    lines: [{ id: "q1", status: "satisfactory", comment: "" }],
    updated_at: "2026-09-08T12:00:00Z",
  });
  assert.equal(review.reviewerName, "Rita");
  assert.equal(review.heightenedScrutiny, null);
  assert.equal(review.lines[0]?.status, "satisfactory");
});

test("mapChartFile reads the storage path", () => {
  const file = mapChartFile({
    id: "f-1",
    agency_id: "ag-1",
    individual_id: "p-1",
    kind: "discontinue",
    name: "order.pdf",
    mime: "application/pdf",
    storage_path: "ag-1/p-1/chart/f-1/order.pdf",
  });
  assert.equal(file.storagePath, "ag-1/p-1/chart/f-1/order.pdf");
  assert.equal(file.kind, "discontinue");
});

test("profileFromRow fills person fallbacks when no profile row exists", () => {
  const person = { id: "p-1", fullName: "Jordan Avery", dateOfBirth: "1990-01-01" };
  assert.equal(profileFromRow(person, null), null);
  const profile = profileFromRow(person, {
    profile: { legalName: "Jordan B. Avery", language: "Spanish" },
  });
  assert.equal(profile?.legalName, "Jordan B. Avery");
  assert.equal(profile?.language, "Spanish");
  assert.equal(profile?.goesBy, "Jordan");
  assert.equal(profile?.enrolledOn, "");
  assert.deepEqual(profile?.allergies, []);
});

test("mapAppointment reads date, clock, visit address, and who/when stamps", () => {
  const row = mapAppointment({
    id: "appt-1",
    agency_id: "ag-1",
    individual_id: "p-1",
    starts_on: "2026-09-22",
    start_time: "09:30:00",
    end_time: "10:15:00",
    timezone: "America/Chicago",
    consultant: "Dr. Priya Shah",
    specialty: "Neurology",
    reason: "Follow-up",
    visit_address: "3201 Pompey Drive",
    created_by: "u-1",
    created_by_name: "Cameron Price",
    created_at: "2026-09-10T14:00:00Z",
    updated_by: "",
    updated_by_name: "",
    updated_at: "2026-09-10T14:00:00Z",
    deleted_by: "",
    deleted_by_name: "",
    deleted_at: null,
  });
  assert.equal(row.startTime, "09:30");
  assert.equal(row.endTime, "10:15");
  assert.equal(row.consultant, "Dr. Priya Shah");
  assert.equal(row.visitAddress, "3201 Pompey Drive");
  assert.equal(row.createdByName, "Cameron Price");
  assert.equal(row.deletedAt, null);
});
