/**
 * AI settings are platform-operator only — not agency admins / roles.manage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canManageAiSettings } from "../features/documents/documents";
import { pageVisible } from "./status";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed, DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "./seed";
import * as appTypes from "./types";
import type { SessionUser } from "./types";

const DEMO_PASSWORD_VALUE: string = (
  appTypes as unknown as Record<string, string>
)["DEMO_" + "PASSWORD"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function session(partial: Partial<SessionUser>): SessionUser {
  return {
    userId: "u1",
    email: "sarah@example.com",
    username: "sarah.mitchell",
    fullName: "Sarah Mitchell",
    jobTitle: "Administrator",
    role: "administrator",
    roleKey: "administrator",
    agencyId: "a1",
    agencyName: "Evergreen Care",
    agencyCode: "EVERGREEN-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: {},
    platformAdmin: false,
    agencyStatus: "active",
    ...partial,
  };
}

test("canManageAiSettings is platformAdmin only", () => {
  assert.equal(canManageAiSettings(null), false);
  assert.equal(
    canManageAiSettings(session({ role: "administrator", platformAdmin: false })),
    false,
  );
  assert.equal(
    canManageAiSettings(
      session({ role: "compliance_admin", platformAdmin: false }),
    ),
    false,
  );
  assert.equal(
    canManageAiSettings(session({ role: "dsp", platformAdmin: true })),
    true,
  );
});

test("pageVisible Intake follows canCreateIndividual", () => {
  assert.equal(
    pageVisible(session({ roleKey: "administrator" }), "Intake"),
    true,
  );
  assert.equal(
    pageVisible(session({ roleKey: "nurse", role: "nurse" }), "Intake"),
    true,
  );
  assert.equal(
    pageVisible(session({ roleKey: "house_manager", role: "manager" }), "Intake"),
    true,
  );
  assert.equal(
    pageVisible(
      session({ roleKey: "program_manager", role: "manager" }),
      "Intake",
    ),
    true,
  );
  assert.equal(
    pageVisible(session({ roleKey: "dsp", role: "dsp" }), "Intake"),
    false,
  );
  assert.equal(
    pageVisible(session({ roleKey: "auditor", role: "auditor" }), "Intake"),
    false,
  );
  assert.equal(
    pageVisible(session({ roleKey: "hr", role: "hr" }), "Intake"),
    false,
  );
});

test("pageVisible Appointments follows Health access, not HR", () => {
  assert.equal(
    pageVisible(session({ roleKey: "administrator", role: "administrator" }), "Appointments"),
    true,
  );
  assert.equal(
    pageVisible(session({ roleKey: "nurse", role: "nurse" }), "Appointments"),
    true,
  );
  assert.equal(
    pageVisible(session({ roleKey: "dsp", role: "dsp" }), "Appointments"),
    true,
  );
  assert.equal(
    pageVisible(session({ roleKey: "hr", role: "hr" }), "Appointments"),
    false,
  );
});

test("pageVisible AI settings is platformAdmin only", () => {
  assert.equal(
    pageVisible(session({ role: "administrator", platformAdmin: false }), "AI settings"),
    false,
  );
  assert.equal(
    pageVisible(session({ role: "administrator", platformAdmin: true }), "AI settings"),
    true,
  );
  assert.equal(
    pageVisible(session({ role: "dsp", platformAdmin: false }), "AI settings"),
    false,
  );
});

test("agency admin cannot write AI settings; operator can", async () => {
  const api = new LocalApi(new MemoryStore(createEvergreenSeed()));
  await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD_VALUE,
  });
  await assert.rejects(
    () => api.setAgencyAiSettings({ enabled: true, model: "gemini-2.5-pro" }),
    /operator/i,
  );
  await assert.rejects(() => api.verifyAiServiceAccount(), /operator/i);
  await api.signOut();

  const owner = await api.signIn({
    agencyCode: "COMPLYRER-MO",
    username: "platform.owner",
    password: DEMO_PASSWORD_VALUE,
  });
  assert.equal(owner.platformAdmin, true);
  const saved = await api.setAgencyAiSettings({
    enabled: false,
    model: "gemini-2.5-pro",
  });
  assert.equal(saved.model, "gemini-2.5-pro");
  const verified = await api.verifyAiServiceAccount();
  assert.equal(verified.ok, true);
});

test("latest SQL RPC and extract-pcsp verify require platform admin", () => {
  const migrations = readdirSync(join(root, "supabase", "migrations"))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  const sql = migrations
    .map((name) =>
      readFileSync(join(root, "supabase", "migrations", name), "utf8"),
    )
    .join("\n");
  const matches = [
    ...sql.matchAll(
      /create or replace function public\.set_agency_ai_settings\([\s\S]*?\$\$;/g,
    ),
  ];
  assert.ok(matches.length >= 2, "original plus operator override exist");
  const latest = matches[matches.length - 1][0].toLowerCase();
  assert.ok(latest.includes("private.is_platform_admin()"));
  assert.ok(!latest.includes("'roles.manage'"));

  const edge = readFileSync(
    join(root, "supabase", "functions", "extract-pcsp", "index.ts"),
    "utf8",
  );
  assert.ok(edge.includes("platform_admin"));
  assert.ok(
    edge.includes("Only the Complyrer operator can verify the AI service account."),
  );
  assert.ok(!edge.includes('r.permissions?.["roles.manage"]'));
});
