import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Requirement, Status } from "../domain";
import { todayIso } from "./chart";
import {
  ALL_CATEGORIES,
  ALL_PROGRAMS,
  ALL_STATUSES,
  DEFAULT_FILTERS,
  applyDashboardFilters,
  dueInWindow,
  filtersActive,
  programOptions,
  siteProgram,
  type DashboardFilters,
  type DueWindow,
} from "./dashboardFilters";

function isoPlusDays(days: number): string {
  const d = new Date(`${todayIso()}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

let n = 0;
function req(overrides: Partial<Requirement> = {}): Requirement {
  n += 1;
  return {
    id: `r${n}`,
    title: `Requirement ${n}`,
    person: "Site-wide",
    site: "Maple House",
    category: "Emergency drills",
    owner: "Sarah Mitchell",
    role: "HM",
    due: isoPlusDays(3),
    status: "Due soon",
    source: "test",
    page: 1,
    frequency: "Monthly",
    evidence: "test",
    ...overrides,
  };
}

const SITES = [
  { name: "Maple House", program: "Residential services" },
  { name: "Oakwood House", program: "Day services" },
];

const FILTERS: DashboardFilters = { ...DEFAULT_FILTERS };

describe("programOptions", () => {
  it("returns distinct sorted programs from the data, never invented", () => {
    assert.deepEqual(programOptions(SITES), [
      "Day services",
      "Residential services",
    ]);
  });

  it("ignores blank programs and dedupes", () => {
    assert.deepEqual(
      programOptions([
        { name: "A", program: "Residential services" },
        { name: "B", program: "Residential services" },
        { name: "C", program: "  " },
        { name: "D" },
      ]),
      ["Residential services"],
    );
  });
});

describe("siteProgram", () => {
  it("maps a requirement site to its program", () => {
    assert.equal(siteProgram("Oakwood House", SITES), "Day services");
    assert.equal(siteProgram("Unknown", SITES), "");
  });
});

describe("dueInWindow", () => {
  it("matches everything on 'all'", () => {
    assert.ok(dueInWindow(req({ due: isoPlusDays(-40) }), "all"));
  });

  it("overdue only matches strictly past-due items", () => {
    assert.ok(dueInWindow(req({ due: isoPlusDays(-1) }), "overdue"));
    assert.ok(!dueInWindow(req({ due: isoPlusDays(0) }), "overdue"));
    assert.ok(!dueInWindow(req({ due: isoPlusDays(5) }), "overdue"));
  });

  it("due-in-N windows are inclusive of both ends", () => {
    const windows: DueWindow[] = ["7", "14", "30"];
    for (const w of windows) {
      const limit = Number(w);
      assert.ok(dueInWindow(req({ due: isoPlusDays(0) }), w), `${w}: today`);
      assert.ok(
        dueInWindow(req({ due: isoPlusDays(limit) }), w),
        `${w}: day ${limit}`,
      );
      assert.ok(
        !dueInWindow(req({ due: isoPlusDays(limit + 1) }), w),
        `${w}: day ${limit + 1}`,
      );
      assert.ok(!dueInWindow(req({ due: isoPlusDays(-1) }), w), `${w}: overdue`);
    }
  });

  it("excludes requirements without a parseable due date from narrowed windows", () => {
    assert.ok(!dueInWindow(req({ due: "" }), "7"));
    assert.ok(dueInWindow(req({ due: "" }), "all"));
  });
});

describe("filtersActive", () => {
  it("is false for defaults and true when any filter is set", () => {
    assert.equal(filtersActive({ ...FILTERS }), false);
    assert.ok(filtersActive({ ...FILTERS, program: "Day services" }));
    assert.ok(filtersActive({ ...FILTERS, category: "Equipment checks" }));
    assert.ok(filtersActive({ ...FILTERS, status: "Overdue" as Status }));
    assert.ok(filtersActive({ ...FILTERS, due: "7" }));
  });
});

describe("applyDashboardFilters", () => {
  const items = [
    req({
      id: "a",
      site: "Maple House",
      category: "Emergency drills",
      status: "Compliant",
      due: isoPlusDays(60),
    }),
    req({
      id: "b",
      site: "Oakwood House",
      category: "Equipment checks",
      status: "Overdue",
      due: isoPlusDays(-2),
    }),
    req({
      id: "c",
      site: "Maple House",
      category: "Equipment checks",
      status: "Due soon",
      due: isoPlusDays(3),
    }),
  ];

  function run(filters: DashboardFilters, site = "All sites") {
    return applyDashboardFilters(items, { site, sites: SITES, filters }).map(
      (r) => r.id,
    );
  }

  it("returns everything when all filters are default", () => {
    assert.deepEqual(run({ ...FILTERS }), ["a", "b", "c"]);
  });

  it("narrows by program via the requirement's site", () => {
    assert.deepEqual(run({ ...FILTERS, program: "Day services" }), ["b"]);
    assert.deepEqual(run({ ...FILTERS, program: "Residential services" }), [
      "a",
      "c",
    ]);
  });

  it("narrows by category", () => {
    assert.deepEqual(run({ ...FILTERS, category: "Equipment checks" }), [
      "b",
      "c",
    ]);
  });

  it("narrows by status", () => {
    assert.deepEqual(run({ ...FILTERS, status: "Overdue" }), ["b"]);
  });

  it("narrows by due window", () => {
    assert.deepEqual(run({ ...FILTERS, due: "overdue" }), ["b"]);
    assert.deepEqual(run({ ...FILTERS, due: "7" }), ["c"]);
    assert.deepEqual(run({ ...FILTERS, due: "30" }), ["c"]);
  });

  it("combines every dimension with AND", () => {
    assert.deepEqual(
      run({
        program: "Residential services",
        category: "Equipment checks",
        status: "Due soon",
        due: "7",
      }),
      ["c"],
    );
    // Same but the wrong program matches nothing.
    assert.deepEqual(
      run({
        program: "Day services",
        category: "Equipment checks",
        status: "Due soon",
        due: "7",
      }),
      [],
    );
  });

  it("combines with the site selector", () => {
    assert.deepEqual(
      run({ ...FILTERS, category: "Equipment checks" }, "Maple House"),
      ["c"],
    );
    assert.deepEqual(run({ ...FILTERS }, "Oakwood House"), ["b"]);
  });

  it("returns an empty set when nothing matches", () => {
    assert.deepEqual(run({ ...FILTERS, status: "Expired" }), []);
  });

  it("keeps the canonical default labels", () => {
    assert.equal(ALL_PROGRAMS, "All programs");
    assert.equal(ALL_CATEGORIES, "All categories");
    assert.equal(ALL_STATUSES, "All statuses");
    assert.equal(DEFAULT_FILTERS.due, "all");
  });
});
