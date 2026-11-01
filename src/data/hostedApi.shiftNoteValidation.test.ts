import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HostedApi } from "./hostedApi";
import { addDaysIso, centralTodayIso } from "./menuRecords";
import { ESIGN_CONSENT_VERSION } from "../features/signatures/signatureUtils";

/**
 * Wave 7F (simulation batch 37): hosted shift notes were accepted with
 * future dates, future begin times, emptied bodies on edit, and no
 * signature on the finished record. These tests pin the store-level
 * refusals in HostedApi.saveShiftNote with a stubbed Supabase client —
 * a direct store call must be refused, not just the form — and pin that
 * valid creates and edits still save.
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
  updates: { table: string; payload: Record<string, unknown> }[];
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
  update(payload: Record<string, unknown>) {
    this.ctx.updates.push({ table: this.table, payload });
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

function stubbedHostedApi(options: {
  existingSignature: string;
  hasAdoptedSignature: boolean;
}) {
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
  const existingNoteRow = {
    id: "note-1",
    staff_user_id: USER_ID,
    signature_data_url: options.existingSignature,
  };
  const ctx: StubCtx = {
    inserts: [],
    updates: [],
    single(table: string): StubResult {
      switch (table) {
        case "agency_roles":
          return { data: { permissions: {} }, error: null };
        case "user_signatures":
          return options.hasAdoptedSignature
            ? {
                data: {
                  signature_path: `${USER_ID}/signature.png`,
                  initials_path: `${USER_ID}/initials.png`,
                  adopted_at: "2026-10-01T00:00:00.000Z",
                  consent_at: "2026-10-01T00:00:00.000Z",
                  consent_text_version: ESIGN_CONSENT_VERSION,
                },
                error: null,
              }
            : { data: null, error: null };
        case "isp_programs":
          return { data: programRow, error: null };
        case "isp_scoring_methods":
          return { data: { levels: [{ id: "lvl-1" }] }, error: null };
        case "individuals":
          return { data: { site_id: "site-1" }, error: null };
        case "shift_notes":
          return { data: existingNoteRow, error: null };
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
      from: () => ({
        download: async () => ({
          data: new Blob([PNG_BYTES], { type: "image/png" }),
          error: null,
        }),
      }),
    },
  };
  return {
    api: new HostedApi(client as unknown as SupabaseClient),
    ctx,
  };
}

const CREATE_INPUT = {
  individualId: "ind-1",
  programId: "prog-1",
  noteDate: "2026-10-30",
  shift: "Day",
  beginTime: "07:00",
  endTime: "15:00",
  location: "Maple House",
  staffTitle: "DSP",
  waiverService: "Individualized Supported Living",
  signatureDataUrl: PNG_1X1,
  summary: "Supported practice of the community integration goal.",
  timeSpentMinutes: null,
  scores: [],
};

const UPDATE_INPUT = {
  ...CREATE_INPUT,
  noteId: "note-1",
  summary: "Corrected body.",
};

function centralMinutesNow(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  return Number(read("hour")) * 60 + Number(read("minute"));
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

test("wave 7F hosted: a future-dated create is refused before any insert", async () => {
  const { api, ctx } = stubbedHostedApi({
    existingSignature: PNG_1X1,
    hasAdoptedSignature: true,
  });
  await assert.rejects(
    () =>
      api.saveShiftNote({
        ...CREATE_INPUT,
        noteDate: addDaysIso(centralTodayIso(), 1),
      }),
    /dated in the future/,
  );
  assert.equal(
    ctx.inserts.filter((row) => row.table === "shift_notes").length,
    0,
    "no note row was inserted",
  );
});

test("wave 7F hosted: an invalid note date is refused with a plain message (calendar parity with LocalApi)", async () => {
  const { api } = stubbedHostedApi({
    existingSignature: PNG_1X1,
    hasAdoptedSignature: true,
  });
  await assert.rejects(
    () => api.saveShiftNote({ ...CREATE_INPUT, noteDate: "2026-13-40" }),
    /valid note date/,
  );
});

test("wave 7F hosted: a create beginning later today is refused", async () => {
  const laterToday = centralMinutesNow() + 60;
  if (laterToday > 1439) return; // No later clock exists today; the date branch is pinned above.
  const { api, ctx } = stubbedHostedApi({
    existingSignature: PNG_1X1,
    hasAdoptedSignature: true,
  });
  await assert.rejects(
    () =>
      api.saveShiftNote({
        ...CREATE_INPUT,
        noteDate: centralTodayIso(),
        beginTime: hhmm(laterToday),
        endTime: hhmm(Math.min(1439, laterToday + 60)),
      }),
    /begin in the future/,
  );
  assert.equal(ctx.inserts.filter((row) => row.table === "shift_notes").length, 0);
});

test("wave 7F hosted: a valid create still saves", async () => {
  const { api, ctx } = stubbedHostedApi({
    existingSignature: PNG_1X1,
    hasAdoptedSignature: true,
  });
  const noteId = await api.saveShiftNote(CREATE_INPUT);
  assert.equal(noteId, "note-1");
  const insert = ctx.inserts.find((row) => row.table === "shift_notes");
  assert.ok(insert, "the note insert happened");
  assert.equal(insert.payload.signature_data_url, PNG_1X1);
});

test("wave 7F hosted: an edit cannot empty the body or move the note into the future", async () => {
  const { api, ctx } = stubbedHostedApi({
    existingSignature: PNG_1X1,
    hasAdoptedSignature: true,
  });
  await assert.rejects(
    () => api.saveShiftNote({ ...UPDATE_INPUT, summary: "   " }),
    /Describe what the person did/,
  );
  await assert.rejects(
    () =>
      api.saveShiftNote({
        ...UPDATE_INPUT,
        noteDate: addDaysIso(centralTodayIso(), 1),
      }),
    /dated in the future/,
  );
  assert.equal(
    ctx.updates.filter((row) => row.table === "shift_notes").length,
    0,
    "no note row was updated",
  );
});

test("wave 7F hosted: re-saving an unsigned note stamps the session's adopted signature", async () => {
  const { api, ctx } = stubbedHostedApi({
    existingSignature: "",
    hasAdoptedSignature: true,
  });
  const noteId = await api.saveShiftNote({ ...UPDATE_INPUT, signatureDataUrl: undefined });
  assert.equal(noteId, "note-1");
  const update = ctx.updates.find((row) => row.table === "shift_notes");
  assert.ok(update, "the note update happened");
  assert.equal(update.payload.signature_data_url, PNG_1X1);
});

test("wave 7F hosted: re-saving an unsigned note with no adopted signature is refused", async () => {
  const { api, ctx } = stubbedHostedApi({
    existingSignature: "",
    hasAdoptedSignature: false,
  });
  await assert.rejects(
    () => api.saveShiftNote({ ...UPDATE_INPUT, signatureDataUrl: undefined }),
    /Adopt your signature/,
  );
  assert.equal(ctx.updates.filter((row) => row.table === "shift_notes").length, 0);
});

test("wave 7F hosted: a valid edit of a signed note still saves", async () => {
  const { api, ctx } = stubbedHostedApi({
    existingSignature: PNG_1X1,
    hasAdoptedSignature: false,
  });
  const noteId = await api.saveShiftNote(UPDATE_INPUT);
  assert.equal(noteId, "note-1");
  const update = ctx.updates.find((row) => row.table === "shift_notes");
  assert.ok(update, "the note update happened");
  assert.equal(update.payload.summary, "Corrected body.");
});
