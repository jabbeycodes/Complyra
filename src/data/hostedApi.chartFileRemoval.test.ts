import assert from "node:assert/strict";
import { test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import { todayIso } from "./chart";
import { ChartChangeIncompleteError, validateRenewalUpload } from "./planStack";
import type { SessionUser } from "./types";

/**
 * PR #258 review HOLD: hosted chart-file removal must never report "removed"
 * unless the chart item, the chart record, AND the stored object are gone;
 * a rejected renewal stores nothing. Wave 4E: a renewal holds every file
 * attached to it — a replacement upload no longer retires the file it
 * supersedes, and removal is per-file (removing the pointed-at file
 * re-points the renewal to the newest remaining one). The double is a
 * small in-memory Supabase: tables, a storage bucket, and switches for
 * each failure the hosted backend can return.
 */

type Row = Record<string, unknown>;

interface Faults {
  /** storage.remove returns an error. */
  storageError?: boolean;
  /** storage.remove is refused by policy: empty result, object stays. */
  storageRefused?: boolean;
  /** chart_files delete returns an error. */
  rowDeleteError?: boolean;
}

const AGENCY = "agency-1";
const INDIVIDUAL = "individual-1";
const path = (fileId: string, name: string) => `${AGENCY}/${INDIVIDUAL}/chart/${fileId}/${name}`;

function fakeSupabase(faults: Faults = {}) {
  const tables: Record<string, Row[]> = {
    clinical_renewals: [
      {
        id: "renewal-1",
        agency_id: AGENCY,
        individual_id: INDIVIDUAL,
        kind: "vision",
        title: "Vision exam",
        interval_months: 12,
        last_uploaded_on: "2025-01-10",
        next_due_on: "2026-01-10",
        last_document_title: "old-vision.pdf",
        last_evidence_kind: "pdf",
        file_id: "file-old",
      },
    ],
    chart_files: [
      {
        id: "file-old",
        agency_id: AGENCY,
        individual_id: INDIVIDUAL,
        kind: "renewal",
        name: "old-vision.pdf",
        storage_path: path("file-old", "old-vision.pdf"),
      },
    ],
    audit_events: [],
  };
  const objects = new Set<string>([path("file-old", "old-vision.pdf")]);
  const log: string[] = [];

  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let op: "select" | "update" | "delete" | "insert" = "select";
    let patch: Row = {};
    let returning = false;
    let headCount = false;
    const matches = (row: Row) => filters.every(([key, value]) => row[key] === value);
    const run = () => {
      const rows = tables[table] ?? [];
      if (op === "insert") {
        rows.push({ ...patch });
        log.push(`insert ${table}`);
        return { data: null, error: null };
      }
      if (op === "update") {
        const hit = rows.filter(matches);
        hit.forEach((row) => Object.assign(row, patch));
        log.push(`update ${table}`);
        return { data: returning ? hit.map((row) => ({ id: row.id })) : null, error: null };
      }
      if (op === "delete") {
        log.push(`delete ${table}`);
        if (table === "chart_files" && faults.rowDeleteError) {
          return { data: null, error: { message: "permission denied for chart_files" } };
        }
        const hit = rows.filter(matches);
        tables[table] = rows.filter((row) => !matches(row));
        return { data: returning ? hit.map((row) => ({ id: row.id })) : null, error: null };
      }
      const hit = rows.filter(matches);
      return headCount
        ? { data: null, count: hit.length, error: null }
        : { data: hit.map((row) => ({ ...row })), error: null };
    };
    const builder: Record<string, unknown> = {
      select(_columns?: string, options?: { head?: boolean }) {
        if (op === "select") headCount = Boolean(options?.head);
        else returning = true;
        return builder;
      },
      eq(key: string, value: unknown) {
        filters.push([key, value]);
        return builder;
      },
      update(values: Row) {
        op = "update";
        patch = values;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      insert(values: Row) {
        op = "insert";
        patch = values;
        return builder;
      },
      async single() {
        const result = run() as { data: Row[] | null; error: unknown };
        const row = result.data?.[0] ?? null;
        return { data: row, error: row ? null : { message: "not found" } };
      },
      async maybeSingle() {
        const result = run() as { data: Row[] | null; error: unknown };
        return { data: result.data?.[0] ?? null, error: null };
      },
      then(resolve: (value: unknown) => void, reject: (reason: unknown) => void) {
        try {
          resolve(run());
        } catch (err) {
          reject(err);
        }
      },
    };
    return builder;
  };

  const storage = {
    from: () => ({
      async upload(key: string) {
        objects.add(key);
        log.push("storage upload");
        return { data: { path: key }, error: null };
      },
      async remove(keys: string[]) {
        log.push("storage remove");
        if (faults.storageError) return { data: null, error: { message: "storage unavailable" } };
        if (faults.storageRefused) return { data: [], error: null };
        const removed = keys.filter((key) => objects.delete(key));
        return { data: removed.map((name) => ({ name })), error: null };
      },
      async list(folder: string, options?: { search?: string }) {
        const names = [...objects]
          .filter((key) => key.startsWith(`${folder}/`))
          .map((key) => key.slice(folder.length + 1))
          .filter((name) => !options?.search || name.includes(options.search));
        return { data: names.map((name) => ({ name })), error: null };
      },
    }),
  };

  return {
    client: { from, storage } as unknown as SupabaseClient,
    tables,
    objects,
    log,
    renewal: () => tables.clinical_renewals[0],
    actions: () => tables.audit_events.map((row) => row.action as string),
  };
}

function hostedApi(roleKey: string, faults: Faults = {}) {
  const fake = fakeSupabase(faults);
  const api = new HostedApi(fake.client);
  (api as unknown as { requireSession(): Promise<SessionUser> }).requireSession = async () =>
    ({
      userId: `user-${roleKey}`,
      agencyId: AGENCY,
      roleKey,
      fullName: "Chart Manager",
    }) as SessionUser;
  return { api, ...fake };
}

function pdf(name: string) {
  return new File([new Uint8Array(64)], name, { type: "application/pdf" });
}

function tomorrow() {
  const date = new Date(`${todayIso()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("hosted: a program manager removes a renewal file end-to-end", async () => {
  const fake = hostedApi("program_manager");
  await fake.api.removeRenewalFile("renewal-1");
  assert.equal(fake.renewal().file_id, null);
  assert.equal(fake.renewal().next_due_on, "2026-01-10", "the due date does not move");
  assert.equal(fake.tables.chart_files.length, 0, "the chart record is gone");
  assert.equal(fake.objects.size, 0, "the stored object is gone");
  assert.deepEqual(fake.actions(), ["renewal.file_removed"]);
  // The stored document goes before its record, and both after the detach.
  assert.ok(fake.log.indexOf("update clinical_renewals") < fake.log.indexOf("storage remove"));
  assert.ok(fake.log.indexOf("storage remove") < fake.log.indexOf("delete chart_files"));
});

test("hosted: a future-dated renewal is rejected with nothing stored", async () => {
  const fake = hostedApi("program_manager");
  await assert.rejects(
    () =>
      fake.api.uploadRenewalEvidence({
        renewalId: "renewal-1",
        evidenceKind: "pdf",
        documentTitle: "Vision exam",
        file: pdf("new-vision.pdf"),
        mode: "renewal",
        uploadedOn: tomorrow(),
      }),
    /cannot be in the future/,
  );
  assert.deepEqual(fake.log, [], "no upload, no insert, no update");
  assert.equal(fake.objects.size, 1);
  assert.equal(fake.tables.chart_files.length, 1);
  assert.equal(fake.renewal().file_id, "file-old");
  assert.deepEqual(fake.actions(), []);
});

test("hosted: an impossible renewal date is rejected before anything is stored", async () => {
  const fake = hostedApi("nurse");
  await assert.rejects(
    () =>
      fake.api.uploadRenewalEvidence({
        renewalId: "renewal-1",
        evidenceKind: "pdf",
        documentTitle: "Vision exam",
        file: pdf("new-vision.pdf"),
        mode: "renewal",
        uploadedOn: "2026-02-30",
      }),
    /real calendar date/,
  );
  assert.deepEqual(fake.log, []);
});

test("hosted: a storage delete error is surfaced, the file stays on the chart, and no removal is recorded", async () => {
  const fake = hostedApi("program_manager", { storageError: true });
  await assert.rejects(() => fake.api.removeRenewalFile("renewal-1"), /storage unavailable[\s\S]*still on Vision exam/);
  assert.equal(fake.renewal().file_id, "file-old", "the chart item is re-attached");
  assert.equal(fake.renewal().last_document_title, "old-vision.pdf");
  assert.equal(fake.tables.chart_files.length, 1);
  assert.equal(fake.objects.size, 1);
  assert.ok(!fake.actions().includes("renewal.file_removed"));
});

test("hosted: a storage delete refused by policy is not mistaken for success", async () => {
  const fake = hostedApi("house_manager", { storageRefused: true });
  await assert.rejects(() => fake.api.removeRenewalFile("renewal-1"), /cannot delete the stored copy/);
  assert.equal(fake.renewal().file_id, "file-old");
  assert.equal(fake.tables.chart_files.length, 1);
  assert.ok(!fake.actions().includes("renewal.file_removed"));
});

test("hosted: a chart-record delete failure is reported as incomplete and logged for cleanup", async () => {
  const fake = hostedApi("administrator", { rowDeleteError: true });
  await assert.rejects(
    () => fake.api.removeRenewalFile("renewal-1"),
    (err: unknown) =>
      err instanceof ChartChangeIncompleteError && /file record could not be cleared/.test(err.message),
  );
  assert.ok(!fake.actions().includes("renewal.file_removed"));
  assert.deepEqual(fake.actions(), ["chart_file.cleanup_pending"]);
});

test("hosted: a replacement upload keeps both files attached and keeps the dates", async () => {
  const fake = hostedApi("nurse");
  await fake.api.uploadRenewalEvidence({
    renewalId: "renewal-1",
    evidenceKind: "pdf",
    documentTitle: "Vision exam",
    file: pdf("new-vision.pdf"),
    mode: "evidence",
  });
  const fileId = fake.renewal().file_id as string;
  assert.notEqual(fileId, "file-old");
  assert.equal(fake.renewal().next_due_on, "2026-01-10");
  // Wave 4E: the replaced file stays attached to the renewal (listed on
  // the card, removable on its own) instead of being quietly retired.
  assert.deepEqual(
    fake.tables.chart_files.map((row) => row.id).sort(),
    ["file-old", fileId].sort(),
  );
  assert.deepEqual(
    [...fake.objects].sort(),
    [path("file-old", "old-vision.pdf"), path(fileId, "new-vision.pdf")].sort(),
  );
  const attached = fake.tables.chart_files.find((row) => row.id === fileId);
  assert.equal(attached?.renewal_id, "renewal-1");
  assert.equal(attached?.evidence_kind, "pdf");
  assert.deepEqual(fake.actions(), ["renewal.evidence_uploaded"]);
});

test("hosted: removing one of several attached files leaves the others and the dates", async () => {
  const fake = hostedApi("nurse");
  // The migration backfill links the seeded file to its renewal.
  fake.tables.chart_files[0].renewal_id = "renewal-1";
  await fake.api.uploadRenewalEvidence({
    renewalId: "renewal-1",
    evidenceKind: "pdf",
    documentTitle: "Vision exam",
    file: pdf("new-vision.pdf"),
    mode: "evidence",
  });
  const currentId = fake.renewal().file_id as string;
  // Remove the OLDER file: the current pointer and the dates stay put.
  await fake.api.removeRenewalFile("renewal-1", "file-old");
  assert.equal(fake.renewal().file_id, currentId);
  assert.equal(fake.renewal().next_due_on, "2026-01-10");
  assert.deepEqual(fake.tables.chart_files.map((row) => row.id), [currentId]);
  assert.deepEqual([...fake.objects], [path(currentId, "new-vision.pdf")]);
  // Remove the current file: the pointer clears, nothing else remains.
  await fake.api.removeRenewalFile("renewal-1", currentId);
  assert.equal(fake.renewal().file_id, null);
  assert.deepEqual(fake.tables.chart_files, []);
  assert.deepEqual([...fake.objects], []);
  assert.deepEqual(fake.actions(), [
    "renewal.evidence_uploaded",
    "renewal.file_removed",
    "renewal.file_removed",
  ]);
});

test("hosted: removing the current file re-points the renewal to the newest remaining file", async () => {
  const fake = hostedApi("program_manager");
  fake.tables.chart_files[0].renewal_id = "renewal-1";
  fake.tables.chart_files[0].evidence_kind = "pdf";
  await fake.api.uploadRenewalEvidence({
    renewalId: "renewal-1",
    evidenceKind: "consultation",
    documentTitle: "Vision consult",
    file: pdf("consult.pdf"),
    mode: "evidence",
  });
  const consultId = fake.renewal().file_id as string;
  await fake.api.removeRenewalFile("renewal-1", consultId);
  assert.equal(fake.renewal().file_id, "file-old");
  assert.equal(fake.renewal().last_document_title, "old-vision.pdf");
  assert.equal(fake.renewal().last_evidence_kind, "pdf");
  assert.equal(fake.renewal().next_due_on, "2026-01-10");
  assert.deepEqual(fake.tables.chart_files.map((row) => row.id), ["file-old"]);
});

test("hosted: a file another chart item still uses is detached but not deleted", async () => {
  const fake = hostedApi("program_manager");
  fake.tables.clinical_renewals.push({ ...fake.renewal(), id: "renewal-2", kind: "dental" });
  await fake.api.removeRenewalFile("renewal-1");
  assert.equal(fake.renewal().file_id, null);
  assert.equal(fake.tables.chart_files.length, 1);
  assert.equal(fake.objects.size, 1);
  assert.deepEqual(fake.actions(), ["renewal.file_removed"]);
});

test("validateRenewalUpload: evidence ignores the date; a renewal needs a real, non-future date", () => {
  assert.equal(validateRenewalUpload({ uploadedOn: "2099-01-01" }, "2026-11-05"), "2099-01-01");
  assert.equal(
    validateRenewalUpload({ mode: "renewal", uploadedOn: "2026-11-05T10:00:00Z" }, "2026-11-05"),
    "2026-11-05",
  );
  assert.throws(() => validateRenewalUpload({ mode: "renewal", uploadedOn: "2026-11-06" }, "2026-11-05"), /future/);
  assert.throws(() => validateRenewalUpload({ mode: "renewal", uploadedOn: "11/05/2026" }, "2026-11-05"), /calendar date/);
});
