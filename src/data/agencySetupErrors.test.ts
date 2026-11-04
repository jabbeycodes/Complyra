import { test } from "node:test";
import assert from "node:assert/strict";
import { FunctionsFetchError, FunctionsHttpError, type SupabaseClient } from "@supabase/supabase-js";
import {
  AGENCY_SETUP_RETRY_MESSAGE,
  AGENCY_SETUP_UNREACHABLE_MESSAGE,
  AgencySetupError,
} from "./agencySetupErrors";
import { HostedApi } from "./hostedApi";
import { AGENCY_SETUP_RETRY } from "../../supabase/functions/create-agency/handler.ts";

/**
 * Finding F-1: the failure the applicant sees through HostedApi.createAgency.
 * The screen prints err.message unchanged, so this is the on-screen text.
 */
const INPUT = {
  name: "Cedar Care",
  stateCode: "MO",
  slug: "cedarcare",
  adminFullName: "Ada Admin",
  adminUsername: "ada.admin",
  adminTempPassword: "Temporary1!",
  provisionedBy: "self" as const,
};

function apiAnswering(result: { data: unknown; error: unknown }) {
  return new HostedApi({ functions: { invoke: async () => result } } as unknown as SupabaseClient);
}

function httpFailure(status: number, body: string) {
  return { data: null, error: new FunctionsHttpError(new Response(body, { status })) };
}

async function failure(result: { data: unknown; error: unknown }): Promise<AgencySetupError> {
  const err = await apiAnswering(result).createAgency(INPUT).then(
    () => assert.fail("expected createAgency to reject"),
    (reason: AgencySetupError) => reason,
  );
  assert.ok(err instanceof AgencySetupError);
  return err;
}

test("the generic non-2xx text is gone: a field problem shows the server's reason", async () => {
  const err = await failure(httpFailure(400, JSON.stringify({ error: "Enter the agency name.", code: "invalid_input" })));
  assert.equal(err.code, "invalid_input");
  assert.equal(err.message, "Enter the agency name.");
  assert.doesNotMatch(err.message, /non-2xx/);
});

test("a provider code in use says so", async () => {
  const message = "That agency code is already in use. Try a different short name.";
  const err = await failure(httpFailure(409, JSON.stringify({ error: message, code: "code_in_use" })));
  assert.equal(err.code, "code_in_use");
  assert.equal(err.message, message);
});

test("a server fault shows the safe retry message", async () => {
  assert.equal(AGENCY_SETUP_RETRY_MESSAGE, AGENCY_SETUP_RETRY, "client and edge function agree");
  const err = await failure(httpFailure(500, JSON.stringify({ error: AGENCY_SETUP_RETRY_MESSAGE, code: "server_error" })));
  assert.equal(err.code, "server_error");
  assert.equal(err.message, AGENCY_SETUP_RETRY_MESSAGE);
});

test("backend text without a recognised code never reaches the screen", async () => {
  for (const body of [
    JSON.stringify({ error: 'duplicate key value violates unique constraint "agencies_pkey"' }),
    JSON.stringify({ error: "at handler (/index.ts:40:3)", code: "server_error" }),
    "<html>502 Bad Gateway</html>",
    "",
  ]) {
    const err = await failure(httpFailure(500, body));
    assert.equal(err.code, "server_error");
    assert.equal(err.message, AGENCY_SETUP_RETRY_MESSAGE);
  }
});

test("a dropped connection asks the applicant to retry, without raw transport text", async () => {
  const err = await failure({ data: null, error: new FunctionsFetchError(new Error("TypeError: Failed to fetch")) });
  assert.equal(err.code, "server_error");
  assert.equal(err.message, AGENCY_SETUP_UNREACHABLE_MESSAGE);
});

test("an error envelope on a 200 is treated the same way", async () => {
  const err = await failure({ data: { error: "That agency code is already in use.", code: "code_in_use" }, error: null });
  assert.equal(err.code, "code_in_use");
});

test("success returns the same result as before", async () => {
  const result = await apiAnswering({
    data: { agencyCode: "CEDARCARE-MO", username: "ada.admin", fullName: "Ada Admin", status: "pending" },
    error: null,
  }).createAgency(INPUT);
  assert.deepEqual(result, { agencyCode: "CEDARCARE-MO", username: "ada.admin", fullName: "Ada Admin", status: "pending" });
});
