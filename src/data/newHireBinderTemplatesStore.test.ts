/**
 * newHireBinderTemplatesStore.test.ts — build 2 store flows for the New
 * Hire Binder template library (src/data/hrStore.ts, local impl):
 * listing the library, role-preset binder materialization, template
 * saves, and the snapshot rule — editing a template never rewrites an
 * already-issued binder.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHrStore, type HrStore } from "./hrStore";
import {
  binderItemCount,
  cloneBinderTemplate,
  isRequiredBinderItem,
  type BinderTemplate,
} from "./newHireBinder";

const AGENCY = "agency-binder-templates-test";

function store(userId: string): HrStore {
  return createHrStore({ agencyId: AGENCY, userId });
}

function itemOf(template: BinderTemplate | { sections: BinderTemplate["sections"] }, key: string) {
  const item = template.sections.flatMap((s) => s.items).find((i) => i.key === key);
  assert.ok(item, `has item ${key}`);
  return item;
}

describe("template library", () => {
  test("lists the agency default plus the three role presets", async () => {
    const library = await store("hr-1").listBinderTemplates();
    // 34 paper-binder items (builds 1–2) + build 3's two Performance
    // "records" items (Performance reviews, Corrective actions).
    assert.equal(binderItemCount(library.defaultTemplate), 36);
    assert.deepEqual(
      library.presets.map((p) => p.key),
      ["preset-dsp", "preset-house-manager", "preset-nurse"],
    );
    assert.deepEqual(
      library.presets.map((p) => p.roleKey),
      ["dsp", "house_manager", "nurse"],
    );
  });

  test("saving the default template is what getBinderTemplate then returns", async () => {
    const hr = store("hr-1");
    const edited = cloneBinderTemplate((await hr.listBinderTemplates()).defaultTemplate);
    edited.sections[0].title = "Background checks";
    await hr.saveBinderTemplate("default", edited);
    const after = await hr.getBinderTemplate();
    assert.equal(after.sections[0].title, "Background checks");
    const library = await hr.listBinderTemplates();
    assert.equal(library.defaultTemplate.sections[0].title, "Background checks");
  });

  test("invalid templates and unknown template ids are rejected", async () => {
    const hr = store("hr-1");
    const broken = cloneBinderTemplate((await hr.listBinderTemplates()).defaultTemplate);
    broken.sections[1].items.push({ ...broken.sections[0].items[0] });
    await assert.rejects(() => hr.saveBinderTemplate("default", broken), /Duplicate item key/);
    const valid = (await hr.listBinderTemplates()).defaultTemplate;
    await assert.rejects(
      () => hr.saveBinderTemplate("preset-nope", valid),
      /Unknown binder template/,
    );
  });
});

describe("role-preset binder materialization", () => {
  test("a nurse's first binder snapshots the nurse preset (driver file optional)", async () => {
    const hr = store("hr-1");
    const binder = await hr.getBinder("nurse-1", "nurse");
    assert.equal(isRequiredBinderItem(itemOf(binder, "mvr")), false);
    assert.equal(isRequiredBinderItem(itemOf(binder, "drivers-license")), false);
    assert.equal(isRequiredBinderItem(itemOf(binder, "l1ma")), true);
    assert.equal(isRequiredBinderItem(itemOf(binder, "insulin")), true);
  });

  test("a DSP's first binder snapshots the DSP preset (insulin optional)", async () => {
    const hr = store("hr-1");
    const binder = await hr.getBinder("dsp-1", "dsp");
    assert.equal(isRequiredBinderItem(itemOf(binder, "insulin")), false);
    assert.equal(isRequiredBinderItem(itemOf(binder, "mvr")), true);
  });

  test("roles without a preset snapshot the agency default", async () => {
    const hr = store("hr-1");
    const binder = await hr.getBinder("hr-2", "hr");
    assert.equal(isRequiredBinderItem(itemOf(binder, "insulin")), true);
    assert.equal(isRequiredBinderItem(itemOf(binder, "mvr")), true);
    const noRole = await hr.getBinder("staff-x");
    assert.equal(isRequiredBinderItem(itemOf(noRole, "insulin")), true);
  });
});

describe("snapshot semantics", () => {
  test("editing a preset after a binder is issued does not rewrite that binder", async () => {
    const hr = store("hr-1");
    const issued = await hr.getBinder("nurse-9", "nurse");
    assert.equal(isRequiredBinderItem(itemOf(issued, "mvr")), false);

    const library = await hr.listBinderTemplates();
    const nursePreset = library.presets.find((p) => p.key === "preset-nurse");
    assert.ok(nursePreset);
    const edited = cloneBinderTemplate(nursePreset.template);
    itemOf(edited, "mvr").required = true;
    itemOf(edited, "resume").label = "Resume / CV";
    await hr.saveBinderTemplate("preset-nurse", edited);

    const reread = await hr.getBinder("nurse-9", "nurse");
    assert.equal(reread.id, issued.id);
    assert.equal(isRequiredBinderItem(itemOf(reread, "mvr")), false);
    assert.equal(itemOf(reread, "resume").label, "Resume");

    const fresh = await hr.getBinder("nurse-10", "nurse");
    assert.equal(isRequiredBinderItem(itemOf(fresh, "mvr")), true);
    assert.equal(itemOf(fresh, "resume").label, "Resume / CV");
  });
});
