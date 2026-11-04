import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  AGENCY_ID,
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
} from "./seed";
import { DEMO_PASSWORD } from "./types";

/**
 * Wave 7S pins (simulation batch 103 + Pass 7 roll-up): one
 * training-clearance truth, and the HR/admin Training views must count
 * everyone.
 *
 * The fixture staffer is Quinn Newhire — a DSP with a NULL membership
 * site (no home, no assignments) and no training assigned: the exact
 * shape the hosted roster used to drop, letting the Training page
 * print "Everyone is cleared" while Quinn's own page said NOT CLEARED.
 * Quinn must read NOT CLEARED on the self view, the HR roster, and the
 * admin roster alike, and must appear in the roster with the visible
 * row state "No site assigned" (never a blank/“—” site cell).
 */
const QUINN_ID = "00000000-0000-4000-8000-0000000000q1";
const QUINN_USERNAME = "quinn.newhire";

function storeWithQuinn() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  store.db.profiles.push({
    id: QUINN_ID,
    fullName: "Quinn Newhire",
    email: "quinn.newhire@demo.complyrer.user",
    jobTitle: "Direct Support Professional",
    username: QUINN_USERNAME,
    homeAgencyId: AGENCY_ID,
    mustChangePassword: false,
  });
  store.db.memberships.push({
    id: "00000000-0000-4000-8000-0000000000q1m",
    agencyId: AGENCY_ID,
    userId: QUINN_ID,
    role: "dsp",
    roleKey: "dsp",
    siteId: null,
    expiresOn: null,
  });
  store.db.credentials.push({
    userId: QUINN_ID,
    email: "quinn.newhire@demo.complyrer.user",
    password: DEMO_PASSWORD,
  });
  return store;
}

function login(username: string) {
  return { agencyCode: DEMO_AGENCY_CODE, username, password: DEMO_PASSWORD };
}

test("Quinn's own profile (self view) reads NOT CLEARED with the no-training reason", async () => {
  const api = new LocalApi(storeWithQuinn());
  const quinnSession = await api.signIn(login(QUINN_USERNAME));
  const profile = await api.getStaffTrainingProfile(quinnSession.userId);
  assert.equal(profile.clearedForInRatio, false);
  assert.ok(
    profile.gateReasons.some((reason) => /No training assigned yet/.test(reason)),
    "the self view names why Quinn is not cleared",
  );
});

test("admin and HR rosters alike list Quinn as NOT CLEARED with the 'No site assigned' row state", async () => {
  const hrUsername =
    new MemoryStore(structuredClone(createEvergreenSeed())).db.profiles.find(
      (profile) => profile.fullName === "Tanya Brooks",
    )?.username ?? "";
  assert.ok(hrUsername, "demo seed has the HR user (Tanya Brooks)");
  for (const username of [DEMO_ADMIN_USERNAME, hrUsername]) {
    const api = new LocalApi(storeWithQuinn());
    await api.signIn(login(username));
    const rows = await api.listStaffNeedingClearance();
    const quinn = rows.find((row) => row.userId === QUINN_ID);
    assert.ok(quinn, `Quinn appears in the roster for ${username}`);
    assert.equal(quinn.clearedForInRatio, false, `Quinn is NOT CLEARED for ${username}`);
    assert.equal(quinn.siteName, "No site assigned");
    assert.ok(
      quinn.gateReasons.some((reason) => /No training assigned yet/.test(reason)),
      "the roster row names why Quinn is not cleared",
    );
    // The roster's verdict for EVERY staffer is the profile's verdict —
    // the surfaces cannot disagree.
    for (const row of rows) {
      const profile = await api.getStaffTrainingProfile(row.userId);
      assert.equal(
        row.clearedForInRatio,
        profile.clearedForInRatio,
        `roster and profile agree for ${row.fullName}`,
      );
    }
  }
});

test("a staffer with a membership home but no training shows the home name, still NOT CLEARED", async () => {
  const api = new LocalApi(storeWithQuinn());
  await api.signIn(login(DEMO_ADMIN_USERNAME));
  const rows = await api.listStaffNeedingClearance();
  // James Wilson (house manager) has a membership home in the seed and
  // no training lines: his row must name the home — he is assigned,
  // just untrained — and must not be labelled "No site assigned".
  const james = rows.find((row) => row.fullName === "James Wilson");
  assert.ok(james, "James Wilson is in the roster");
  assert.equal(james.clearedForInRatio, false);
  assert.notEqual(james.siteName, "No site assigned");
  assert.notEqual(james.siteName, "—");
  assert.ok(james.siteName.length > 0);
});

test("a site-filtered roster keeps its scope: Quinn (no site) is not in any site's roster", async () => {
  const api = new LocalApi(storeWithQuinn());
  const session = await api.signIn(login(DEMO_ADMIN_USERNAME));
  const workspace = await api.loadWorkspace(session);
  assert.ok(workspace.sites.length > 0, "demo seed has sites");
  for (const site of workspace.sites) {
    const rows = await api.listStaffNeedingClearance(site.id);
    assert.ok(
      !rows.some((row) => row.userId === QUINN_ID),
      `Quinn stays out of the ${site.name} roster`,
    );
  }
});
