import test from "node:test";
import assert from "node:assert/strict";
import {
  DELEGATION_ACK_DUE_DAYS,
  DELEGATION_TEMPLATES,
  DIGITAL_RECORD_MARK,
  acknowledgmentDueAt,
  instantiateDraft,
  isAcknowledgmentOverdue,
  trainingMaterialStatusLabel,
  visibleMaterialForStaff,
  type DelegationTrainingMaterial,
  type IndividualDelegationAssignment,
} from "./delegation";

test("library ships exactly eight Complyrer-original templates", () => {
  assert.equal(DELEGATION_TEMPLATES.length, 8);
  const names = DELEGATION_TEMPLATES.map((t) => t.name);
  assert.deepEqual(names, [
    "Bowel movement (BM) protocol",
    "Seizure protocol",
    "High-fiber/high-protein diet",
    "Calorie intake tracking",
    "Choking/aspiration protocol",
    "G-tube feeding support",
    "Blood sugar monitoring",
    "Fall prevention",
  ]);
  for (const t of DELEGATION_TEMPLATES) {
    assert.ok(t.sections.purpose.length > 0, `${t.name} has a purpose`);
    assert.ok(t.sections.steps.length >= 3, `${t.name} has steps`);
    assert.ok(t.sections.safetyWarnings.length > 0, `${t.name} has safety warnings`);
    assert.ok(t.sections.documentation.length > 0, `${t.name} has documentation`);
    assert.ok(
      t.individualizationNote.length > 0,
      `${t.name} requires individualization`,
    );
    assert.equal(t.active, true);
  }
});

test("instantiateDraft copies generic sections and stamps the person", () => {
  const template = { ...DELEGATION_TEMPLATES[0], id: "t1", agencyId: null };
  const assignment: Pick<
    IndividualDelegationAssignment,
    "individualId" | "individualName" | "siteId" | "siteName"
  > = {
    individualId: "p1",
    individualName: "Jodie",
    siteId: "s1",
    siteName: "Maple House",
  };
  const draft = instantiateDraft(template, assignment);
  assert.equal(draft.templateName, template.name);
  assert.equal(draft.individualName, "Jodie");
  assert.equal(draft.individualNotes, "");
  assert.deepEqual(draft.steps, template.sections.steps);
  assert.equal(draft.generatedMark, DIGITAL_RECORD_MARK);
  // Copies, not references — editing the draft must not touch the template.
  draft.steps.push("extra");
  assert.equal(template.sections.steps.includes("extra"), false);
});

test("status labels cover the draft → in_review → published lifecycle", () => {
  assert.equal(trainingMaterialStatusLabel("draft"), "Draft");
  assert.equal(trainingMaterialStatusLabel("in_review"), "In review");
  assert.equal(trainingMaterialStatusLabel("published"), "Published");
});

test("ordinary staff never see draft content", () => {
  const material: DelegationTrainingMaterial = {
    id: "m1",
    agencyId: "a1",
    assignmentId: "as1",
    status: "draft",
    draftContent: instantiateDraft(
      { ...DELEGATION_TEMPLATES[1], id: "t2", agencyId: null },
      { individualId: "p1", individualName: "Jodie", siteId: "s1", siteName: "Maple House" },
    ),
    publishedContent: null,
    submittedAt: null,
    approvedAt: null,
    approvedBy: null,
  };
  assert.equal(visibleMaterialForStaff(material, false), null);
  assert.ok(visibleMaterialForStaff(material, true));
  const published = { ...material, status: "published" as const, publishedContent: material.draftContent };
  assert.ok(visibleMaterialForStaff(published, false));
});

test("acknowledgment due window is seven days after publication", () => {
  assert.equal(DELEGATION_ACK_DUE_DAYS, 7);
  const publishedAt = "2026-09-01T10:00:00.000Z";
  assert.equal(acknowledgmentDueAt(publishedAt), "2026-09-08T10:00:00.000Z");
  const justAfter = Date.parse("2026-09-08T10:00:01.000Z");
  const justBefore = Date.parse("2026-09-08T09:59:59.000Z");
  assert.equal(isAcknowledgmentOverdue(null, publishedAt, justAfter), true);
  assert.equal(isAcknowledgmentOverdue(null, publishedAt, justBefore), false);
  assert.equal(
    isAcknowledgmentOverdue("2026-09-09T10:00:00.000Z", publishedAt, justAfter),
    false,
    "signed staff are never overdue",
  );
  assert.equal(isAcknowledgmentOverdue(null, null, justAfter), false);
});

test("digital-record mark is present on every instantiated draft", () => {
  assert.ok(DIGITAL_RECORD_MARK.includes("Complyrer"));
  for (const t of DELEGATION_TEMPLATES) {
    const draft = instantiateDraft(
      { ...t, id: "x", agencyId: null },
      { individualId: "p", individualName: "N", siteId: "s", siteName: "S" },
    );
    assert.equal(draft.generatedMark, DIGITAL_RECORD_MARK);
  }
});
