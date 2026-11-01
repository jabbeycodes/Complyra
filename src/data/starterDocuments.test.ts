/**
 * starterDocuments.test.ts — wave 7I: the binder's signature links must
 * resolve to real, readable documents.
 *
 * Simulation batches 40 + 50 found a new hire's binder saying "Open
 * Documents to sign" for twelve policy documents that did not exist
 * (hosted: the library was never provisioned) or existed as title-only
 * shells (demo seed). These tests pin the fix at every layer:
 *  - the starter library itself (twelve readable documents);
 *  - coverage: every acknowledgment item in the default binder
 *    template AND every role preset resolves to a starter document;
 *  - derivation: a missing document says "Your agency hasn't added
 *    this document yet", a content-less one says so too, and only a
 *    readable one is "signable";
 *  - the local store: a fresh agency is provisioned with the starters,
 *    the demo library is readable, and acknowledgeDocument refuses to
 *    record a signature on a document that does not exist or cannot
 *    be read;
 *  - the hosted migration (20261031270000) carries the same twelve
 *    titles and bodies and provisions them by function + trigger +
 *    backfill, mirroring the role-template provisioning pattern.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BINDER_TEMPLATE_PRESETS,
  DEFAULT_BINDER_TEMPLATE,
  binderKeyMatches,
  deriveBinder,
  type BinderEvidence,
  type BinderTemplate,
  type StaffBinder,
} from "./newHireBinder";
import {
  BINDER_DOCUMENT_MISSING_NOTE,
  BINDER_DOCUMENT_UNREADABLE_NOTE,
  DOCUMENT_INACTIVE_ERROR,
  STARTER_POLICY_DOCUMENTS,
  documentHasReadableContent,
  starterHrDocuments,
} from "./starterDocuments";
import { SupabaseHrStore, createHrStore } from "./hrStore";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AGENCY_ID as EVERGREEN_AGENCY_ID } from "./seed";

const TODAY = "2026-10-31";
const DEMO_ALEX = "00000000-0000-4000-8000-000000000203";

function ackItems(template: BinderTemplate) {
  return template.sections
    .flatMap((s) => s.items)
    .filter((i) => i.kind === "acknowledgment");
}

function binderWith(template: BinderTemplate = DEFAULT_BINDER_TEMPLATE): StaffBinder {
  return {
    id: "binder-1",
    agencyId: "agency-1",
    staffId: "staff-1",
    sections: template.sections,
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

function derivedAckItems(ev: BinderEvidence) {
  const derived = deriveBinder(binderWith(), ev, TODAY);
  return derived.sections
    .flatMap((s) => s.items)
    .filter((i) => i.item.kind === "acknowledgment");
}

describe("the starter library", () => {
  test("twelve documents, unique keys and titles, every body readable", () => {
    assert.equal(STARTER_POLICY_DOCUMENTS.length, 12);
    assert.equal(new Set(STARTER_POLICY_DOCUMENTS.map((d) => d.key)).size, 12);
    assert.equal(new Set(STARTER_POLICY_DOCUMENTS.map((d) => d.title)).size, 12);
    for (const doc of STARTER_POLICY_DOCUMENTS) {
      assert.ok(doc.body.trim().length >= 200, `${doc.title} has a real body`);
      assert.ok(
        documentHasReadableContent({ body: doc.body, fileUrl: null }),
        `${doc.title} is readable`,
      );
    }
  });

  test("starterHrDocuments builds active, ack-required policy rows for the agency", () => {
    const rows = starterHrDocuments("agency-9");
    assert.equal(rows.length, 12);
    for (const row of rows) {
      assert.equal(row.agencyId, "agency-9");
      assert.equal(row.category, "policy");
      assert.equal(row.requiresAck, true);
      assert.equal(row.active, true);
      assert.ok(documentHasReadableContent(row), `${row.title} readable`);
    }
  });
});

describe("every binder signature link resolves to a starter document", () => {
  const library = STARTER_POLICY_DOCUMENTS.map((d) => ({
    title: d.title,
    hasContent: true,
  }));

  test("all twelve default-template acknowledgment items are signable", () => {
    const items = derivedAckItems(evidence({ libraryDocuments: library }));
    assert.equal(items.length, 12);
    for (const row of items) {
      assert.equal(row.documentState, "signable", row.item.key);
      assert.equal(row.note, "Waiting for the staff member's signature", row.item.key);
    }
  });

  test("every role preset's acknowledgment items match a starter title", () => {
    for (const preset of BINDER_TEMPLATE_PRESETS) {
      for (const item of ackItems(preset.template)) {
        const matched = STARTER_POLICY_DOCUMENTS.filter((d) =>
          binderKeyMatches(item.matchKeys, d.title),
        );
        assert.ok(matched.length >= 1, `${preset.key}: ${item.key} matches a starter`);
        assert.ok(
          matched.some((d) => documentHasReadableContent({ body: d.body, fileUrl: null })),
          `${preset.key}: ${item.key} matches a READABLE starter`,
        );
      }
    }
  });
});

describe("derivation tells the truth about a missing or unreadable document", () => {
  test("empty library: every item is 'missing' with the plain agency-gap note", () => {
    const items = derivedAckItems(evidence({ libraryDocuments: [] }));
    assert.equal(items.length, 12);
    for (const row of items) {
      assert.equal(row.documentState, "missing", row.item.key);
      assert.equal(row.note, BINDER_DOCUMENT_MISSING_NOTE, row.item.key);
      assert.equal(row.note, "Your agency hasn't added this document yet");
      assert.equal(row.satisfied, false);
    }
  });

  test("title-only shells: every item is 'unreadable' with the plain note", () => {
    const shells = STARTER_POLICY_DOCUMENTS.map((d) => ({
      title: d.title,
      hasContent: false,
    }));
    const items = derivedAckItems(evidence({ libraryDocuments: shells }));
    for (const row of items) {
      assert.equal(row.documentState, "unreadable", row.item.key);
      assert.equal(row.note, BINDER_DOCUMENT_UNREADABLE_NOTE, row.item.key);
    }
  });

  test("a signed item stays verified regardless of the library state", () => {
    const items = derivedAckItems(
      evidence({
        libraryDocuments: [],
        documentAcks: [{ docKey: "HIPAA 107", ackedAt: "2026-10-20T15:00:00.000Z" }],
      }),
    );
    const hipaa = items.find((i) => i.item.key === "hipaa-107");
    assert.ok(hipaa);
    assert.equal(hipaa.satisfied, true);
    assert.equal(hipaa.status, "verified");
  });

  test("no library in the bundle: legacy derivation, documentState null", () => {
    const items = derivedAckItems(evidence());
    for (const row of items) {
      assert.equal(row.documentState, null, row.item.key);
      assert.equal(row.note, "Waiting for the staff member's signature", row.item.key);
    }
  });
});

describe("local store provisioning + signature guard", () => {
  test("a fresh agency's library is the twelve readable starters", async () => {
    const store = createHrStore({ agencyId: "agency-wave7i-fresh", userId: "owner-1" });
    const docs = await store.listDocuments();
    assert.equal(docs.length, 12);
    assert.deepEqual(
      docs.map((d) => d.title).sort(),
      STARTER_POLICY_DOCUMENTS.map((d) => d.title).sort(),
    );
    for (const doc of docs) {
      assert.ok(documentHasReadableContent(doc), `${doc.title} readable`);
    }
  });

  test("a fresh agency's binder derives every acknowledgment item signable", async () => {
    const store = createHrStore({ agencyId: "agency-wave7i-fresh-2", userId: "owner-1" });
    const binder = await store.getBinder("hire-1", "dsp");
    const docs = await store.listDocuments();
    const derived = deriveBinder(
      binder,
      evidence({
        libraryDocuments: docs.map((d) => ({
          title: d.title,
          hasContent: documentHasReadableContent(d),
        })),
      }),
      TODAY,
    );
    const items = derived.sections
      .flatMap((s) => s.items)
      .filter((i) => i.item.kind === "acknowledgment");
    assert.equal(items.length, 12);
    assert.ok(items.every((i) => i.documentState === "signable"));
  });

  test("the Evergreen demo library is readable (starter bodies, not shells)", async () => {
    const store = createHrStore({ agencyId: EVERGREEN_AGENCY_ID, userId: DEMO_ALEX });
    const docs = await store.listDocuments();
    assert.equal(docs.length, 12);
    for (const doc of docs) {
      assert.ok(documentHasReadableContent(doc), `${doc.title} readable`);
    }
  });

  test("acknowledging a readable starter records the signature", async () => {
    const store = createHrStore({ agencyId: "agency-wave7i-fresh-3", userId: "hire-9" });
    const [first] = await store.listDocuments();
    const ack = await store.acknowledgeDocument(first.id, "New Hire");
    assert.equal(ack.docId, first.id);
    assert.equal(ack.signatureName, "New Hire");
  });

  test("acknowledging a title-only shell is refused — no signing the unreadable", async () => {
    const store = createHrStore({ agencyId: "agency-wave7i-fresh-4", userId: "hire-9" });
    const shell = await store.createDocument({
      title: "Empty Policy",
      category: "policy",
      body: null,
      fileUrl: null,
      requiresAck: true,
      active: true,
    });
    await assert.rejects(
      () => store.acknowledgeDocument(shell.id, "New Hire"),
      /no readable copy yet/,
    );
    assert.equal((await store.listDocumentAcks()).length, 0);
  });

  test("acknowledging a document that does not exist is refused", async () => {
    const store = createHrStore({ agencyId: "agency-wave7i-fresh-5", userId: "hire-9" });
    await assert.rejects(
      () => store.acknowledgeDocument("doc-does-not-exist", "New Hire"),
      /Document not found/,
    );
  });
});

describe("deactivated documents are not signable targets (PR #224 fix-up)", () => {
  test("a library of only deactivated documents derives every item 'missing'", () => {
    const library = STARTER_POLICY_DOCUMENTS.map((d) => ({
      title: d.title,
      hasContent: true,
      active: false,
    }));
    const items = derivedAckItems(evidence({ libraryDocuments: library }));
    assert.equal(items.length, 12);
    for (const row of items) {
      assert.equal(row.documentState, "missing", row.item.key);
      assert.equal(row.note, BINDER_DOCUMENT_MISSING_NOTE, row.item.key);
      assert.equal(row.satisfied, false, row.item.key);
    }
  });

  test("one deactivated starter: its item is 'missing', the rest stay signable", () => {
    const library = STARTER_POLICY_DOCUMENTS.map((d) => ({
      title: d.title,
      hasContent: true,
      active: d.title !== "HIPAA 107",
    }));
    const items = derivedAckItems(evidence({ libraryDocuments: library }));
    const hipaa = items.find((i) => i.item.key === "hipaa-107");
    assert.ok(hipaa);
    assert.equal(hipaa.documentState, "missing");
    assert.equal(hipaa.note, BINDER_DOCUMENT_MISSING_NOTE);
    for (const row of items.filter((i) => i.item.key !== "hipaa-107")) {
      assert.equal(row.documentState, "signable", row.item.key);
    }
  });

  test("an inactive readable copy does not rescue an active title-only shell", () => {
    const library = [
      ...STARTER_POLICY_DOCUMENTS.filter((d) => d.title !== "HIPAA 107").map(
        (d) => ({ title: d.title, hasContent: true, active: true }),
      ),
      { title: "HIPAA 107", hasContent: false, active: true },
      { title: "HIPAA 107", hasContent: true, active: false },
    ];
    const items = derivedAckItems(evidence({ libraryDocuments: library }));
    const hipaa = items.find((i) => i.item.key === "hipaa-107");
    assert.ok(hipaa);
    assert.equal(hipaa.documentState, "unreadable");
    assert.equal(hipaa.note, BINDER_DOCUMENT_UNREADABLE_NOTE);
  });

  test("local store: a deactivated document refuses direct signing; reactivating restores it", async () => {
    const store = createHrStore({
      agencyId: "agency-wave7i-inactive-1",
      userId: "hire-9",
    });
    const docs = await store.listDocuments();
    const hipaa = docs.find((d) => d.title === "HIPAA 107");
    assert.ok(hipaa);

    await store.updateDocument(hipaa.id, { active: false });
    await assert.rejects(
      () => store.acknowledgeDocument(hipaa.id, "New Hire"),
      /deactivated/,
    );
    assert.equal((await store.listDocumentAcks()).length, 0);
    // The binder evidence no longer offers it: the library list drops
    // to eleven and the HIPAA item derives "missing", not signable.
    const remaining = await store.listDocuments();
    assert.equal(remaining.length, 11);
    const binder = await store.getBinder("hire-9", "dsp");
    const derived = deriveBinder(
      binder,
      evidence({
        libraryDocuments: remaining.map((d) => ({
          title: d.title,
          hasContent: documentHasReadableContent(d),
          active: d.active,
        })),
      }),
      TODAY,
    );
    const row = derived.sections
      .flatMap((s) => s.items)
      .find((i) => i.item.key === "hipaa-107");
    assert.ok(row);
    assert.equal(row.documentState, "missing");
    assert.equal(row.note, BINDER_DOCUMENT_MISSING_NOTE);

    // Reactivation makes the same document a signable target again.
    await store.updateDocument(hipaa.id, { active: true });
    const ack = await store.acknowledgeDocument(hipaa.id, "New Hire");
    assert.equal(ack.docId, hipaa.id);
    assert.equal((await store.listDocuments()).length, 12);
  });

  test("the inactive refusal is the shared plain-language error", () => {
    assert.match(DOCUMENT_INACTIVE_ERROR, /deactivated/);
    assert.match(DOCUMENT_INACTIVE_ERROR, /can't be signed/);
  });
});

/* ------------------------- hosted store stub ------------------------- */

interface HostedStubCtx {
  inserts: { table: string; payload: Record<string, unknown> }[];
  filters: { table: string; column: string; value: unknown }[];
  docRow: Record<string, unknown> | null;
  docRows: Record<string, unknown>[];
}

type HostedStubResult = { data: unknown; error: unknown };

/** Minimal chainable stand-in for the supabase-js query builder,
 *  covering the chains the HR document methods use. */
class HostedStubQuery implements PromiseLike<HostedStubResult> {
  constructor(
    private readonly table: string,
    private readonly ctx: HostedStubCtx,
  ) {}
  select() {
    return this;
  }
  eq(column: string, value: unknown) {
    this.ctx.filters.push({ table: this.table, column, value });
    return this;
  }
  order() {
    return this;
  }
  insert(payload: Record<string, unknown>) {
    this.ctx.inserts.push({ table: this.table, payload });
    return this;
  }
  async single(): Promise<HostedStubResult> {
    return this.result();
  }
  async maybeSingle(): Promise<HostedStubResult> {
    return this.result();
  }
  private result(): HostedStubResult {
    if (this.table === "hr_documents") {
      return { data: this.ctx.docRow, error: null };
    }
    if (this.table === "hr_document_acks") {
      const ins = this.ctx.inserts.find((i) => i.table === "hr_document_acks");
      return {
        data: {
          id: "ack-1",
          acked_at: "2026-10-31T12:00:00.000Z",
          ...(ins?.payload ?? {}),
        },
        error: null,
      };
    }
    return { data: null, error: null };
  }
  then<TResult1 = HostedStubResult, TResult2 = never>(
    onfulfilled?:
      | ((value: HostedStubResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    const value: HostedStubResult =
      this.table === "hr_documents"
        ? { data: this.ctx.docRows, error: null }
        : { data: [], error: null };
    return Promise.resolve(value).then(onfulfilled, onrejected);
  }
}

function hostedStubStore(
  docRow: Record<string, unknown> | null,
  docRows: Record<string, unknown>[] = [],
) {
  const ctx: HostedStubCtx = { inserts: [], filters: [], docRow, docRows };
  const client = {
    from: (table: string) => new HostedStubQuery(table, ctx),
  } as unknown as SupabaseClient;
  return { ctx, store: new SupabaseHrStore(client, "agency-1", "hire-1") };
}

describe("hosted store: the acknowledgment guard requires an active document", () => {
  test("acknowledging a deactivated document is refused before any insert", async () => {
    const { ctx, store } = hostedStubStore({
      body: "A readable policy body.",
      file_url: null,
      active: false,
    });
    await assert.rejects(
      () => store.acknowledgeDocument("doc-1", "New Hire"),
      /deactivated/,
    );
    assert.equal(ctx.inserts.length, 0);
  });

  test("an active readable document still acknowledges", async () => {
    const { ctx, store } = hostedStubStore({
      body: "A readable policy body.",
      file_url: null,
      active: true,
    });
    const ack = await store.acknowledgeDocument("doc-1", "New Hire");
    assert.equal(ack.docId, "doc-1");
    assert.equal(ack.signatureName, "New Hire");
    assert.equal(ctx.inserts.length, 1);
    assert.equal(ctx.inserts[0].table, "hr_document_acks");
  });

  test("the document list query requires active = true", async () => {
    const { ctx, store } = hostedStubStore(null, [
      {
        id: "doc-1",
        agency_id: "agency-1",
        title: "HIPAA 107",
        category: "policy",
        body: "A readable policy body.",
        file_url: null,
        requires_ack: true,
        active: true,
      },
    ]);
    const docs = await store.listDocuments();
    assert.equal(docs.length, 1);
    assert.equal(docs[0].title, "HIPAA 107");
    assert.ok(
      ctx.filters.some(
        (f) => f.table === "hr_documents" && f.column === "active" && f.value === true,
      ),
      "listDocuments filters hr_documents on active = true",
    );
  });
});

describe("hosted migration parity (20261031270000)", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const sql = readFileSync(
    join(root, "supabase", "migrations", "20261031270000_binder_starter_documents.sql"),
    "utf8",
  );
  const norm = sql.replace(/\s+/g, " ").toLowerCase();

  test("provisions by function + agency-insert trigger + backfill", () => {
    assert.ok(norm.includes("create or replace function public.provision_agency_starter_documents"));
    assert.ok(norm.includes("create trigger agencies_provision_starter_documents"));
    assert.ok(norm.includes("after insert on public.agencies"));
    assert.ok(
      norm.includes("select public.provision_agency_starter_documents(id) from public.agencies"),
      "existing agencies are backfilled",
    );
    assert.ok(
      norm.includes("where not exists"),
      "insert-only, title-matched: an agency's own document is never overwritten",
    );
    assert.ok(
      norm.includes("alter table public.hr_documents alter column created_by drop not null"),
      "system starter rows carry no human creator",
    );
  });

  test("carries the same twelve titles and bodies as STARTER_POLICY_DOCUMENTS", () => {
    for (const doc of STARTER_POLICY_DOCUMENTS) {
      assert.ok(sql.includes(`('${doc.title}'`), `title in migration: ${doc.title}`);
    }
    const bodies = [...sql.matchAll(/\$starter(\d+)\$([\s\S]*?)\$starter\1\$/g)]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map((m) => m[2]);
    assert.deepEqual(
      bodies,
      STARTER_POLICY_DOCUMENTS.map((d) => d.body),
      "migration bodies match the TS starter bodies, in order",
    );
  });
});
