import { test } from "node:test";
import assert from "node:assert/strict";
import { isNativeApp, nativePlatform } from "./native";

test("the website is not treated as a native store app", () => {
  assert.equal(isNativeApp(), false);
  assert.equal(nativePlatform(), "web");
});
