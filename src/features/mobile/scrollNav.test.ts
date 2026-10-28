import { test } from "node:test";
import assert from "node:assert/strict";
import { createScrollCollapse } from "./scrollNav";

test("starts expanded, and the first reading only anchors", () => {
  const machine = createScrollCollapse();
  assert.equal(machine.collapsed(), false);
  // Landing mid-page (a restored scroll position) must not collapse the
  // nav before the user has scrolled anywhere.
  assert.equal(machine.update(600), false);
  assert.equal(machine.collapsed(), false);
});

test("scrolling down past the dead zone collapses", () => {
  const machine = createScrollCollapse();
  machine.update(0);
  assert.equal(machine.update(200), true);
  assert.equal(machine.collapsed(), true);
});

test("small jitter around a point never flips the state", () => {
  const machine = createScrollCollapse();
  machine.update(200);
  for (const y of [204, 200, 196, 200, 203, 198, 200]) {
    assert.equal(machine.update(y), false, `y=${y}`);
  }
  // And while collapsed, the same jitter must not pop it back open.
  assert.equal(machine.update(400), true);
  for (const y of [404, 400, 397, 400, 402]) {
    assert.equal(machine.update(y), true, `y=${y}`);
  }
});

test("scrolling up past the dead zone restores", () => {
  const machine = createScrollCollapse();
  machine.update(0);
  assert.equal(machine.update(300), true);
  assert.equal(machine.update(280), false);
});

test("near the top the nav is always expanded", () => {
  const machine = createScrollCollapse();
  machine.update(0);
  assert.equal(machine.update(500), true);
  assert.equal(machine.update(20), false);
  // Even a downward move that stays inside the top zone cannot collapse.
  assert.equal(machine.update(48), false);
});

test("restore (remnant tap) expands and re-anchors at the tap point", () => {
  const machine = createScrollCollapse();
  machine.update(0);
  assert.equal(machine.update(500), true);
  assert.equal(machine.restore(500), false);
  // A few more px down is inside the dead zone from the tap point…
  assert.equal(machine.update(506), false);
  // …but a full dead-zone of downward travel collapses it again.
  assert.equal(machine.update(512), true);
});

test("negative positions (scroll bounce) are clamped to the top", () => {
  const machine = createScrollCollapse();
  machine.update(300);
  assert.equal(machine.update(600), true);
  assert.equal(machine.update(-40), false);
});

test("custom dead zone and top zone are honored", () => {
  const machine = createScrollCollapse({ deadZone: 30, topZone: 100 });
  machine.update(0);
  assert.equal(machine.update(90), false); // inside the top zone
  // 25px of travel from the anchor: the default 10px zone would have
  // collapsed by now; the custom 30px zone has not.
  assert.equal(machine.update(115), false);
  // 35px from the anchor crosses the custom zone.
  assert.equal(machine.update(125), true);
});
