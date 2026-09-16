import { test } from "node:test";
import assert from "node:assert/strict";
import {
  demoSiteLocality,
  isPrimaryDemoHouse,
} from "./evergreenSiteAddress";

test("Cedar and Maple share Columbia 65202; Willow and Oakwood share 65203", () => {
  assert.equal(demoSiteLocality("Cedar House").city, "Columbia");
  assert.equal(demoSiteLocality("Cedar House").zip, "65202");
  assert.equal(demoSiteLocality("Cedar House").address, "418 Cedar Court");
  assert.equal(demoSiteLocality("Maple House").zip, "65202");
  assert.equal(demoSiteLocality("Willow House").city, "Columbia");
  assert.equal(demoSiteLocality("Willow House").zip, "65203");
  assert.equal(demoSiteLocality("Willow House").address, "920 Willow Lane");
  assert.equal(demoSiteLocality("Oakwood House").zip, "65203");
});

test("primary demo house is Maple or Cedar, not keyed only off Maple", () => {
  assert.equal(isPrimaryDemoHouse("Maple House"), true);
  assert.equal(isPrimaryDemoHouse("Cedar House"), true);
  assert.equal(isPrimaryDemoHouse("Willow House"), false);
  assert.equal(isPrimaryDemoHouse("Oakwood House"), false);
});
