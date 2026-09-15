import { test } from "node:test";
import assert from "node:assert/strict";
import {
  agencyStateCode,
  formatSiteAddressLine,
  siteHeroAddressLine,
  siteLocationFields,
} from "./siteAddress";

test("formats street, city, ST zip and drops empty parts", () => {
  assert.equal(
    formatSiteAddressLine({
      address: "3201 Pompey Drive",
      city: "Columbia",
      stateCode: "mo",
      zip: "65202",
    }),
    "3201 Pompey Drive, Columbia, MO 65202",
  );
  assert.equal(
    formatSiteAddressLine({
      address: "3201 Pompey Drive",
      city: "Columbia",
      stateCode: "MO",
    }),
    "3201 Pompey Drive, Columbia, MO",
  );
  assert.equal(
    formatSiteAddressLine({ address: "3201 Pompey Drive" }),
    "3201 Pompey Drive",
  );
  assert.equal(formatSiteAddressLine({ city: "Columbia", zip: "65202" }), "Columbia, 65202");
});

test("never prints undefined or null placeholders", () => {
  assert.equal(
    formatSiteAddressLine({
      address: "9 Willow Court",
      city: undefined,
      zip: "undefined",
      stateCode: null,
    }),
    "9 Willow Court",
  );
  assert.doesNotMatch(
    formatSiteAddressLine({
      address: undefined,
      city: "undefined",
      zip: null,
    }),
    /undefined/i,
  );
});

test("stutters only when name equals street and there is no city/zip", () => {
  assert.deepEqual(
    siteLocationFields({
      name: "3201 Pompey Drive",
      address: "3201 Pompey Drive",
    }),
    { name: "3201 Pompey Drive" },
  );
  assert.deepEqual(
    siteLocationFields({
      name: "3201 Pompey Drive",
      address: "3201 Pompey Drive",
      city: "Columbia",
      stateCode: "MO",
      zip: "65202",
    }),
    {
      name: "3201 Pompey Drive",
      address: "3201 Pompey Drive, Columbia, MO 65202",
    },
  );
  assert.deepEqual(
    siteLocationFields({
      name: "Maple House",
      address: "3201 Pompey Drive",
      city: "Columbia",
      stateCode: "MO",
      zip: "65202",
    }),
    {
      name: "Maple House",
      address: "3201 Pompey Drive, Columbia, MO 65202",
    },
  );
});

test("hero hides the address line when it would duplicate the title", () => {
  assert.equal(
    siteHeroAddressLine({
      name: "Maple House",
      address: "Maple House",
    }),
    "",
  );
  assert.equal(
    siteHeroAddressLine({
      name: "Maple House",
      address: "3201 Pompey Drive",
      city: "Columbia",
      stateCode: "MO",
      zip: "65202",
    }),
    "3201 Pompey Drive, Columbia, MO 65202",
  );
});

test("agency state comes from the agency record or the provider code suffix", () => {
  assert.equal(agencyStateCode({ stateCode: "mo" }, "EVERGREEN-MO"), "MO");
  assert.equal(agencyStateCode(null, "EVERGREEN-MO"), "MO");
  assert.equal(agencyStateCode(null, "TEST"), "");
});
