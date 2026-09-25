import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildNotificationRow,
  checklistAssignedPayload,
  checklistLatePayload,
  checklistMissedPayload,
  checklistSubmittedPayload,
  certificateExpiringPayload,
  certificateExpiredPayload,
  dedupeKeyFor,
  delegationAckOverduePayload,
  delegationPublishedPayload,
  delegationReviewReadyPayload,
  isNotificationType,
  isUnread,
  isWellFormedDeepLink,
  markAllRead,
  markOneRead,
  medLowStockPayload,
  metaForType,
  sortNotifications,
  trainingAssignedPayload,
  trainingDueSoonPayload,
  trainingOverduePayload,
  unreadCount,
  NOTIFICATION_TYPES,
  type NotificationRow,
} from "./notify";

const AGENCY = "00000000-0000-4000-8000-000000000001";
const USER = "00000000-0000-4000-8000-000000000002";
const TRAINING = "00000000-0000-4000-8000-000000000010";
const CERT = "00000000-0000-4000-8000-000000000020";
const MED = "00000000-0000-4000-8000-000000000030";
const CHECKLIST = "00000000-0000-4000-8000-000000000040";
const ASSIGNMENT = "00000000-0000-4000-8000-000000000050";

function row(partial: Partial<NotificationRow>): NotificationRow {
  return {
    id: "00000000-0000-4000-8000-000000000100",
    agency_id: AGENCY,
    user_id: USER,
    role_key: null,
    type: "training.assigned",
    title: "t",
    body: "b",
    deep_link: "/training/x",
    entity_type: null,
    entity_id: null,
    dedupe_key: null,
    read_at: null,
    created_at: "2026-09-13T12:00:00.000Z",
    ...partial,
  };
}

test("all seventeen notification types are known contract types", () => {
  assert.equal(NOTIFICATION_TYPES.length, 35);
  for (const t of NOTIFICATION_TYPES) {
    assert.ok(isNotificationType(t), t);
  }
  assert.ok(!isNotificationType("invoice.paid"));
  assert.ok(!isNotificationType(""));
});

test("training.assigned payload maps to a snake_case DB row", () => {
  const row = buildNotificationRow(
    trainingAssignedPayload({
      agencyId: AGENCY,
      userId: USER,
      trainingId: TRAINING,
      trainingTitle: "CPI Refresher",
    }),
  );
  assert.equal(row.agency_id, AGENCY);
  assert.equal(row.user_id, USER);
  assert.equal(row.role_key, null);
  assert.equal(row.type, "training.assigned");
  assert.equal(row.title, "New training assigned");
  assert.ok((row.body as string).includes("CPI Refresher"));
  assert.equal(row.deep_link, `/training/${TRAINING}`);
  assert.equal(row.entity_type, "training");
  assert.equal(row.entity_id, TRAINING);
  assert.ok(typeof row.dedupe_key === "string" && row.dedupe_key.length > 0);
  assert.equal(row.read_at, null);
});

test("training.due_soon payload mentions the days left", () => {
  const row = buildNotificationRow(
    trainingDueSoonPayload({
      agencyId: AGENCY,
      userId: USER,
      trainingId: TRAINING,
      trainingTitle: "CPI Refresher",
      daysLeft: 3,
    }),
  );
  assert.equal(row.type, "training.due_soon");
  assert.ok((row.body as string).includes("3 days"));
  assert.ok((row.deep_link as string).startsWith("/training/"));
});

test("training.overdue payload targets the staff member", () => {
  const row = buildNotificationRow(
    trainingOverduePayload({
      agencyId: AGENCY,
      userId: USER,
      trainingId: TRAINING,
      trainingTitle: "CPI Refresher",
    }),
  );
  assert.equal(row.type, "training.overdue");
  assert.equal(row.user_id, USER);
  assert.ok((row.title as string).toLowerCase().includes("overdue"));
});

test("certificate.expiring payload names the cert and countdown", () => {
  const row = buildNotificationRow(
    certificateExpiringPayload({
      agencyId: AGENCY,
      userId: USER,
      certificateId: CERT,
      certName: "CPR",
      daysRemaining: 12,
    }),
  );
  assert.equal(row.type, "certificate.expiring");
  assert.ok((row.body as string).includes("CPR"));
  assert.ok((row.body as string).includes("12 days"));
  assert.equal(row.deep_link, `/certificates/${CERT}`);
});

test("certificate.expired payload is a distinct event from expiring", () => {
  const expiring = buildNotificationRow(
    certificateExpiringPayload({
      agencyId: AGENCY,
      userId: USER,
      certificateId: CERT,
      certName: "CPR",
      daysRemaining: 5,
    }),
  );
  const expired = buildNotificationRow(
    certificateExpiredPayload({
      agencyId: AGENCY,
      userId: USER,
      certificateId: CERT,
      certName: "CPR",
    }),
  );
  assert.notEqual(expiring.dedupe_key, expired.dedupe_key);
  assert.ok((expired.body as string).toLowerCase().includes("expired"));
});

test("med.low_stock payload is a role broadcast", () => {
  const row = buildNotificationRow(
    medLowStockPayload({
      agencyId: AGENCY,
      roleKey: "house_manager",
      medId: MED,
      medName: "Lisinopril 10mg",
      siteName: "Brengman",
      daysRemaining: 2,
    }),
  );
  assert.equal(row.type, "med.low_stock");
  assert.equal(row.user_id, null);
  assert.equal(row.role_key, "house_manager");
  assert.ok((row.body as string).includes("Lisinopril 10mg"));
  assert.ok((row.body as string).includes("Brengman"));
  assert.ok((row.body as string).includes("2 days"));
});

test("checklist.assigned / late / missed / submitted payloads", () => {
  const assigned = buildNotificationRow(
    checklistAssignedPayload({
      agencyId: AGENCY,
      userId: USER,
      checklistId: CHECKLIST,
      checklistTitle: "HM Weekly Checklist",
    }),
  );
  assert.equal(assigned.type, "checklist.assigned");
  assert.equal(assigned.user_id, USER);
  assert.equal(assigned.deep_link, `/checklists/${CHECKLIST}`);

  const late = buildNotificationRow(
    checklistLatePayload({
      agencyId: AGENCY,
      roleKey: "house_manager",
      checklistId: CHECKLIST,
      checklistTitle: "HM Weekly Checklist",
    }),
  );
  assert.equal(late.type, "checklist.late");
  assert.equal(late.role_key, "house_manager");
  assert.equal(late.user_id, null);

  const missed = buildNotificationRow(
    checklistMissedPayload({
      agencyId: AGENCY,
      roleKey: "house_manager",
      checklistId: CHECKLIST,
      checklistTitle: "HM Weekly Checklist",
    }),
  );
  assert.equal(missed.type, "checklist.missed");
  assert.equal(missed.role_key, "house_manager");

  const submitted = buildNotificationRow(
    checklistSubmittedPayload({
      agencyId: AGENCY,
      roleKey: "house_manager",
      checklistId: CHECKLIST,
      checklistTitle: "HM Weekly Checklist",
      submittedByName: "Alice",
    }),
  );
  assert.equal(submitted.type, "checklist.submitted");
  assert.ok((submitted.body as string).includes("Alice"));
});

test("dedupe_key is present and unique per event", () => {
  const a = buildNotificationRow(
    trainingAssignedPayload({
      agencyId: AGENCY,
      userId: USER,
      trainingId: TRAINING,
      trainingTitle: "X",
    }),
  );
  const b = buildNotificationRow(
    trainingAssignedPayload({
      agencyId: AGENCY,
      userId: USER,
      trainingId: TRAINING,
      trainingTitle: "X",
    }),
  );
  assert.equal(a.dedupe_key, b.dedupe_key, "same event dedupes");

  const otherUser = buildNotificationRow(
    trainingAssignedPayload({
      agencyId: AGENCY,
      userId: "00000000-0000-4000-8000-000000000003",
      trainingId: TRAINING,
      trainingTitle: "X",
    }),
  );
  assert.notEqual(a.dedupe_key, otherUser.dedupe_key, "different recipient differs");

  assert.equal(dedupeKeyFor("checklist.late", CHECKLIST), `checklist.late:${CHECKLIST}`);
});

test("buildNotificationRow omits unset optional columns", () => {
  const row = buildNotificationRow({
    agencyId: AGENCY,
    userId: USER,
    type: "training.assigned",
    title: "t",
    body: "b",
    deepLink: "/training/x",
  });
  assert.ok(!("entity_type" in row));
  assert.ok(!("entity_id" in row));
  assert.ok(!("dedupe_key" in row));
});

test("unreadCount counts only rows with no read_at", () => {
  const rows = [
    row({ id: "a", read_at: null }),
    row({ id: "b", read_at: "2026-09-13T13:00:00.000Z" }),
    row({ id: "c", read_at: null }),
  ];
  assert.equal(unreadCount(rows), 2);
  assert.ok(isUnread(rows[0]));
  assert.ok(!isUnread(rows[1]));
});

test("markOneRead stamps only the matching row", () => {
  const now = "2026-09-13T14:00:00.000Z";
  const rows = [
    row({ id: "a", read_at: null }),
    row({ id: "b", read_at: null }),
    row({ id: "c", read_at: "2026-09-12T00:00:00.000Z" }),
  ];
  const next = markOneRead(rows, "b", now);
  assert.equal(next[0].read_at, null);
  assert.equal(next[1].read_at, now);
  assert.equal(next[2].read_at, "2026-09-12T00:00:00.000Z");
  // input untouched (no mutation)
  assert.equal(rows[1].read_at, null);
});

test("markAllRead stamps every unread row and keeps existing stamps", () => {
  const now = "2026-09-13T14:00:00.000Z";
  const rows = [
    row({ id: "a", read_at: null }),
    row({ id: "b", read_at: null }),
    row({ id: "c", read_at: "2026-09-12T00:00:00.000Z" }),
  ];
  const next = markAllRead(rows, now);
  assert.equal(next[0].read_at, now);
  assert.equal(next[1].read_at, now);
  assert.equal(next[2].read_at, "2026-09-12T00:00:00.000Z");
  assert.equal(unreadCount(next), 0);
});

test("deep links are well-formed app routes", () => {
  for (const t of NOTIFICATION_TYPES) {
    const meta = metaForType(t);
    assert.ok(meta.label.length > 0, t);
  }
  assert.ok(isWellFormedDeepLink("/checklists/abc"));
  assert.ok(isWellFormedDeepLink("/training/x"));
  assert.ok(isWellFormedDeepLink("/certificates/1"));
  assert.ok(isWellFormedDeepLink("/meds/2"));
  assert.ok(!isWellFormedDeepLink("checklists/abc"), "relative rejected");
  assert.ok(!isWellFormedDeepLink("https://evil.example/x"), "absolute URL rejected");
  assert.ok(!isWellFormedDeepLink("/x y"), "spaces rejected");
});

test("sortNotifications orders unread first, then newest", () => {
  const older = row({ id: "older", read_at: null, created_at: "2026-09-13T10:00:00.000Z" });
  const newer = row({ id: "newer", read_at: null, created_at: "2026-09-13T11:00:00.000Z" });
  const read = row({
    id: "read",
    read_at: "2026-09-13T12:00:00.000Z",
    created_at: "2026-09-13T12:30:00.000Z",
  });
  const sorted = sortNotifications([read, older, newer]);
  assert.deepEqual(
    sorted.map((r) => r.id),
    ["newer", "older", "read"],
  );
});

test("delegation payloads name template and individual and dedupe per (assignment, user)", () => {
  const review = buildNotificationRow(
    delegationReviewReadyPayload({
      agencyId: AGENCY,
      userId: USER,
      assignmentId: ASSIGNMENT,
      templateName: "G-Tube Feedings",
      individualName: "Ellis",
    }),
  );
  assert.equal(review.type, "delegation.review_ready");
  assert.equal(review.title, "Delegation ready for review");
  assert.ok((review.body as string).includes("G-Tube Feedings"));
  assert.ok((review.body as string).includes("Ellis"));
  assert.equal(review.deep_link, "/delegations/templates");
  assert.ok(isWellFormedDeepLink(review.deep_link as string));
  assert.equal(review.entity_type, "delegation_assignment");
  assert.equal(review.entity_id, ASSIGNMENT);

  const published = buildNotificationRow(
    delegationPublishedPayload({
      agencyId: AGENCY,
      userId: USER,
      assignmentId: ASSIGNMENT,
      templateName: "G-Tube Feedings",
      individualName: "Ellis",
    }),
  );
  assert.equal(published.type, "delegation.published");
  assert.equal(published.title, "New delegation training to review");
  assert.ok((published.body as string).includes("G-Tube Feedings"));
  assert.ok((published.body as string).includes("Ellis"));
  assert.ok((published.body as string).toLowerCase().includes("sign"));
  assert.equal(published.deep_link, "/delegations/templates");
  assert.ok(isWellFormedDeepLink(published.deep_link as string));

  const overdue = buildNotificationRow(
    delegationAckOverduePayload({
      agencyId: AGENCY,
      userId: USER,
      assignmentId: ASSIGNMENT,
      templateName: "G-Tube Feedings",
      individualName: "Ellis",
      daysOverdue: 4,
    }),
  );
  assert.equal(overdue.type, "delegation.ack_overdue");
  assert.equal(overdue.title, "Delegation acknowledgment overdue");
  assert.ok((overdue.body as string).includes("4 days"));
  assert.equal(overdue.deep_link, "/delegations/templates");
  assert.ok(isWellFormedDeepLink(overdue.deep_link as string));

  // unique dedupe per (assignment, user); types are distinct events
  const sameAgain = buildNotificationRow(
    delegationReviewReadyPayload({
      agencyId: AGENCY,
      userId: USER,
      assignmentId: ASSIGNMENT,
      templateName: "G-Tube Feedings",
      individualName: "Ellis",
    }),
  );
  assert.equal(review.dedupe_key, sameAgain.dedupe_key, "same event dedupes");

  const otherUser = buildNotificationRow(
    delegationReviewReadyPayload({
      agencyId: AGENCY,
      userId: "00000000-0000-4000-8000-000000000003",
      assignmentId: ASSIGNMENT,
      templateName: "G-Tube Feedings",
      individualName: "Ellis",
    }),
  );
  assert.notEqual(review.dedupe_key, otherUser.dedupe_key, "different user differs");

  const otherAssignment = buildNotificationRow(
    delegationReviewReadyPayload({
      agencyId: AGENCY,
      userId: USER,
      assignmentId: "00000000-0000-4000-8000-000000000051",
      templateName: "G-Tube Feedings",
      individualName: "Ellis",
    }),
  );
  assert.notEqual(review.dedupe_key, otherAssignment.dedupe_key, "different assignment differs");

  assert.notEqual(review.dedupe_key, published.dedupe_key, "different types differ");
  assert.notEqual(published.dedupe_key, overdue.dedupe_key, "different types differ");
});

test("open-shift notifications open the Employee Hub", async () => {
  const { notificationPage } = await import("./notify");
  for (const t of ["hr.open_shift_posted", "hr.open_shift_bid", "hr.open_shift_picked_up", "hr.open_shift_approved", "hr.open_shift_denied"]) {
    assert.ok(isNotificationType(t), t);
  }
  assert.equal(notificationPage("/hub/open-shifts"), "Employee Hub");
});

test("weekly overtime: approaching from 36h, flagged only past 41h", async () => {
  const { weeklyHoursStatus } = await import("../../data/hr");
  assert.equal(weeklyHoursStatus(35.9), "ok");
  assert.equal(weeklyHoursStatus(36), "approaching");
  assert.equal(weeklyHoursStatus(40.5), "approaching", "30 minutes over is ignored");
  assert.equal(weeklyHoursStatus(41), "approaching", "exactly 41 is not flagged");
  assert.equal(weeklyHoursStatus(41.25), "overtime");
});

test("approaching-overtime notices reach the staff member and managers separately", async () => {
  const { overtimeApproachingPayload } = await import("./notify");
  const self = overtimeApproachingPayload({ agencyId: "a", userId: "u", staffId: "u", staffName: "Alex", hoursWorked: 37.5, weekLabel: "2026-09-27", forStaffMember: true });
  const hm = overtimeApproachingPayload({ agencyId: "a", roleKey: "house_manager", staffId: "u", staffName: "Alex", hoursWorked: 37.5, weekLabel: "2026-09-27", forStaffMember: false });
  assert.ok(self.body.startsWith("You're at 37.5h"));
  assert.ok(hm.body.startsWith("Alex is at 37.5h"));
  assert.notEqual(self.dedupeKey, hm.dedupeKey);
});
