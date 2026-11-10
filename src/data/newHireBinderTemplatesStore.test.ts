/**
 * newHireBinderTemplatesStore.test.ts — build 2 store flows for the New
 * Hire Binder template library (src/data/hrStore.ts, local impl):
 * listing the library, role-preset binder materialization, template
 * saves, and the snapshot rule — editing a template never rewrites an
 * already-issued binder.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHrStore, SupabaseHrStore, type HrStore } from "./hrStore";
import {
  binderItemCount,
  cloneBinderTemplate,
  isRequiredBinderItem,
  type BinderTemplate,
} from "./newHireBinder";

const AGENCY = "agency-binder-templates-test";

function store(userId: string): HrStore {
  return createHrStore({ agencyId: AGENCY, userId, roleKey: "administrator" });
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

describe("template write gate (wave 3 retest)", () => {
  const roleStore = (roleKey?: string) =>
    createHrStore({ agencyId: AGENCY, userId: "gate-user", roleKey });
  const refused = /administrator or program manager/i;

  for (const roleKey of ["hr", "house_manager", "nurse", "dsp", "auditor", undefined]) {
    test(`local store refuses a save from ${roleKey ?? "a store with no role"}`, async () => {
      const template = cloneBinderTemplate((await roleStore("administrator").listBinderTemplates()).defaultTemplate);
      const before = JSON.stringify(await roleStore("administrator").getBinderTemplate());
      template.sections[0].title = "Should not save";
      await assert.rejects(() => roleStore(roleKey).saveBinderTemplate("default", template), refused);
      assert.equal(JSON.stringify(await roleStore("administrator").getBinderTemplate()), before);
    });
  }

  test("hosted store refuses HR before any write reaches the database", async () => {
    const template = cloneBinderTemplate((await roleStore("administrator").listBinderTemplates()).defaultTemplate);
    const client = {
      from() {
        throw new Error("the store must not touch the database");
      },
    } as unknown as SupabaseClient;
    await assert.rejects(
      () => new SupabaseHrStore(client, AGENCY, "hr-1", "hr").saveBinderTemplate("default", template),
      refused,
    );
  });

  test("administrators and program managers save; HR still reads and issues", async () => {
    for (const roleKey of ["administrator", "program_manager"]) {
      const template = cloneBinderTemplate((await roleStore(roleKey).listBinderTemplates()).defaultTemplate);
      await roleStore(roleKey).saveBinderTemplate("default", template);
    }
    const hr = roleStore("hr");
    assert.ok((await hr.listBinderTemplates()).presets.length > 0);
    assert.ok((await hr.getBinder("gate-new-hire", "dsp")).sections.length > 0);
  });
});

describe("template library view gate (PR #263 re-review)", () => {
  const viewRefused = /administrator, program manager, or HR/i;
  const roleStore = (roleKey?: string) =>
    createHrStore({ agencyId: AGENCY, userId: "view-gate-user", roleKey });

  for (const roleKey of ["auditor", "dsp", "house_manager", "nurse", undefined]) {
    test(`local store refuses the template library to ${roleKey ?? "a store with no role"}`, async () => {
      await assert.rejects(() => roleStore(roleKey).listBinderTemplates(), viewRefused);
    });
  }

  for (const roleKey of ["administrator", "program_manager", "hr"]) {
    test(`local store serves the template library to ${roleKey}`, async () => {
      const library = await roleStore(roleKey).listBinderTemplates();
      assert.equal(library.presets.length, 3);
    });
  }

  test("hosted store refuses a non-viewer before any read reaches the database", async () => {
    const client = {
      from() {
        throw new Error("the store must not touch the database");
      },
    } as unknown as SupabaseClient;
    await assert.rejects(
      () => new SupabaseHrStore(client, AGENCY, "auditor-1", "auditor").listBinderTemplates(),
      viewRefused,
    );
  });

  test("a non-viewer's own binder still opens — the snapshot lookup is not gated", async () => {
    const dsp = roleStore("dsp");
    const binder = await dsp.getBinder("view-gate-new-hire", "dsp");
    assert.ok(binder.sections.length > 0);
    assert.equal(binder.staffId, "view-gate-new-hire");
  });

  // The default-template read carries the same boundary (PR #263,
  // second review): getBinderTemplate() is a public template read, so
  // it asserts the view rule in both stores too.
  for (const roleKey of ["auditor", "dsp", "house_manager", "nurse", undefined]) {
    test(`local store refuses getBinderTemplate to ${roleKey ?? "a store with no role"}`, async () => {
      await assert.rejects(() => roleStore(roleKey).getBinderTemplate(), viewRefused);
    });
  }

  for (const roleKey of ["administrator", "program_manager", "hr"]) {
    test(`local store serves getBinderTemplate to ${roleKey}`, async () => {
      const template = await roleStore(roleKey).getBinderTemplate();
      assert.ok(template.sections.length > 0);
    });
  }

  test("hosted store refuses getBinderTemplate to a non-viewer before any database read", async () => {
    const client = {
      from() {
        throw new Error("the store must not touch the database");
      },
    } as unknown as SupabaseClient;
    await assert.rejects(
      () => new SupabaseHrStore(client, AGENCY, "auditor-1", "auditor").getBinderTemplate(),
      viewRefused,
    );
  });
});
