import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalApi, MemoryStore } from "./localApi";
import { createEvergreenSeed } from "./seed";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
  DEMO_HM_USERNAME,
} from "./seed";
import { DEMO_PASSWORD } from "./types";
import { todayIso } from "./chart";
import { personalQueue } from "./dashboard";
import {
  ageOn,
  applyWellWaterDefault,
  blankSiteReview,
  buildPreSurveyRow,
  isSiteReviewInPlace,
  normalizeSiteFacts,
  siteReviewGaps,
  wellWaterTestCurrent,
} from "./siteReview";
import { emptyProfile } from "./planStack";

function api() {
  return new LocalApi(new MemoryStore(structuredClone(createEvergreenSeed())));
}

test("well-water annual is current for 365 days and ignored when the home is on city water", () => {
  assert.equal(wellWaterTestCurrent("2025-09-12", "2026-09-12"), true);
  assert.equal(wellWaterTestCurrent("2025-09-11", "2026-09-12"), false);
  const review = applyWellWaterDefault(
    blankSiteReview({ agencyId: "a", siteId: "s" }),
    normalizeSiteFacts({ wellWater: false }),
  );
  assert.equal(
    review.lines.find((line) => line.id === "int-well-water")?.status,
    "na",
  );
});

test("Cedar seed review is in place; Willow is still open", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const maple = workspace.sites.find((row) => row.name === "Cedar House")!;
  const oakwood = workspace.sites.find((row) => row.name === "Willow House")!;
  const mapleReview = workspace.siteReviews.find((row) => row.siteId === maple.id);
  const oakwoodReview = workspace.siteReviews.find((row) => row.siteId === oakwood.id);
  assert.equal(isSiteReviewInPlace(mapleReview, maple, todayIso()), true);
  assert.equal(isSiteReviewInPlace(oakwoodReview, oakwood, todayIso()), false);
  assert.ok((oakwoodReview ? siteReviewGaps(oakwoodReview, oakwood, todayIso()) : []).length > 3);
});

test("pre-survey rows pull equipment and chart facts", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(session);
  const ellis = workspace.individuals.find((row) => row.name === "Ellis Hart")!;
  const row = buildPreSurveyRow({
    person: { fullName: ellis.name, dateOfBirth: ellis.dateOfBirth },
    profile: ellis.profile ?? emptyProfile({
      id: ellis.id,
      agencyId: session.agencyId,
      siteId: workspace.sites[0].id,
      fullName: ellis.name,
      dateOfBirth: ellis.dateOfBirth,
    }),
    today: "2026-09-12",
    equipment: workspace.monthly.equipment.filter((item) => item.individualId === ellis.id),
  });
  assert.match(row.equipment, /Wheelchair/);
  assert.equal(row.sex, "F");
  assert.equal(row.medicaid, "Yes");
  assert.ok(Number(ageOn(ellis.dateOfBirth, "2026-09-12")) > 20);
});

test("DPM can save a site review and a DSP cannot", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const workspace = await client.loadWorkspace(admin);
  const oakwood = workspace.sites.find((row) => row.name === "Willow House")!;
  const review = workspace.siteReviews.find((row) => row.siteId === oakwood.id)!;
  await client.saveSiteFacts(oakwood.id, { city: "Columbia", county: "Boone" });
  await client.saveSiteReview({
    id: review.id,
    reviewerName: "James Wilson",
    supportCoordinator: "Jason Briscoe",
    reviewedOn: "2026-09-01",
    providerOwnedControlled: true,
    heightenedScrutiny: false,
    meetsIndividualNeeds: true,
    part2Verified: true,
    lines: review.lines.map((line) => ({
      ...line,
      status: line.id === "int-well-water" ? "na" : "satisfactory",
    })),
  });
  const after = await client.loadWorkspace(admin);
  const saved = after.siteReviews.find((row) => row.siteId === oakwood.id)!;
  assert.equal(isSiteReviewInPlace(saved, oakwood, todayIso()), true);
  const file = await client.downloadPreSurveyPdf(oakwood.id);
  assert.match(file.name, /pre-survey-willow-house/);
  const reviewFile = await client.downloadSiteReviewPdf(oakwood.id);
  assert.match(reviewFile.name, /site-review-willow-house/);

  const dspClient = api();
  await dspClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const dspWorkspace = await dspClient.loadWorkspace(
    (await dspClient.getSession())!,
  );
  const maple = dspWorkspace.sites.find((row) => row.name === "Cedar House")!;
  const mapleReview = dspWorkspace.siteReviews.find((row) => row.siteId === maple.id)!;
  await assert.rejects(
    () =>
      dspClient.saveSiteReview({
        id: mapleReview.id,
        reviewerName: "Alex",
        supportCoordinator: "",
        reviewedOn: "2026-09-01",
        providerOwnedControlled: true,
        heightenedScrutiny: false,
        meetsIndividualNeeds: true,
        part2Verified: true,
        lines: mapleReview.lines,
      }),
    /administrator/,
  );
});

test("new sites start with an open DPM site review", async () => {
  const client = api();
  const session = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const created = await client.createSite({
    name: "Hemlock House",
    address: "9 Hemlock Court",
    programName: "Residential services",
  });
  const workspace = await client.loadWorkspace(session);
  const site = workspace.sites.find((row) => row.id === created.id)!;
  const review = workspace.siteReviews.find((row) => row.siteId === created.id);
  assert.ok(review);
  assert.equal(isSiteReviewInPlace(review, site, todayIso()), false);
});

test("Your work lists an open site review for DPM and house manager, not DSP", async () => {
  const client = api();
  const admin = await client.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_ADMIN_USERNAME,
    password: DEMO_PASSWORD,
  });
  const adminWorkspace = await client.loadWorkspace(admin);
  const adminQueue = personalQueue({
    session: admin,
    items: adminWorkspace.requirements,
    packets: adminWorkspace.packets,
    planStacks: adminWorkspace.planStacks,
    canApprove: true,
    sites: adminWorkspace.sites,
    siteReviews: adminWorkspace.siteReviews,
  });
  assert.ok(
    adminQueue.some(
      (item) =>
        item.kind === "site_review" && item.detail.includes("Willow"),
    ),
  );
  assert.equal(
    adminQueue.some(
      (item) => item.kind === "site_review" && item.detail.includes("Cedar"),
    ),
    false,
  );

  const hmClient = api();
  const hm = await hmClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_HM_USERNAME,
    password: DEMO_PASSWORD,
  });
  const hmWorkspace = await hmClient.loadWorkspace(hm);
  const hmQueue = personalQueue({
    session: hm,
    items: hmWorkspace.requirements,
    packets: hmWorkspace.packets,
    planStacks: hmWorkspace.planStacks,
    canApprove: false,
    sites: hmWorkspace.sites.filter((row) => row.name === "Willow House"),
    siteReviews: hmWorkspace.siteReviews,
  });
  assert.ok(hmQueue.some((item) => item.kind === "site_review"));

  const dspClient = api();
  const dsp = await dspClient.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: DEMO_DSP_USERNAME,
    password: DEMO_PASSWORD,
  });
  const dspWorkspace = await dspClient.loadWorkspace(dsp);
  const dspQueue = personalQueue({
    session: dsp,
    items: dspWorkspace.requirements,
    packets: dspWorkspace.packets,
    planStacks: dspWorkspace.planStacks,
    canApprove: false,
    sites: dspWorkspace.sites,
    siteReviews: dspWorkspace.siteReviews,
  });
  assert.equal(
    dspQueue.some((item) => item.kind === "site_review"),
    false,
  );
});
