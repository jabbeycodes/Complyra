import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_SITE_INDIVIDUAL_CAP,
  PRODUCTION_SITE_INDIVIDUAL_CAP,
  assertSiteHasCapacity,
  countIndividualsAtSite,
  siteAtCapacityMessage,
  siteCapacityLabel,
  siteIndividualCap,
} from "./siteCapacity";

test("Evergreen demo caps at 2; any other agency caps at 3", () => {
  assert.equal(siteIndividualCap("EVERGREEN-MO"), DEMO_SITE_INDIVIDUAL_CAP);
  assert.equal(siteIndividualCap("evergreen-mo"), DEMO_SITE_INDIVIDUAL_CAP);
  assert.equal(siteIndividualCap("CEDARRIDGE-MO"), PRODUCTION_SITE_INDIVIDUAL_CAP);
  assert.equal(siteIndividualCap("ACME-TX"), PRODUCTION_SITE_INDIVIDUAL_CAP);
});

test("assertSiteHasCapacity blocks the seat past the cap with a clear error", () => {
  assert.doesNotThrow(() =>
    assertSiteHasCapacity({
      siteName: "Cedar House",
      agencyCode: "EVERGREEN-MO",
      currentCount: 1,
    }),
  );
  assert.throws(
    () =>
      assertSiteHasCapacity({
        siteName: "Cedar House",
        agencyCode: "EVERGREEN-MO",
        currentCount: 2,
      }),
    /This site already has 2 Individuals \(max 2\)/,
  );
  assert.doesNotThrow(() =>
    assertSiteHasCapacity({
      siteName: "North House",
      agencyCode: "ACME-TX",
      currentCount: 2,
    }),
  );
  assert.throws(
    () =>
      assertSiteHasCapacity({
        siteName: "North House",
        agencyCode: "ACME-TX",
        currentCount: 3,
      }),
    /This site already has 3 Individuals \(max 3\)/,
  );
  assert.equal(siteAtCapacityMessage(2, 2), "This site already has 2 Individuals (max 2).");
});

test("countIndividualsAtSite uses site id, not leftover names", () => {
  assert.equal(
    countIndividualsAtSite(
      [
        { siteId: "cedar" },
        { siteId: "cedar" },
        { siteId: "willow" },
        { siteId: null },
      ],
      "cedar",
    ),
    2,
  );
});

test("Sites list capacity copy is n of max Individuals", () => {
  assert.equal(siteCapacityLabel(2, 2), "2 of 2 Individuals");
  assert.equal(siteCapacityLabel(1, 3), "1 of 3 Individuals");
});
