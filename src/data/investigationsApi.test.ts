import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import {
  createEvergreenSeed,
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";

function store() {
  return new MemoryStore(structuredClone(createEvergreenSeed()));
}

async function signInAs(username: string) {
  const api = new LocalApi(store());
  const session = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username,
    password: DEMO_PASSWORD,
  });
  return { api, session };
}

async function firstSiteId(api: LocalApi, session: Awaited<ReturnType<LocalApi["signIn"]>>) {
  const workspace = await api.loadWorkspace(session);
  return workspace.sites[0].id;
}

describe("investigations local API lifecycle", () => {
  it("creates, assigns, progresses, notes, resolves, and re-opens", async () => {
    const { api, session } = await signInAs(DEMO_ADMIN_USERNAME);
    const site = await firstSiteId(api, session);
    const created = await api.addInvestigation({
      siteId: site,
      sourceMetric: "drills",
      sourceLabel: "Fire drill · Sep 2026 missing",
      title: "Fire drill missing for September",
      description: "No fire drill logged yet this month.",
      dueOn: "2026-09-30",
    });
    assert.equal(created.storedStatus, "open");
    assert.equal(created.sourceMetric, "drills");
    assert.equal(created.history.some((e) => e.eventType === "created"), true);

    const assigned = await api.updateInvestigation(created.id, {
      assignedToUserId: session.userId,
      storedStatus: "in_progress",
    });
    assert.equal(assigned.storedStatus, "in_progress");
    assert.equal(assigned.assignedToUserId, session.userId);
    assert.equal(assigned.history.some((e) => e.eventType === "assigned"), true);
    assert.equal(
      assigned.history.some(
        (e) => e.eventType === "status_changed" && e.toStatus === "in_progress",
      ),
    true);

    const noted = await api.addInvestigationNote(created.id, "Spoke with the house manager.");
    assert.equal(noted.history.some((e) => e.eventType === "note"), true);

    const resolved = await api.resolveInvestigation(created.id);
    assert.equal(resolved.storedStatus, "resolved");
    assert.ok(resolved.resolvedAt !== null);

    const reopened = await api.reopenInvestigation(created.id);
    assert.equal(reopened.storedStatus, "open");
    assert.equal(reopened.resolvedAt, null);
    assert.equal(reopened.history.some((e) => e.eventType === "reopened"), true);

    const list = await api.listInvestigations({ siteId: site });
    assert.equal(list.some((i) => i.id === created.id), true);

    await api.deleteInvestigation(created.id);
    const afterDelete = await api.listInvestigations({ siteId: site });
    assert.equal(afterDelete.some((i) => i.id === created.id), false);
  });

  it("rejects creation without investigations.manage and validates input", async () => {
    const { api, session } = await signInAs(DEMO_DSP_USERNAME);
    const site = await firstSiteId(api, session);
    await assert.rejects(api.addInvestigation({ siteId: site, sourceMetric: "meds", title: "x" }));

    const { api: adminApi, session: adminSession } = await signInAs(DEMO_ADMIN_USERNAME);
    const adminSite = await firstSiteId(adminApi, adminSession);
    await assert.rejects(
      adminApi.addInvestigation({
        siteId: adminSite,
        sourceMetric: "general",
        title: "   ",
      }),
      /Give the investigation a title/,
    );
  });

  it("lets house managers create and assignees see their own investigations", async () => {
    const shared = store();
    // Capture the DSP's profile id first; each sign-in overwrites the shared
    // store's current session, so the HM signs in after.
    const dspProbe = new LocalApi(shared);
    const dspProbeSession = await dspProbe.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_DSP_USERNAME,
      password: DEMO_PASSWORD,
    });
    const dspUserId = dspProbeSession.userId;
    const hmApi = new LocalApi(shared);
    const hmSession = await hmApi.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_HM_USERNAME,
      password: DEMO_PASSWORD,
    });
    const site = await firstSiteId(hmApi, hmSession);
    const created = await hmApi.addInvestigation({
      siteId: site,
      sourceMetric: "certificates",
      title: "CPR expiring for two staff",
      assignedToUserId: dspUserId,
    });
    assert.equal(created.assignedToUserId, dspUserId);

    // The assignee (DSP) can read it back but cannot create.
    const dspApi = new LocalApi(shared);
    await dspApi.signIn({
      agencyCode: DEMO_AGENCY_CODE,
      username: DEMO_DSP_USERNAME,
      password: DEMO_PASSWORD,
    });
    const mine = await dspApi.listInvestigations({ assignedToUserId: dspUserId });
    assert.ok(mine.map((i) => i.id).includes(created.id));
    await assert.rejects(dspApi.addInvestigation({ siteId: site, sourceMetric: "general", title: "no" }));
  });

  it("filters by derived status", async () => {
    const { api, session } = await signInAs(DEMO_ADMIN_USERNAME);
    const site = await firstSiteId(api, session);
    await api.addInvestigation({
      siteId: site,
      sourceMetric: "shiftnotes",
      title: "Overdue coverage review",
      dueOn: "2026-01-01",
    });
    const overdue = await api.listInvestigations({ siteId: site, status: "overdue" });
    assert.ok(overdue.length > 0);
  });
});
