/**
 * create-agency failure paths and the unchanged success response (finding F-1).
 * Stubbed clients only: no network, no database.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { AGENCY_CODE_IN_USE, AGENCY_SETUP_RETRY, handleCreateAgency } from "./handler.ts";

const GOOD_BODY = {
  name: "Cedar Care",
  stateCode: "MO",
  slug: "cedarcare",
  adminFullName: "Ada Admin",
  adminUsername: "ada.admin",
  adminTempPassword: "Temporary1!",
};

interface StubOptions {
  existing?: boolean;
  insertError?: { code?: string; message: string } | null;
  createUserError?: { code?: string; message: string } | null;
  memberError?: { code?: string; message: string } | null;
  throwOnInsert?: boolean;
}

function stubAdmin(options: StubOptions = {}) {
  const calls: string[] = [];
  const from = (table: string) => {
    let op = "select";
    const query = {
      select: () => query,
      eq: () => query,
      insert: () => {
        op = "insert";
        calls.push(`insert:${table}`);
        if (table === "agencies" && options.throwOnInsert) throw new Error("connection refused at 10.0.0.1");
        return query;
      },
      update: () => {
        op = "update";
        return query;
      },
      delete: () => {
        op = "delete";
        calls.push(`delete:${table}`);
        return query;
      },
      maybeSingle: async () => ({ data: options.existing ? { id: "agency-old" } : null, error: null }),
      single: async () =>
        options.insertError
          ? { data: null, error: options.insertError }
          : { data: { id: "agency-1", agency_code: "CEDARCARE-MO" }, error: null },
      then: (resolve: (value: { data: null; error: unknown }) => unknown) =>
        Promise.resolve({
          data: null,
          error: table === "memberships" && op === "insert" ? (options.memberError ?? null) : null,
        }).then(resolve),
    };
    return query;
  };
  return {
    calls,
    client: {
      from,
      auth: {
        admin: {
          createUser: async () =>
            options.createUserError
              ? { data: { user: null }, error: options.createUserError }
              : { data: { user: { id: "user-1" } }, error: null },
          deleteUser: async (id: string) => {
            calls.push(`deleteUser:${id}`);
            return { error: null };
          },
        },
      },
    },
  };
}

function run(body: unknown, options: StubOptions = {}, envOverride?: Record<string, string>) {
  const stub = stubAdmin(options);
  const env: Record<string, string> = envOverride ?? {
    SUPABASE_URL: "http://stub.invalid",
    SUPABASE_SERVICE_ROLE_KEY: "stub-service-key",
  };
  const request = new Request("http://stub.invalid/create-agency", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return handleCreateAgency(request, {
    env: (key) => env[key],
    createClient: () => stub.client,
  }).then(async (response) => ({ response, text: await response.text(), calls: stub.calls }));
}

function quietly<T>(work: () => Promise<T>) {
  const log = mock.method(console, "error", () => {});
  return work().finally(() => log.mock.restore());
}

test("success response is byte-identical to the shipped contract", async () => {
  const { response, text } = await run(GOOD_BODY);
  assert.equal(response.status, 200);
  assert.equal(text, '{"agencyCode":"CEDARCARE-MO","username":"ada.admin","fullName":"Ada Admin","status":"pending"}');
});

test("each invalid field names itself with code invalid_input", async () => {
  const cases: [Record<string, string>, RegExp][] = [
    [{ name: " " }, /agency name/],
    [{ slug: "x" }, /Agency code should be/],
    [{ stateCode: "ZZ" }, /home state/],
    [{ adminFullName: "" }, /first administrator/],
    [{ adminUsername: "a!" }, /Username must be/],
    [{ adminTempPassword: "short" }, /at least 8 characters/],
  ];
  for (const [override, message] of cases) {
    const { response, text } = await run({ ...GOOD_BODY, ...override });
    assert.equal(response.status, 400);
    const body = JSON.parse(text);
    assert.equal(body.code, "invalid_input");
    assert.match(body.error, message);
  }
});

test("a malformed request body is invalid_input, not a crash", async () => {
  const { response, text } = await run("{not json");
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(text).code, "invalid_input");
});

test("a weak password refused by auth is invalid_input and releases the code", async () => {
  const { response, text, calls } = await run(GOOD_BODY, {
    createUserError: { code: "weak_password", message: "Password is known to be weak" },
  });
  assert.equal(response.status, 400);
  assert.equal(JSON.parse(text).code, "invalid_input");
  assert.ok(calls.includes("delete:agencies"));
});

test("a provider code already taken is code_in_use, including the insert race", async () => {
  const taken = await run(GOOD_BODY, { existing: true });
  assert.equal(taken.response.status, 409);
  assert.deepEqual(JSON.parse(taken.text), { error: AGENCY_CODE_IN_USE, code: "code_in_use" });
  const race = await run(GOOD_BODY, {
    insertError: { code: "23505", message: 'duplicate key value violates unique constraint "agencies_agency_code_key"' },
  });
  assert.equal(race.response.status, 409);
  assert.deepEqual(JSON.parse(race.text), { error: AGENCY_CODE_IN_USE, code: "code_in_use" });
});

test("server faults answer the safe retry message and never the internal text", async () => {
  await quietly(async () => {
    const SECRET = /permission denied|relation|10\.0\.0\.1|stack|service-key|Database error/i;
    const faults: StubOptions[] = [
      { insertError: { code: "42501", message: "permission denied for relation agencies" } },
      { createUserError: { code: "unexpected_failure", message: "Database error creating new user" } },
      { memberError: { code: "42501", message: "permission denied for relation memberships" } },
      { throwOnInsert: true },
    ];
    for (const fault of faults) {
      const { response, text } = await run(GOOD_BODY, fault);
      assert.equal(response.status, 500);
      assert.deepEqual(JSON.parse(text), { error: AGENCY_SETUP_RETRY, code: "server_error" });
      assert.doesNotMatch(text, SECRET);
    }
    const unconfigured = await run(GOOD_BODY, {}, {});
    assert.equal(unconfigured.response.status, 500);
    assert.equal(JSON.parse(unconfigured.text).code, "server_error");
  });
});

test("an exception after the agency insert still releases the provider code", async () => {
  await quietly(async () => {
    const stub = stubAdmin();
    stub.client.auth.admin.createUser = async () => {
      throw new Error("socket hang up");
    };
    const response = await handleCreateAgency(
      new Request("http://stub.invalid/create-agency", { method: "POST", body: JSON.stringify(GOOD_BODY) }),
      {
        env: (key) => ({ SUPABASE_URL: "http://stub.invalid", SUPABASE_SERVICE_ROLE_KEY: "k" })[key],
        createClient: () => stub.client,
      },
    );
    assert.equal(response.status, 500);
    assert.ok(stub.calls.includes("delete:agencies"));
  });
});

test("a failed membership undoes the user and the agency so the retry can reuse the code", async () => {
  await quietly(async () => {
    const { calls } = await run(GOOD_BODY, { memberError: { message: "boom" } });
    assert.ok(calls.includes("deleteUser:user-1"));
    assert.ok(calls.includes("delete:agencies"));
  });
});

test("a rollback the client answers with an error is logged, and the agency delete is still tried", async () => {
  const log = mock.method(console, "error", () => {});
  try {
    const stub = stubAdmin({ memberError: { message: "boom" } });
    stub.client.auth.admin.deleteUser = async (id: string) => {
      stub.calls.push(`deleteUser:${id}`);
      return { error: { message: "user delete refused" } };
    };
    const response = await handleCreateAgency(
      new Request("http://stub.invalid/create-agency", { method: "POST", body: JSON.stringify(GOOD_BODY) }),
      {
        env: (key) => ({ SUPABASE_URL: "http://stub.invalid", SUPABASE_SERVICE_ROLE_KEY: "k" })[key],
        createClient: () => stub.client,
      },
    );
    assert.equal(response.status, 500);
    assert.ok(stub.calls.includes("delete:agencies"));
    const logged = log.mock.calls.map((call) => JSON.stringify(call.arguments));
    assert.ok(logged.some((line) => line.includes("rollback failed") && line.includes("user delete refused")));
  } finally {
    log.mock.restore();
  }
});

test("a rollback that throws on the user delete still tries the agency delete", async () => {
  await quietly(async () => {
    const stub = stubAdmin({ memberError: { message: "boom" } });
    stub.client.auth.admin.deleteUser = async () => {
      throw new Error("socket hang up");
    };
    await handleCreateAgency(
      new Request("http://stub.invalid/create-agency", { method: "POST", body: JSON.stringify(GOOD_BODY) }),
      {
        env: (key) => ({ SUPABASE_URL: "http://stub.invalid", SUPABASE_SERVICE_ROLE_KEY: "k" })[key],
        createClient: () => stub.client,
      },
    );
    assert.ok(stub.calls.includes("delete:agencies"));
  });
});
