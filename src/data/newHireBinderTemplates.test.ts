/**
 * newHireBinderTemplates.test.ts — build 2 model rules for the New Hire
 * Binder (src/data/newHireBinder.ts): role presets, required vs optional
 * completeness math, the board's chase-list gap ranking, and the
 * template editor's validation + key minting.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  BINDER_TEMPLATE_PRESETS,
  DEFAULT_BINDER_TEMPLATE,
  binderGaps,
  binderItemCount,
  binderTemplateForRole,
  defaultBinderTemplateLibrary,
  deriveBinder,
  isRequiredBinderItem,
  mintBinderKey,
  mostUrgentBinderGap,
  validateBinderTemplate,
  type BinderDocument,
  type BinderEvidence,
  type BinderTemplate,
  type StaffBinder,
} from "./newHireBinder";
import type { StaffTrainingProfile } from "./types";

const TODAY = "2026-10-30";

function binderWith(template: BinderTemplate): StaffBinder {
  return {
    id: "binder-1",
    agencyId: "agency-1",
    staffId: "staff-1",
    sections: JSON.parse(JSON.stringify(template.sections)) as StaffBinder["sections"],
    createdAt: "2026-10-01T09:00:00.000Z",
    updatedAt: "2026-10-01T09:00:00.000Z",
  };
}

function evidence(overrides: Partial<BinderEvidence> = {}): BinderEvidence {
  return {
    certificates: [],
    trainingProfile: null,
    documentAcks: [],
    walletDocuments: [],
    emergencyContact: null,
    ...overrides,
  };
}

function walletDoc(overrides: Partial<BinderDocument> = {}): BinderDocument {
  return {
    id: "doc-1",
    agencyId: "agency-1",
    binderId: "binder-1",
    staffId: "staff-1",
    itemKey: "resume",
    fileName: "resume.pdf",
    fileSize: 1200,
    mimeType: "application/pdf",
    storagePath: null,
    dataUrl: null,
    obtainedOn: null,
    status: "verified",
    uploadedBy: "staff-1",
    uploadedByName: "Test Staffer",
    uploadedAt: "2026-10-02T10:00:00.000Z",
    verifiedBy: "hr-1",
    verifiedByName: "Harriet HR",
    verifiedAt: "2026-10-03T10:00:00.000Z",
    returnNote: null,
    createdAt: "2026-10-02T10:00:00.000Z",
    updatedAt: "2026-10-03T10:00:00.000Z",
    ...overrides,
  };
}

function trainingProfile(
  overrides: Partial<StaffTrainingProfile> = {},
): StaffTrainingProfile {
  return {
    userId: "staff-1",
    fullName: "Test Staffer",
    siteNames: ["Cedar House"],
    individualNames: [],
    requirements: [],
    countersignatures: [],
    hoursTotal: 26,
    hoursWithHm: 13,
    counts: { required: 26, complete: 10, pending: 16, overdue: 0, waived: 0 },
    clearedForInRatio: false,
    gateReasons: ["10 of 26 topics complete"],
    certificates: [],
    ...overrides,
  };
}

function itemOf(template: BinderTemplate, key: string) {
  const item = template.sections.flatMap((s) => s.items).find((i) => i.key === key);
  assert.ok(item, `template has item ${key}`);
  return item;
}

describe("role presets", () => {
  test("three presets bind to dsp, house_manager, and nurse", () => {
    assert.deepEqual(
      BINDER_TEMPLATE_PRESETS.map((p) => [p.key, p.roleKey]),
      [
        ["preset-dsp", "dsp"],
        ["preset-house-manager", "house_manager"],
        ["preset-nurse", "nurse"],
      ],
    );
    for (const preset of BINDER_TEMPLATE_PRESETS) {
      assert.equal(binderItemCount(preset.template), binderItemCount(DEFAULT_BINDER_TEMPLATE));
      validateBinderTemplate(preset.template);
    }
  });

  test("DSP preset: insulin optional, L1MA still required, nothing else optional", () => {
    const dsp = BINDER_TEMPLATE_PRESETS[0].template;
    assert.equal(isRequiredBinderItem(itemOf(dsp, "insulin")), false);
    assert.equal(isRequiredBinderItem(itemOf(dsp, "l1ma")), true);
    const optional = dsp.sections
      .flatMap((s) => s.items)
      .filter((i) => !isRequiredBinderItem(i));
    assert.deepEqual(optional.map((i) => i.key), ["insulin"]);
  });

  test("House Manager preset: the full default, nothing optional", () => {
    const hm = BINDER_TEMPLATE_PRESETS[1].template;
    assert.ok(hm.sections.flatMap((s) => s.items).every(isRequiredBinderItem));
  });

  test("Nurse preset: driver file optional, L1MA + insulin required", () => {
    const nurse = BINDER_TEMPLATE_PRESETS[2].template;
    for (const key of ["relias-driving", "drivers-license", "mvr"]) {
      assert.equal(isRequiredBinderItem(itemOf(nurse, key)), false, key);
    }
    assert.equal(isRequiredBinderItem(itemOf(nurse, "l1ma")), true);
    assert.equal(isRequiredBinderItem(itemOf(nurse, "insulin")), true);
  });

  test("binderTemplateForRole picks the preset, else the agency default", () => {
    const library = defaultBinderTemplateLibrary();
    const nurse = binderTemplateForRole(library, "nurse");
    assert.equal(isRequiredBinderItem(itemOf(nurse, "mvr")), false);
    const hr = binderTemplateForRole(library, "hr");
    assert.equal(isRequiredBinderItem(itemOf(hr, "mvr")), true);
    assert.equal(binderTemplateForRole(library, null), library.defaultTemplate);
    assert.equal(binderTemplateForRole(library, undefined), library.defaultTemplate);
  });
});

describe("required vs optional completeness math", () => {
  test("an unsatisfied OPTIONAL item does not lower the percent", () => {
    const library = defaultBinderTemplateLibrary();
    const nurseBinder = binderWith(binderTemplateForRole(library, "nurse"));
    // Satisfy every required item: all certs current, training cleared,
    // all acks signed, all wallet docs verified, contact on file. The
    // optional driver file (license, MVR, Relias) stays missing.
    const certNames = [
      "Level 1 Medication Aide (L1MA)",
      "Insulin Administration",
      "CPR & First Aid",
      "Crisis Prevention (CPI)",
    ];
    const derived = deriveBinder(
      nurseBinder,
      evidence({
        certificates: certNames.map((certName) => ({
          certName,
          expiresOn: "2027-10-30",
        })),
        trainingProfile: trainingProfile({ clearedForInRatio: true }),
        documentAcks: [
          "Onboarding Packet",
          "HIPAA 107",
          "HELP Protocol 207",
          "Abuse & Neglect 200",
          "Event Reporting 205",
          "Infection Control 210",
          "Emergency Preparedness 204",
          "Dress Code 203",
          "Vehicle Use Agreement",
          "HCBS",
          "Individual Rights Cover Page",
          "ISP Acknowledgment",
        ].map((docKey) => ({ docKey, ackedAt: "2026-10-05T15:00:00.000Z" })),
        walletDocuments: [
          "fcsr-record",
          "background-authorization",
          "fcsr-registration",
          "ee01-voluntary-info",
          "interview-packet",
          "resume",
          "direct-deposit",
          "missouri-w4",
          "federal-w4",
          "offer-letter",
          "job-description",
          "benefits-enrollment",
          "education-record",
        ].map((itemKey, i) => walletDoc({ id: `doc-${i}`, itemKey })),
        emergencyContact: {
          id: "ec-1",
          agencyId: "agency-1",
          staffId: "staff-1",
          contactName: "Jamie Staffer",
          relationship: "Sibling",
          phone: "573-555-0101",
          alternatePhone: null,
          updatedBy: "staff-1",
          createdAt: "2026-10-01T09:00:00.000Z",
          updatedAt: "2026-10-01T09:00:00.000Z",
        },
      }),
      TODAY,
    );
    assert.equal(derived.optionalItems, 3);
    assert.equal(derived.percentComplete, 100);
    assert.equal(derived.satisfiedItems, derived.totalItems);
    assert.equal(binderGaps(derived).length, 0);
  });

  test("optional items are excluded from the denominator entirely", () => {
    const template: BinderTemplate = {
      sections: [
        {
          key: "s1",
          title: "Section",
          items: [
            { key: "req-missing", label: "Required missing", kind: "document", matchKeys: [] },
            { key: "opt-done", label: "Optional done", kind: "document", matchKeys: [], required: false },
          ],
        },
      ],
    };
    const derived = deriveBinder(
      binderWith(template),
      evidence({ walletDocuments: [walletDoc({ itemKey: "opt-done" })] }),
      TODAY,
    );
    assert.equal(derived.totalItems, 1);
    assert.equal(derived.satisfiedItems, 0);
    assert.equal(derived.percentComplete, 0);
    assert.equal(derived.optionalItems, 1);
  });
});

describe("chase-list gap ranking", () => {
  test("expired certificate outranks a missing document, which outranks returned, which outranks training in progress", () => {
    const derived = deriveBinder(
      binderWith(DEFAULT_BINDER_TEMPLATE),
      evidence({
        // CPR expired; L1MA current. Resume returned. Training started.
        certificates: [
          { certName: "Level 1 Medication Aide (L1MA)", expiresOn: "2027-10-30" },
          { certName: "CPR & First Aid", expiresOn: "2026-10-01" },
        ],
        trainingProfile: trainingProfile(),
        walletDocuments: [
          walletDoc({
            itemKey: "resume",
            status: "returned",
            verifiedBy: null,
            verifiedByName: null,
            verifiedAt: null,
            returnNote: "Please upload the signed copy",
          }),
        ],
      }),
      TODAY,
    );
    const gaps = binderGaps(derived);
    const keys = gaps.map((g) => g.item.key);
    assert.equal(keys[0], "cpr-first-aid", "expired certificate is the most urgent gap");
    assert.equal(mostUrgentBinderGap(derived)?.item.key, "cpr-first-aid");
    assert.ok(keys.indexOf("fcsr-record") > 0, "missing document after expired cert");
    assert.ok(
      keys.indexOf("fcsr-record") < keys.indexOf("resume"),
      "missing outranks returned",
    );
    assert.ok(
      keys.indexOf("resume") < keys.indexOf("staff-training-checklist"),
      "returned outranks training in progress",
    );
  });

  test("documents awaiting verification are not gaps, and optional gaps never appear", () => {
    const library = defaultBinderTemplateLibrary();
    const derived = deriveBinder(
      binderWith(binderTemplateForRole(library, "nurse")),
      evidence({
        walletDocuments: [
          walletDoc({ itemKey: "resume", status: "on_file", verifiedBy: null, verifiedByName: null, verifiedAt: null }),
        ],
      }),
      TODAY,
    );
    const keys = binderGaps(derived).map((g) => g.item.key);
    assert.ok(!keys.includes("resume"), "on-file document is HR's queue, not a gap");
    assert.ok(!keys.includes("mvr"), "optional missing item is not a gap");
    assert.ok(!keys.includes("drivers-license"), "optional missing item is not a gap");
    assert.equal(derived.awaitingVerification, 1);
  });

  test("a fully satisfied binder has no gaps", () => {
    const template: BinderTemplate = {
      sections: [
        {
          key: "s1",
          title: "Section",
          items: [
            { key: "resume", label: "Resume", kind: "document", matchKeys: [] },
          ],
        },
      ],
    };
    const derived = deriveBinder(
      binderWith(template),
      evidence({ walletDocuments: [walletDoc()] }),
      TODAY,
    );
    assert.deepEqual(binderGaps(derived), []);
    assert.equal(mostUrgentBinderGap(derived), null);
  });
});

describe("template validation + key minting", () => {
  test("the default template and all presets validate", () => {
    validateBinderTemplate(DEFAULT_BINDER_TEMPLATE);
    for (const preset of BINDER_TEMPLATE_PRESETS) validateBinderTemplate(preset.template);
  });

  test("duplicate item keys are rejected (wallet documents are keyed by item)", () => {
    const template = JSON.parse(
      JSON.stringify(DEFAULT_BINDER_TEMPLATE),
    ) as BinderTemplate;
    template.sections[0].items.push({ ...template.sections[1].items[0] });
    assert.throws(() => validateBinderTemplate(template), /Duplicate item key/);
  });

  test("a linked item without match names is rejected", () => {
    const template: BinderTemplate = {
      sections: [
        {
          key: "s1",
          title: "Section",
          items: [
            { key: "cpr", label: "CPR", kind: "certificate", matchKeys: [] },
          ],
        },
      ],
    };
    assert.throws(() => validateBinderTemplate(template), /linked item/);
  });

  test("empty sections and blank labels are rejected", () => {
    assert.throws(
      () => validateBinderTemplate({ sections: [] }),
      /at least one section/,
    );
    assert.throws(
      () =>
        validateBinderTemplate({
          sections: [{ key: "s1", title: "S", items: [] }],
        }),
      /at least one item/,
    );
    assert.throws(
      () =>
        validateBinderTemplate({
          sections: [
            {
              key: "s1",
              title: "S",
              items: [{ key: "x", label: "  ", kind: "document", matchKeys: [] }],
            },
          ],
        }),
      /needs a label/,
    );
  });

  test("mintBinderKey slugifies and de-duplicates", () => {
    const taken = new Set<string>(["cpr-first-aid"]);
    assert.equal(mintBinderKey("CPR & First Aid", taken), "cpr-first-aid-2");
    assert.equal(mintBinderKey("Motor Vehicle Record (MVR)", taken), "motor-vehicle-record-mvr");
    assert.equal(mintBinderKey("!!!", taken), "item");
  });
});
