import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import {
  ESIGN_CONSENT_VERSION,
  isPngDataUrl,
} from "../features/signatures/signatureUtils";

/**
 * Finding 1 (simulation batch 9): hosted shift notes could not be saved.
 * HostedApi.getSignatureImageUrl returned a storage signed URL, but the
 * shift-note save path validates the adopted signature as a PNG data URL
 * (assertAdoptableSignature) and threw "Signature must be a PNG image."
 * on every save. These tests pin the fixed contract with a stubbed
 * Supabase client: the hosted backend downloads the object and returns a
 * PNG data URL, exactly like LocalApi.
 */

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PNG_1X1 = `data:image/png;base64,${PNG_BYTES.toString("base64")}`;

const AGENCY_ID = "agency-1";
const USER_ID = "user-1";

type StubResult = { data: unknown; error: unknown };

interface StubCtx {
  inserts: { table: string; payload: Record<string, unknown> }[];
  downloads: { bucket: string; path: string }[];
  single(table: string): StubResult;
  list(table: string): StubResult;
}

/** Minimal chainable stand-in for the supabase-js query builder. */
class StubQuery implements PromiseLike<StubResult> {
  constructor(
    private readonly table: string,
    private readonly ctx: StubCtx,
  ) {}
  select() {
    return this;
  }
  eq() {
    return this;
  }
  is() {
    return this;
  }
  in() {
    return this;
  }
  lt() {
    return this;
  }
  gt() {
    return this;
  }
  order() {
    return this;
  }
  limit() {
    return this;
  }
  insert(payload: Record<string, unknown>) {
    this.ctx.inserts.push({ table: this.table, payload });
    return this;
  }
  update() {
    return this;
  }
  delete() {
    return this;
  }
  async single(): Promise<StubResult> {
    return this.ctx.single(this.table);
  }
  async maybeSingle(): Promise<StubResult> {
    return this.ctx.single(this.table);
  }
  then<TResult1 = StubResult, TResult2 = never>(
    onfulfilled?: ((value: StubResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.ctx.list(this.table)).then(onfulfilled, onrejected);
  }
}

function stubbedHostedApi() {
  const programRow = {
    id: "prog-1",
    agency_id: AGENCY_ID,
    individual_id: "ind-1",
    plan_year: "2026",
    name: "ISP 2026",
    effective_on: "2026-01-01",
    expires_on: "2026-12-31",
    schedule: "per_shift",
    max_entries_per_day: 3,
    scoring_method_id: "method-1",
    status: "approved",
    goal_service: "Community integration",
  };
  const ctx: StubCtx = {
    inserts: [],
    downloads: [],
    single(table: string): StubResult {
      switch (table) {
        case "agency_roles":
          return { data: { permissions: {} }, error: null };
        case "user_signatures":
          return {
            data: {
              signature_path: `${USER_ID}/signature.png`,
              initials_path: `${USER_ID}/initials.png`,
              adopted_at: "2026-10-01T00:00:00.000Z",
              consent_at: "2026-10-01T00:00:00.000Z",
              consent_text_version: ESIGN_CONSENT_VERSION,
            },
            error: null,
          };
        case "isp_programs":
          return { data: programRow, error: null };
        case "isp_scoring_methods":
          return { data: { levels: [{ id: "lvl-1" }] }, error: null };
        case "individuals":
          return { data: { site_id: "site-1" }, error: null };
        case "shift_notes":
          return { data: { id: "note-1" }, error: null };
        default:
          return { data: null, error: null };
      }
    },
    list(): StubResult {
      return { data: [], error: null };
    },
  };
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID, email: "dsp@example.invalid" } },
      }),
    },
    rpc: async (name: string) =>
      name === "login_context"
        ? {
            data: {
              profile: {
                id: USER_ID,
                full_name: "Dee DSP",
                email: "dsp@example.invalid",
                job_title: "DSP",
                username: "sim.dsp",
                must_change_password: false,
                platform_admin: false,
              },
              membership: {
                agency_id: AGENCY_ID,
                role: "dsp",
                role_key: "dsp",
                site_id: "site-1",
                expires_on: null,
              },
              agency: {
                id: AGENCY_ID,
                name: "Northstar Care Simulation",
                agency_code: "NORTHSTAR2-MO",
                status: "active",
              },
            },
            error: null,
          }
        : { data: null, error: null },
    from: (table: string) => new StubQuery(table, ctx),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          ctx.downloads.push({ bucket, path });
          return {
            data: new Blob([PNG_BYTES], { type: "image/png" }),
            error: null,
          };
        },
        // Deliberately NO createSignedUrl on the stub: the fixed code must
        // download the object, never mint a signed URL.
      }),
    },
  };
  return {
    api: new HostedApi(client as unknown as SupabaseClient),
    ctx,
  };
}

const NOTE_INPUT = {
  individualId: "ind-1",
  programId: "prog-1",
  noteDate: "2026-10-31",
  shift: "Day",
  beginTime: "07:00",
  endTime: "15:00",
  location: "Maple House",
  staffTitle: "DSP",
  waiverService: "Individualized Supported Living",
  summary: "Supported practice of the community integration goal.",
  timeSpentMinutes: null,
  scores: [],
};

test("hosted getSignatureImageUrl downloads the object and returns a PNG data URL", async () => {
  const { api, ctx } = stubbedHostedApi();
  const url = await api.getSignatureImageUrl(`${USER_ID}/signature.png`);
  assert.ok(isPngDataUrl(url), "result must satisfy isPngDataUrl");
  assert.equal(url, PNG_1X1);
  assert.deepEqual(ctx.downloads, [
    { bucket: "user-signatures", path: `${USER_ID}/signature.png` },
  ]);
});

test("hosted saveShiftNote with an adopted signature passes PNG validation and stores the data URL", async () => {
  const { api, ctx } = stubbedHostedApi();
  // No signatureDataUrl in the input: the save adopts the staff signature
  // via getMySignature + getSignatureImageUrl — the exact path that threw
  // "Signature must be a PNG image." before the fix.
  const noteId = await api.saveShiftNote(NOTE_INPUT);
  assert.equal(noteId, "note-1");
  const insert = ctx.inserts.find((row) => row.table === "shift_notes");
  assert.ok(insert, "the note insert happened");
  assert.equal(insert.payload.signature_data_url, PNG_1X1);
});

test("hosted saveShiftNote still rejects a non-PNG signature value (validator not loosened)", async () => {
  const { api } = stubbedHostedApi();
  await assert.rejects(
    () =>
      api.saveShiftNote({
        ...NOTE_INPUT,
        signatureDataUrl: "https://example.invalid/signature.png",
      }),
    /PNG image/,
  );
});

test("parity: LocalApi and HostedApi signature images are both PNG data URLs for the same bytes", async () => {
  const local = new LocalApi(
    new MemoryStore(structuredClone(createEvergreenSeed())),
  );
  await local.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  await local.adoptSignature({
    signatureDataUrl: PNG_1X1,
    initialsDataUrl: PNG_1X1,
    consentTextVersion: ESIGN_CONSENT_VERSION,
    consentGiven: true,
  });
  const adopted = await local.getMySignature();
  assert.ok(adopted);
  const localUrl = await local.getSignatureImageUrl(adopted.signaturePath);

  const { api } = stubbedHostedApi();
  const hostedUrl = await api.getSignatureImageUrl(`${USER_ID}/signature.png`);

  assert.ok(isPngDataUrl(localUrl), "LocalApi output is a PNG data URL");
  assert.ok(isPngDataUrl(hostedUrl), "HostedApi output is a PNG data URL");
  assert.equal(hostedUrl, localUrl);
});
