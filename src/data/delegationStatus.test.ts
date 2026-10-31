import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DELEGATION_STATUS_LABELS,
  delegationObligationLabel,
  delegationStatusForActivation,
  delegationStatusForAssignment,
  delegationStatusForObligation,
  delegationStatusForTemplate,
  delegationStatusLabel,
  type DelegationObligationRecord,
} from "./delegationStatus";
import { delegationLifecycleLabel } from "../delegation/delegation";
import { blankDelegationForm, type DelegationForm } from "./types";

/**
 * SIM-WAVE6-ITEM5 (simulation batch 33): the same delegation showed "No
 * active" / "Active" / "Current" / "Pending" on different screens. These
 * tests pin the ONE canonical vocabulary and assert that every surface's
 * derivation — RN obligation (Delegations page list, delegation form
 * detail, Individual chart), site activation (site list + templates
 * section), assignment (templates section), and the delegation module's
 * lifecycle label — produces the identical label for the same state.
 */

const TODAY = "2026-09-13";

function signedForm(): DelegationForm {
  const form = blankDelegationForm();
  form.roster[0].printName = "Alex Morgan";
  form.roster[0].signedAt = "2026-09-01T10:00:00Z";
  form.roster[1].printName = "Sam Rivera";
  form.roster[1].signedAt = "2026-09-01T11:00:00Z";
  return form;
}

function obligation(
  patch: Partial<DelegationObligationRecord> = {},
): DelegationObligationRecord {
  return {
    enabled: true,
    expiresOn: null,
    discontinuedAt: null,
    rnSignedAt: "2026-09-01T09:00:00Z",
    delegationForm: signedForm(),
    ...patch,
  };
}

describe("canonical delegation label set", () => {
  it("has exactly one word per meaning", () => {
    assert.deepEqual(DELEGATION_STATUS_LABELS, {
      pending: "Pending",
      active: "Active",
      completed: "Completed",
      expired: "Expired",
    });
    assert.equal(delegationStatusLabel("pending"), "Pending");
    assert.equal(delegationStatusLabel("active"), "Active");
    assert.equal(delegationStatusLabel("completed"), "Completed");
    assert.equal(delegationStatusLabel("expired"), "Expired");
  });
});

describe("delegationStatusForObligation (RN forms / chart / forms list)", () => {
  it("fully signed + enabled is Active on every obligation surface", () => {
    const item = obligation();
    // DelegationsPage row, DelegationFormDetail header, and the
    // Individual chart block all render delegationObligationLabel /
    // delegationStatusLabel(delegationStatusForObligation(item)).
    assert.equal(delegationStatusForObligation(item), "active");
    assert.equal(delegationObligationLabel(item), "Active");
  });

  it("assigned but not yet effective is Pending (never Current/Off)", () => {
    // Enabled but staff signatures still outstanding.
    const unsigned = signedForm();
    unsigned.roster[1].signedAt = null;
    assert.equal(
      delegationObligationLabel(obligation({ delegationForm: unsigned })),
      "Pending",
    );
    // Created / proposed delegation not turned on yet, no form yet.
    assert.equal(
      delegationObligationLabel(
        obligation({ enabled: false, rnSignedAt: null, delegationForm: null }),
      ),
      "Pending",
    );
    // Blank form (nothing named/signed yet).
    assert.equal(
      delegationObligationLabel(obligation({ delegationForm: blankDelegationForm() })),
      "Pending",
    );
  });

  it("form-less legacy delegation signed by the RN and enabled is Active", () => {
    assert.equal(
      delegationObligationLabel(obligation({ delegationForm: null })),
      "Active",
    );
    assert.equal(
      delegationObligationLabel(
        obligation({ delegationForm: null, rnSignedAt: null }),
      ),
      "Pending",
    );
  });

  it("rescinded is Expired, beating every other state", () => {
    const form = signedForm();
    form.rescindReason = "health_status_change";
    assert.equal(delegationObligationLabel(obligation({ delegationForm: form })), "Expired");
    assert.equal(
      delegationObligationLabel(
        obligation({ delegationForm: form, discontinuedAt: "2026-09-10T00:00:00Z" }),
      ),
      "Expired",
    );
  });

  it("date expiry applies only when the delegationsExpire rule is on", () => {
    const item = obligation({ expiresOn: "2026-09-01" });
    assert.equal(
      delegationStatusForObligation(item, { today: TODAY, delegationsExpire: true }),
      "expired",
    );
    // Rule off (default): delegations do not expire by date.
    assert.equal(
      delegationStatusForObligation(item, { today: TODAY }),
      "active",
    );
    assert.equal(
      delegationStatusForObligation(item, { today: TODAY, delegationsExpire: false }),
      "active",
    );
  });

  it("discontinued by order is Completed", () => {
    assert.equal(
      delegationObligationLabel(
        obligation({ discontinuedAt: "2026-09-10T00:00:00Z" }),
      ),
      "Completed",
    );
  });
});

describe("template-library derivations use the same labels", () => {
  it("template availability", () => {
    assert.equal(delegationStatusLabel(delegationStatusForTemplate({ active: true })), "Active");
    assert.equal(delegationStatusLabel(delegationStatusForTemplate({ active: false })), "Pending");
  });

  it("site activation — the site list and the templates section agree", () => {
    // Both surfaces render delegationStatusLabel(delegationStatusForActivation(a)).
    assert.equal(
      delegationStatusLabel(delegationStatusForActivation({ status: "active" })),
      "Active",
    );
    assert.equal(
      delegationStatusLabel(delegationStatusForActivation({ status: "deactivated" })),
      "Completed",
    );
  });

  it("assignment — published is Active, draft/in-review Pending, ended Completed", () => {
    const assigned = { status: "assigned" as const };
    assert.equal(
      delegationStatusLabel(delegationStatusForAssignment(assigned, { status: "published" })),
      "Active",
    );
    assert.equal(
      delegationStatusLabel(delegationStatusForAssignment(assigned, { status: "draft" })),
      "Pending",
    );
    assert.equal(
      delegationStatusLabel(delegationStatusForAssignment(assigned, { status: "in_review" })),
      "Pending",
    );
    assert.equal(
      delegationStatusLabel(delegationStatusForAssignment(assigned, null)),
      "Pending",
    );
    assert.equal(
      delegationStatusLabel(
        delegationStatusForAssignment({ status: "ended" }, { status: "published" }),
      ),
      "Completed",
    );
  });

  it("the delegation module's lifecycle label is the canonical label", () => {
    assert.equal(delegationLifecycleLabel({ status: "assigned" }), "Pending");
    assert.equal(delegationLifecycleLabel({ status: "ended" }), "Completed");
    assert.equal(
      delegationLifecycleLabel({ status: "assigned" }),
      delegationStatusLabel(delegationStatusForAssignment({ status: "assigned" })),
    );
    assert.equal(
      delegationLifecycleLabel({ status: "ended" }),
      delegationStatusLabel(delegationStatusForAssignment({ status: "ended" })),
    );
  });
});

describe("cross-surface identity for one delegation in each state", () => {
  it("obligation fixtures read identically via status and label helpers", () => {
    const fixtures: Array<[DelegationObligationRecord, string]> = [
      [obligation(), "Active"],
      [obligation({ delegationForm: blankDelegationForm() }), "Pending"],
      [obligation({ discontinuedAt: "2026-09-10T00:00:00Z" }), "Completed"],
    ];
    const rescinded = signedForm();
    rescinded.rescindReason = "other";
    fixtures.push([obligation({ delegationForm: rescinded }), "Expired"]);
    for (const [item, label] of fixtures) {
      // The three obligation surfaces (forms list, form detail, chart)
      // differ only in whether they call the label helper directly or
      // label(status) — both paths must produce the pinned label.
      assert.equal(delegationObligationLabel(item), label);
      assert.equal(
        delegationStatusLabel(delegationStatusForObligation(item)),
        label,
      );
    }
  });
});
