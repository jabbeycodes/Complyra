/**
 * binderBoardStats tests — the board dashboard's aggregation math.
 *
 * Fabricated DerivedBinder objects mirror deriveBinder's own section
 * math (the helper below recomputes satisfied/total/percent exactly as
 * deriveBinder does), and one test cross-checks the stats against a
 * real deriveBinder run so the board can never drift from the binder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BINDER_TEMPLATE,
  deriveBinder,
  type BinderItemKind,
  type BinderItemStatus,
  type BinderTemplateItem,
  type DerivedBinder,
  type DerivedBinderItem,
  type StaffBinder,
} from "../../data/newHireBinder";
import {
  binderDonutSegments,
  binderGapBreakdown,
  binderPercent,
  binderSectionCompletion,
  binderStatusCounts,
  poolBinderStatusCounts,
  summarizeBinderBoard,
} from "./binderBoardStats";

interface ItemSpec {
  key: string;
  kind: BinderItemKind;
  status: BinderItemStatus;
  satisfied: boolean;
  required?: boolean;
}

function makeItem(spec: ItemSpec): DerivedBinderItem {
  const item: BinderTemplateItem = {
    key: spec.key,
    label: spec.key,
    kind: spec.kind,
    matchKeys: [],
    required: spec.required,
  };
  return {
    item,
    status: spec.status,
    satisfied: spec.satisfied,
    required:
      spec.kind === "records" ? false : spec.required !== false,
    note: "",
    document: null,
    certificate: null,
  };
}

function makeBinder(
  sections: Array<{ key: string; title: string; items: ItemSpec[] }>,
  awaitingVerification = 0,
): DerivedBinder {
  const derivedSections = sections.map(({ key, title, items }) => {
    const rows = items.map(makeItem);
    return {
      section: { key, title, items: rows.map((r) => r.item) },
      items: rows,
      satisfied: rows.filter((r) => r.required && r.satisfied).length,
      total: rows.filter((r) => r.required).length,
      optional: rows.filter(
        (r) => !r.required && r.item.kind !== "records",
      ).length,
      informational: rows.filter((r) => r.item.kind === "records").length,
    };
  });
  const totalItems = derivedSections.reduce((n, s) => n + s.total, 0);
  const satisfiedItems = derivedSections.reduce(
    (n, s) => n + s.satisfied,
    0,
  );
  return {
    sections: derivedSections,
    totalItems,
    satisfiedItems,
    percentComplete: totalItems
      ? Math.round((satisfiedItems / totalItems) * 100)
      : 100,
    optionalItems: derivedSections.reduce((n, s) => n + s.optional, 0),
    informationalItems: derivedSections.reduce(
      (n, s) => n + s.informational,
      0,
    ),
    awaitingVerification,
  };
}

const SATISFIED_DOC: ItemSpec = {
  key: "doc-ok",
  kind: "document",
  status: "verified",
  satisfied: true,
};
const AWAITING_DOC: ItemSpec = {
  key: "doc-wait",
  kind: "document",
  status: "on_file",
  satisfied: false,
};
const CURRENT_CERT: ItemSpec = {
  key: "cert-ok",
  kind: "certificate",
  status: "on_file",
  satisfied: true,
};
const DUE_SOON_CERT: ItemSpec = {
  key: "cert-soon",
  kind: "certificate",
  status: "due_soon",
  satisfied: true,
};

test("binderStatusCounts partitions required items exactly", () => {
  const binder = makeBinder([
    {
      key: "s1",
      title: "S1",
      items: [
        SATISFIED_DOC,
        AWAITING_DOC,
        CURRENT_CERT,
        DUE_SOON_CERT,
        { key: "cert-gone", kind: "certificate", status: "expired", satisfied: false },
        { key: "ack-gone", kind: "acknowledgment", status: "missing", satisfied: false },
        // Optional items never count, whatever their status.
        { key: "opt", kind: "document", status: "missing", satisfied: false, required: false },
        // Records items never count.
        { key: "rec", kind: "records", status: "informational", satisfied: false },
      ],
    },
  ]);
  const counts = binderStatusCounts(binder);
  assert.deepEqual(counts, {
    satisfied: 3,
    awaitingVerification: 1,
    outstanding: 2,
    total: 6,
  });
  // The partition agrees with deriveBinder's own headline fields.
  assert.equal(counts.satisfied, binder.satisfiedItems);
  assert.equal(counts.total, binder.totalItems);
});

test("pooling weights by items, not by the mean of percents", () => {
  const small = makeBinder([
    { key: "s", title: "S", items: [SATISFIED_DOC] },
  ]); // 1 of 1 = 100%
  const big = makeBinder([
    {
      key: "s",
      title: "S",
      items: [
        SATISFIED_DOC,
        { key: "m1", kind: "document", status: "missing", satisfied: false },
        { key: "m2", kind: "document", status: "missing", satisfied: false },
        { key: "m3", kind: "document", status: "missing", satisfied: false },
      ],
    },
  ]); // 1 of 4 = 25%
  const pooled = poolBinderStatusCounts([
    binderStatusCounts(small),
    binderStatusCounts(big),
  ]);
  // Pooled: 2 of 5 = 40%. A mean of percents would say 63%.
  assert.equal(binderPercent(pooled), 40);
});

test("binderPercent is 100 when nothing is tracked", () => {
  assert.equal(
    binderPercent({
      satisfied: 0,
      awaitingVerification: 0,
      outstanding: 0,
      total: 0,
    }),
    100,
  );
});

test("donut segments wear the house-donut palette and sum to the total", () => {
  const counts = { satisfied: 7, awaitingVerification: 2, outstanding: 1, total: 10 };
  const segments = binderDonutSegments(counts);
  assert.deepEqual(
    segments.map((s) => [s.label, s.count, s.color]),
    [
      ["Satisfied", 7, "#4d6b42"],
      ["Awaiting verification", 2, "#6f815c"],
      ["Outstanding", 1, "#b56a4e"],
    ],
  );
  assert.equal(
    segments.reduce((n, s) => n + s.count, 0),
    counts.total,
  );
});

test("summarizeBinderBoard pools counts and reads canonical fields", () => {
  const a = makeBinder(
    [
      {
        key: "s",
        title: "S",
        items: [
          SATISFIED_DOC,
          { key: "e", kind: "certificate", status: "expired", satisfied: false },
        ],
      },
    ],
    2,
  );
  const b = makeBinder([
    {
      key: "s",
      title: "S",
      items: [
        SATISFIED_DOC,
        CURRENT_CERT,
        { key: "m", kind: "document", status: "missing", satisfied: false },
      ],
    },
  ]);
  const summary = summarizeBinderBoard([a, b]);
  assert.equal(summary.staffCount, 2);
  assert.equal(summary.counts.total, 5);
  assert.equal(summary.counts.satisfied, 3);
  assert.equal(summary.percent, 60);
  assert.equal(summary.fullyComplete, 0);
  assert.equal(summary.awaitingVerification, 2);
  assert.equal(summary.expiredItems, 1);
  assert.equal(summary.missingItems, 1);

  const complete = makeBinder([{ key: "s", title: "S", items: [SATISFIED_DOC] }]);
  assert.equal(summarizeBinderBoard([complete]).fullyComplete, 1);
});

test("section completion pools by key and sorts weakest first", () => {
  const a = makeBinder([
    { key: "certs", title: "Certifications", items: [CURRENT_CERT, { key: "x", kind: "certificate", status: "expired", satisfied: false }] },
    { key: "docs", title: "Documents", items: [SATISFIED_DOC] },
    { key: "perf", title: "Performance", items: [{ key: "r", kind: "records", status: "informational", satisfied: false }] },
  ]);
  const b = makeBinder([
    { key: "certs", title: "Certifications", items: [CURRENT_CERT] },
    { key: "docs", title: "Documents", items: [SATISFIED_DOC, SATISFIED_DOC] },
  ]);
  const rows = binderSectionCompletion([a, b]);
  // Certifications pool to 2 of 3 (67%) and sort ahead of Documents
  // (3 of 3); the records-only section has no required items and sits last.
  assert.deepEqual(
    rows.map((r) => [r.key, r.satisfied, r.total, r.percent]),
    [
      ["certs", 2, 3, 67],
      ["docs", 3, 3, 100],
      ["perf", 0, 0, 100],
    ],
  );
});

test("gap breakdown partitions outstanding required items by kind/status", () => {
  const binder = makeBinder([
    {
      key: "s",
      title: "S",
      items: [
        SATISFIED_DOC,
        DUE_SOON_CERT, // satisfied — not a gap
        { key: "e", kind: "certificate", status: "expired", satisfied: false },
        { key: "md", kind: "document", status: "missing", satisfied: false },
        { key: "rd", kind: "document", status: "returned", satisfied: false },
        { key: "tr", kind: "training", status: "in_progress", satisfied: false },
        { key: "tm", kind: "training", status: "missing", satisfied: false },
        AWAITING_DOC,
        { key: "om", kind: "acknowledgment", status: "missing", satisfied: false },
        { key: "opt", kind: "document", status: "missing", satisfied: false, required: false },
      ],
    },
  ]);
  const { slices, totalGaps } = binderGapBreakdown([binder]);
  assert.equal(totalGaps, 7);
  const byKey = Object.fromEntries(slices.map((s) => [s.key, s.count]));
  assert.deepEqual(byKey, {
    expired: 1,
    missingDocuments: 1,
    returnedDocuments: 1,
    training: 2,
    awaiting: 1,
    otherMissing: 1,
  });
  // Largest first; percents are shares of all gaps.
  assert.equal(slices[0].key, "training");
  assert.equal(slices[0].percent, 29);
});

test("gap breakdown is empty when every binder is complete", () => {
  const binder = makeBinder([{ key: "s", title: "S", items: [SATISFIED_DOC] }]);
  const { slices, totalGaps } = binderGapBreakdown([binder]);
  assert.equal(totalGaps, 0);
  assert.deepEqual(slices, []);
});

test("stats agree with a real deriveBinder run (no evidence)", () => {
  const binder: StaffBinder = {
    id: "b1",
    agencyId: "a1",
    staffId: "u1",
    sections: DEFAULT_BINDER_TEMPLATE.sections,
    createdAt: "2026-10-30T00:00:00Z",
    updatedAt: "2026-10-30T00:00:00Z",
  };
  const derived = deriveBinder(
    binder,
    {
      certificates: [],
      trainingProfile: null,
      documentAcks: [],
      walletDocuments: [],
      emergencyContact: null,
    },
    "2026-10-30",
  );
  const counts = binderStatusCounts(derived);
  assert.equal(counts.total, derived.totalItems);
  assert.equal(counts.satisfied, derived.satisfiedItems);
  assert.equal(counts.outstanding, derived.totalItems); // nothing on file
  const summary = summarizeBinderBoard([derived]);
  assert.equal(summary.percent, derived.percentComplete);
  assert.equal(summary.missingItems, counts.outstanding);
});
