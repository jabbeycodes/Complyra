import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TRAINING_TOPICS } from "../features/training/topics";
import {
  CHECKLIST_ATTESTATION_TEXT,
  CHECKLIST_DEADLINE_TEXT,
  SERVICE_LOG_PROMPTS,
  WEEKLY_CHECKLIST_ITEMS,
} from "./hmChecklist";
import {
  DELEGATION_NON_TRANSFERABILITY_CLAUSE,
  DELEGATION_RN_RESPONSIBILITY_CLAUSE,
} from "./types";
import {
  ORIGINAL_ATTESTATION,
  ORIGINAL_DEADLINE,
  ORIGINAL_HM_PROMPTS,
  ORIGINAL_NON_TRANSFERABILITY_CLAUSE,
  ORIGINAL_RN_RESPONSIBILITY_CLAUSE,
  ORIGINAL_SERVICE_LOG_PROMPTS,
  ORIGINAL_TOPIC_TITLES,
} from "./complyrerOriginal.fixtures";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const COVERAGE_MAP = readFileSync(join(ROOT, "docs/coverage-map.md"), "utf8");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

test("coverage map covers every rewritten topic id", () => {
  for (const topic of TRAINING_TOPICS) {
    assert.ok(
      COVERAGE_MAP.includes(`\`${topic.id}\``),
      `coverage map is missing topic id ${topic.id}`,
    );
    assert.ok(
      COVERAGE_MAP.includes(ORIGINAL_TOPIC_TITLES[topic.id]),
      `coverage map is missing the original wording for ${topic.id}`,
    );
  }
});

test("coverage map covers every HM checklist item, service-log prompt, and clause", () => {
  for (const item of WEEKLY_CHECKLIST_ITEMS) {
    assert.ok(COVERAGE_MAP.includes(`\`${item.key}\``), `missing HM item ${item.key}`);
  }
  for (const key of Object.keys(SERVICE_LOG_PROMPTS)) {
    assert.ok(COVERAGE_MAP.includes(`\`${key}\``), `missing service-log key ${key}`);
  }
  assert.ok(COVERAGE_MAP.includes(ORIGINAL_NON_TRANSFERABILITY_CLAUSE.slice(0, 60)));
  assert.ok(COVERAGE_MAP.includes(ORIGINAL_RN_RESPONSIBILITY_CLAUSE.slice(0, 60)));
  assert.ok(COVERAGE_MAP.includes(ORIGINAL_ATTESTATION.slice(0, 40)));
  assert.ok(COVERAGE_MAP.includes(ORIGINAL_DEADLINE));
});

test("every rewritten training topic title differs from its original", () => {
  assert.equal(Object.keys(ORIGINAL_TOPIC_TITLES).length, TRAINING_TOPICS.length);
  for (const topic of TRAINING_TOPICS) {
    const original = ORIGINAL_TOPIC_TITLES[topic.id];
    assert.ok(original, `no original fixture for ${topic.id}`);
    assert.notEqual(topic.title, original, `topic ${topic.id} was not reworded`);
  }
});

test("HM checklist prompts, service-log prompts, attestation, and deadline all differ from the originals", () => {
  for (const item of WEEKLY_CHECKLIST_ITEMS) {
    assert.notEqual(item.prompt, ORIGINAL_HM_PROMPTS[item.key], `HM item ${item.key} was not reworded`);
  }
  for (const [key, prompt] of Object.entries(SERVICE_LOG_PROMPTS)) {
    assert.notEqual(prompt, ORIGINAL_SERVICE_LOG_PROMPTS[key], `service-log ${key} was not reworded`);
  }
  assert.notEqual(CHECKLIST_ATTESTATION_TEXT, ORIGINAL_ATTESTATION);
  assert.notEqual(CHECKLIST_DEADLINE_TEXT, ORIGINAL_DEADLINE);
});

test("delegation clauses no longer contain the verbatim phrases", () => {
  assert.notEqual(DELEGATION_NON_TRANSFERABILITY_CLAUSE, ORIGINAL_NON_TRANSFERABILITY_CLAUSE);
  assert.notEqual(DELEGATION_RN_RESPONSIBILITY_CLAUSE, ORIGINAL_RN_RESPONSIBILITY_CLAUSE);
  const verbatimFragments = [
    "may not be transferred to other individuals with similar needs",
    "responsible for the provision of guidance and ongoing evaluation",
    "have been trained by a licensed person, demonstrate competency in all instructed procedures",
    "including periodic inspection based at intervals determined by the delegating RN",
  ];
  const corpus = [DELEGATION_NON_TRANSFERABILITY_CLAUSE, DELEGATION_RN_RESPONSIBILITY_CLAUSE].join("\n");
  for (const fragment of verbatimFragments) {
    assert.ok(!corpus.includes(fragment), `verbatim fragment still present: ${fragment}`);
  }
});

test("no UI or PDF source references the exact replica or the legacy template name", () => {
  // Data-compat references remain in src/data (types.ts keeps the union, the
  // mappers keep the legacy-row default); the UI and PDFs must not surface them.
  const bad: string[] = [];
  for (const file of walk(join(ROOT, "src"))) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    if (file.includes(join("src", "data"))) continue; // data compat excepted
    const text = readFileSync(file, "utf8");
    if (text.includes("LifepathDelegationForm")) bad.push(`${file}: LifepathDelegationForm`);
    if (text.includes("lifepath_exact")) bad.push(`${file}: lifepath_exact`);
  }
  assert.deepEqual(bad, []);
});

test("the exact-replica component file is gone", () => {
  const gone = join(ROOT, "src/features/delegations/LifepathDelegationForm.tsx");
  assert.throws(() => readFileSync(gone, "utf8"), /ENOENT/);
});

test("every generated PDF stamps the Complyrer record mark", () => {
  const pdfFiles = [
    "src/pdf/delegationPdf.ts",
    "src/pdf/trainingChecklistPdf.ts",
    "src/pdf/hmChecklistPdf.ts",
    "src/pdf/acknowledgmentPdf.ts",
    "src/pdf/carePlanPdf.ts",
    "src/pdf/monthlyChecksPdf.ts",
    "src/pdf/siteReviewPdf.ts",
  ];
  for (const rel of pdfFiles) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(
      text.includes("stampRecordMark"),
      `${rel} does not stamp the record mark`,
    );
  }
});
