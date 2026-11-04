/**
 * Wave 6 item 6 pins: demo framing keys off the demo workspace only,
 * and the Overview site filter defaults to the viewer's scope.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultOverviewSiteFilter,
  isDemoSession,
  overviewSnapshotLabel,
} from "./overviewScope";

test("the sample snapshot label renders ONLY for the demo workspace", () => {
  assert.equal(isDemoSession({ agencyCode: "EVERGREEN-MO" }), true);
  assert.equal(overviewSnapshotLabel({ agencyCode: "EVERGREEN-MO" }), "Sample agency snapshot");
  // A real agency (the simulation's Northstar) gets no demo wording.
  assert.equal(isDemoSession({ agencyCode: "NORTHSTAR2-MO" }), false);
  assert.equal(overviewSnapshotLabel({ agencyCode: "NORTHSTAR2-MO" }), null);
  assert.equal(overviewSnapshotLabel({ agencyCode: null }), null);
  assert.equal(overviewSnapshotLabel({}), null);
});

test("the site filter defaults to the viewer's single home", () => {
  assert.equal(defaultOverviewSiteFilter(["Willow House"]), "Willow House");
  assert.equal(defaultOverviewSiteFilter(["Maple House", "Juniper House"]), "All sites");
  assert.equal(defaultOverviewSiteFilter([]), "All sites");
});
