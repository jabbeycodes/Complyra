/**
 * Wave 6 item 2 — board/section link targets.
 *
 * Simulation batches 34/35: "Open medication board" on an Individual's
 * chart navigated to the agency Overview (admin, RN and DSP alike): the
 * anchor was a plain `href="#chart-meds"`, and the app router reads any
 * hash as a page key, so the unknown "chart-meds" page fell back to the
 * default landing page. These tests pin, per board action, the section
 * the action must land on and that the click handler cancels the hash
 * navigation and scrolls in-page instead.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CHART_SECTION_IDS,
  chartSectionClickHandler,
  chartSectionId,
  sectionClickHandler,
  type ChartBoardAction,
} from "./sectionLinks";

describe("chart board actions land on their own sections", () => {
  it("pins the target section per board action", () => {
    assert.equal(chartSectionId("medicationBoard"), "chart-meds");
    assert.equal(chartSectionId("appointments"), "chart-appointments");
    assert.equal(chartSectionId("shiftNotes"), "chart-shift-notes");
    assert.deepEqual(CHART_SECTION_IDS, {
      medicationBoard: "chart-meds",
      appointments: "chart-appointments",
      shiftNotes: "chart-shift-notes",
    });
  });

  it("every board action's click cancels navigation and scrolls to its section", () => {
    const actions: ChartBoardAction[] = [
      "medicationBoard",
      "appointments",
      "shiftNotes",
    ];
    for (const action of actions) {
      let prevented = false;
      const scrolled: string[] = [];
      const handler = chartSectionClickHandler(action, (id) => {
        scrolled.push(id);
      });
      handler({
        preventDefault: () => {
          prevented = true;
        },
      });
      assert.equal(prevented, true, `${action}: default hash navigation cancelled`);
      assert.deepEqual(scrolled, [chartSectionId(action)], `${action}: scrolled in-page`);
    }
  });

  it("help table-of-contents targets scroll in-page the same way", () => {
    for (const id of ["help-training", "help-faq", "help-support"]) {
      let prevented = false;
      const scrolled: string[] = [];
      sectionClickHandler(id, (target) => {
        scrolled.push(target);
      })({
        preventDefault: () => {
          prevented = true;
        },
      });
      assert.equal(prevented, true, `${id}: navigation cancelled`);
      assert.deepEqual(scrolled, [id]);
    }
  });
});
