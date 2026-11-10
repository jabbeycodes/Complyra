import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { todayIso, type Medication, type MedicationDelivery } from "../../data/chart";
import {
  boardSupplyText,
  countEntryPrefill,
  expectedCountNow,
  medOnHand,
  medSupplyDisplayState,
  onHandHeadline,
  projectMedInventory,
  scheduledRateOutlook,
  supplyAlertDetail,
} from "../../data/medInventory";
import { medCountdown } from "../mobile/medcount";
import type { MedDoseMark, MedInventoryView, SessionUser } from "../../data/types";

/**
 * Wave 4C (simulation retest batch 311, Northstar): the same med card
 * showed two different "remaining" figures — the on-hand countdown
 * (newest recorded count minus doses recorded Given since) as the
 * headline and the time-based projection (recorded count minus the
 * scheduled burn since the count) as a "Projection" line — and the
 * board's count-entry box was prefilled from the projection-like stored
 * row. The chart MAR showed no figure at all.
 *
 * The retest's exact meds, recorded five days ago:
 *   Alex Simulamine   30 recorded, 1/day  → projection 25
 *   Bailey Expirocin  10 recorded, 1/day  → projection 5
 *   Dana Testoprofen  28 recorded, 2/day  → projection 18
 * Every surface (board headline + days left, forecast, count-entry
 * prefill, chart MAR, mobile MAR, the API's expected count) must render
 * the countdown figure; the projection may never appear as a count.
 */

function isoDaysAgo(today: string, days: number): string {
  const [y, m, d] = today.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d - days)).toISOString().slice(0, 10);
}

const TODAY = todayIso();
const COUNTED_ON = isoDaysAgo(TODAY, 5);
const DAY1 = isoDaysAgo(TODAY, 4);
const DAY2 = isoDaysAgo(TODAY, 3);
const DAY3 = isoDaysAgo(TODAY, 2);

interface Fixture {
  key: string;
  name: string;
  recorded: number;
  perDay: number;
  doseTimes: string[];
  projection: number;
  /** Given marks (dose date + time) recorded since the count. */
  given: Array<[string, string]>;
  /** Non-burning marks — missed / LOA must not move the count. */
  other: Array<[string, string, MedDoseMark["status"]]>;
  /** The countdown figure with `given` burned. */
  countdown: number;
  daysLeft: number;
}

// Partially-Given administrations: the two engines diverge.
const PARTIAL: Fixture[] = [
  {
    key: "alex",
    name: "Simulamine",
    recorded: 30,
    perDay: 1,
    doseTimes: ["08:00"],
    projection: 25,
    given: [[DAY1, "08:00"], [DAY2, "08:00"]],
    other: [[DAY3, "08:00", "missed"]],
    countdown: 28,
    daysLeft: 28,
  },
  {
    key: "bailey",
    name: "Expirocin",
    recorded: 10,
    perDay: 1,
    doseTimes: ["08:00"],
    projection: 5,
    given: [[DAY1, "08:00"]],
    other: [[DAY2, "08:00", "loa"]],
    countdown: 9,
    daysLeft: 9,
  },
  {
    key: "dana",
    name: "Testoprofen",
    recorded: 28,
    perDay: 2,
    doseTimes: ["08:00", "20:00"],
    projection: 18,
    given: [[DAY1, "08:00"], [DAY1, "20:00"], [DAY2, "08:00"]],
    other: [[DAY2, "20:00", "missed"]],
    countdown: 25,
    daysLeft: 12,
  },
];

// The retest as observed: no Given marks charted since the count, so the
// countdown equals the recorded count (30 / 10 / 28; board 30 / 10 / 14
// days) while the projection said 25 / 5 / 18.
const NONE_GIVEN: Fixture[] = PARTIAL.map((f) => ({
  ...f,
  given: [],
  other: [],
  countdown: f.recorded,
  daysLeft: Math.floor(f.recorded / f.perDay),
}));

function viewFor(f: Fixture): MedInventoryView {
  const med: Medication = {
    id: `med-${f.key}`,
    agencyId: "a",
    individualId: `ind-${f.key}`,
    name: f.name,
    strength: "10 mg tablet",
    kind: "scheduled",
    controlled: false,
    pillsPerDay: f.perDay,
    // The stored row decays on the scheduled rate (local backend) — the
    // projection-like figure the count box used to be seeded from.
    remainingPills: f.projection,
    lastDeliveryOn: COUNTED_ON,
    lastCountdownOn: TODAY,
  };
  const delivery: MedicationDelivery = {
    id: `del-${f.key}`,
    medicationId: med.id,
    countedOn: COUNTED_ON,
    countedAt: `${COUNTED_ON}T15:00:00.000Z`,
    remainingPills: f.recorded,
    pillsPerDay: f.perDay,
    recordedBy: "u-hm",
    recordedByName: "Hollis Manager",
  };
  const view = projectMedInventory({
    med,
    inventory: null,
    deliveries: [delivery],
    prnDoses: [],
    doseExceptions: [],
    today: TODAY,
  });
  return { ...view, doseTimes: f.doseTimes };
}

function marksFor(f: Fixture): MedDoseMark[] {
  const rows: Array<[string, string, MedDoseMark["status"]]> = [
    ...f.given.map(([d, t]) => [d, t, "given"] as [string, string, MedDoseMark["status"]]),
    ...f.other,
  ];
  return rows.map(([doseDate, doseTime, status], i) => ({
    id: `mark-${f.key}-${i}`,
    agencyId: "a",
    individualId: `ind-${f.key}`,
    medicationId: `med-${f.key}`,
    doseDate,
    doseTime,
    status,
    markedBy: "u-dsp",
    markedByName: "Dee Staff",
    markedAt: `${doseDate}T14:00:00.000Z`,
  }));
}

const pillsText = (n: number) => `On hand: ${n} ${n === 1 ? "pill" : "pills"}`;

describe("one med-count figure on every surface (data layer)", () => {
  for (const [label, fixtures] of [
    ["partially Given", PARTIAL],
    ["no Given since the count (retest as observed)", NONE_GIVEN],
  ] as const) {
    for (const f of fixtures) {
      it(`${f.name} (${label}): board, forecast, prefill, MARs and the API expectation agree on ${f.countdown}`, () => {
        const view = viewFor(f);
        const marks = marksFor(f);
        // Precondition: the engines really diverge — the projection is the
        // retest's figure and differs from the countdown.
        assert.equal(view.currentCount, f.projection, "time-based projection");
        assert.notEqual(view.currentCount, f.countdown);

        const onHand = medOnHand(view, marks, TODAY);
        assert.equal(onHand.kind, "counted");
        if (onHand.kind !== "counted") return;
        assert.equal(onHand.pillsLeft, f.countdown, "medOnHand");
        assert.equal(onHand.daysLeft, f.daysLeft, "days left derive from the countdown");

        // Mobile MAR (medCountdown is its engine).
        const mobile = medCountdown(view, marks, TODAY);
        assert.equal(mobile.pillsLeft, f.countdown, "mobile MAR");
        assert.ok(mobile.label.startsWith(`${f.countdown} pills left`), mobile.label);

        // API count-variance expectation (recordMedDelivery checks against it).
        assert.equal(expectedCountNow(view, marks, TODAY), f.countdown, "expected count");

        // Count-entry prefill is the same figure.
        assert.equal(countEntryPrefill(onHand), f.countdown, "prefill");

        // Board line: headline + rate + days left, all from the countdown.
        const board = boardSupplyText(
          medSupplyDisplayState(view, "ready"),
          onHand,
          "scheduled",
          view.dosesPerDay,
        );
        assert.equal(
          board,
          `${pillsText(f.countdown)} · ${f.perDay} per day · ${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"} left`,
        );

        // Forecast headline.
        assert.equal(onHandHeadline(onHand), pillsText(f.countdown));

        // The only rate-based line is future-framed and carries no count.
        const outlook = scheduledRateOutlook(onHand, view.dosesPerDay, TODAY)!;
        assert.match(outlook, /^At the scheduled rate \(\d+ per day\), this supply runs out around /);
        assert.doesNotMatch(outlook, /pills?\b/);
      });
    }
  }

  it("never substitutes the recorded count or the projection when the figure cannot be computed", () => {
    const f = PARTIAL[0];
    const view = viewFor(f);
    const loading = medOnHand(view, null, TODAY, "loading");
    const failed = medOnHand(view, null, TODAY, "failed");
    assert.equal(loading.kind, "loading");
    assert.equal(failed.kind, "unavailable");
    for (const state of [loading, failed]) {
      assert.equal(countEntryPrefill(state), null, "no prefill without a figure");
      assert.equal(scheduledRateOutlook(state, 1, TODAY), null);
      const text = boardSupplyText(medSupplyDisplayState(view, "ready"), state, "scheduled", 1);
      assert.doesNotMatch(text, /\b(30|25)\b/, text);
    }
    assert.equal(onHandHeadline(failed), "On-hand count unavailable");

    const neverCounted = medOnHand({ ...view, lastCountedOn: null }, [], TODAY);
    assert.equal(neverCounted.kind, "never-counted");
    assert.equal(onHandHeadline(neverCounted), "No count recorded yet");
    assert.equal(countEntryPrefill(neverCounted), null);
  });

  it("supply-tally alert rows name the labeled recorded count, never 'Projected: N'", () => {
    const view = viewFor(PARTIAL[2]);
    const detail = supplyAlertDetail(view);
    assert.match(detail, /^Recorded count: 28 pills · counted /);
    assert.doesNotMatch(detail, /Projected|\b18\b/);
    assert.equal(supplyAlertDetail({ ...view, lastCountedOn: null }), "No count recorded yet");
  });

  it("PRN meds keep their netted count (dose logs) as the figure, no rate line", () => {
    const view: MedInventoryView = {
      ...viewFor(PARTIAL[0]),
      kind: "prn",
      dosesPerDay: 0,
      currentCount: 27,
    };
    const onHand = medOnHand(view, null, TODAY);
    assert.equal(onHand.kind, "counted");
    assert.equal(onHandHeadline(onHand), pillsText(27));
    assert.equal(
      boardSupplyText(medSupplyDisplayState(view, "ready"), onHand, "prn", 0),
      `${pillsText(27)} · PRN, no automatic drop`,
    );
    assert.equal(scheduledRateOutlook(onHand, 0, TODAY), null);
  });
});

describe("one med-count figure on every surface (rendered)", () => {
  let dom: JSDOM;
  let React: typeof import("react");
  let createRoot: typeof import("react-dom/client").createRoot;
  let DataContext: typeof import("../../data/DataProvider").DataContext;
  let MedInventoryCard: typeof import("./MedInventoryCard").default;
  let MarCard: typeof import("../MarCard").default;
  let DeliveryForm: typeof import("../IndividualChart").DeliveryForm;

  before(async () => {
    dom = new JSDOM("<!doctype html><html><body></body></html>", {
      pretendToBeVisual: true,
    });
    const setGlobal = (name: string, value: unknown) => {
      Object.defineProperty(globalThis, name, {
        value,
        configurable: true,
        writable: true,
      });
    };
    setGlobal("window", dom.window);
    setGlobal("document", dom.window.document);
    setGlobal("navigator", dom.window.navigator);
    setGlobal("HTMLElement", dom.window.HTMLElement);
    setGlobal("HTMLCanvasElement", dom.window.HTMLCanvasElement);
    setGlobal("Element", dom.window.Element);
    setGlobal("Node", dom.window.Node);
    setGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    React = await import("react");
    ({ createRoot } = await import("react-dom/client"));
    ({ DataContext } = await import("../../data/DataProvider"));
    MedInventoryCard = (await import("./MedInventoryCard")).default;
    MarCard = (await import("../MarCard")).default;
    ({ DeliveryForm } = await import("../IndividualChart"));
  });

  after(() => {
    dom.window.close();
  });

  const session = {
    userId: "u-hm",
    agencyId: "a",
    roleKey: "house_manager",
    name: "Hollis Manager",
  } as unknown as SessionUser;

  /** A stub API serving one med's view and marks; anything else is empty. */
  function stubApi(view: MedInventoryView, marks: MedDoseMark[], opts: { rangeFails?: boolean } = {}) {
    const known: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      getMedInventory: async () => [view],
      getMedDoseMarks: async (_id: unknown, day: unknown) =>
        marks.filter((m) => m.doseDate === day),
      getMedDoseMarksInRange: async () => {
        if (opts.rangeFails) throw new Error("network down");
        return marks;
      },
      getStaffTrainingProfile: async () => ({ clearedForInRatio: true }),
    };
    return new Proxy(known, {
      get: (target, prop: string) => target[prop] ?? (async () => []),
    }) as unknown as import("../../data/localApi").ComplyraApi;
  }

  async function mount(element: import("react").ReactElement, api: unknown) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => {
      root.render(
        React.createElement(
          DataContext.Provider,
          {
            value: {
              api,
              session,
              workspace: null,
              loading: false,
              loadStalled: false,
              error: "",
              usingHostedBackend: false,
              signIn: async () => {},
              changePassword: async () => {},
              signOut: async () => {},
              refresh: async () => {},
            } as never,
          },
          element,
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 60));
    });
    return { container, root };
  }

  for (const f of PARTIAL) {
    it(`forecast card headlines ${f.name}'s countdown (${f.countdown}) and never the projection (${f.projection})`, async () => {
      const view = viewFor(f);
      const { container, root } = await mount(
        React.createElement(MedInventoryCard, { individualId: view.individualId }),
        stubApi(view, marksFor(f)),
      );
      const text = container.textContent ?? "";
      assert.ok(text.includes(pillsText(f.countdown)), text);
      assert.ok(text.includes(`${f.daysLeft} ${f.daysLeft === 1 ? "day" : "days"} left`), text);
      assert.ok(text.includes(`Recorded count: ${f.recorded} pills`), "labeled recorded count kept");
      assert.ok(!text.includes("Projection"), "no competing Projection line");
      assert.ok(!text.includes(`${f.projection} pills`), `projection figure ${f.projection} leaked: ${text}`);
      assert.ok(text.includes("At the scheduled rate"), "future-framed outlook present");
      await React.act(async () => root.unmount());
      container.remove();
    });

    it(`chart MAR shows ${f.name}'s countdown (${f.countdown}) — the figure the phone MAR shows`, async () => {
      const view = viewFor(f);
      const marks = marksFor(f);
      const { container, root } = await mount(
        React.createElement(MarCard, { individualId: view.individualId }),
        stubApi(view, marks),
      );
      const supply = container.querySelector('[aria-label="Pills on hand"]');
      assert.ok(supply, "chart MAR renders an on-hand list");
      const text = supply!.textContent ?? "";
      const mobile = medCountdown(view, marks, TODAY);
      assert.equal(mobile.pillsLeft, f.countdown);
      assert.ok(text.includes(pillsText(f.countdown)), text);
      assert.ok(!text.includes(`${f.projection} pills`), text);
      await React.act(async () => root.unmount());
      container.remove();
    });
  }

  it("forecast card and chart MAR name the figure unavailable when dose records fail — no raw count", async () => {
    const f = PARTIAL[0];
    const view = viewFor(f);
    for (const element of [
      React.createElement(MedInventoryCard, { individualId: view.individualId }),
      React.createElement(MarCard, { individualId: view.individualId }),
    ]) {
      const { container, root } = await mount(element, stubApi(view, marksFor(f), { rangeFails: true }));
      const text = container.textContent ?? "";
      assert.ok(text.includes("On-hand count unavailable"), text);
      assert.ok(!text.includes("On hand: 30"), "recorded count never stands in as on hand");
      assert.ok(!text.includes("On hand: 25"), "projection never stands in as on hand");
      await React.act(async () => root.unmount());
      container.remove();
    }
  });

  it("count-entry box is prefilled with the on-hand figure and follows it once it loads", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const render = async (prefill: number | null) => {
      await React.act(async () => {
        root.render(
          React.createElement(DeliveryForm, {
            defaultRemaining: prefill,
            defaultPerDay: 2,
            scheduled: true,
            expectedPills: prefill,
            onSave: () => {},
          }),
        );
      });
    };
    const box = () => container.querySelector('input[type="number"]') as HTMLInputElement;
    const submit = () => container.querySelector('button[type="submit"]') as HTMLButtonElement;

    // Before the countdown loads: an empty box that cannot record a zero.
    await render(null);
    assert.equal(box().value, "");
    assert.equal(submit().disabled, true, "an empty box cannot submit a zero count");

    // Dana's countdown arrives: 25, not the stored row's 18.
    await render(25);
    assert.equal(box().value, "25");
    assert.ok((container.textContent ?? "").includes("Expected on hand: 25 pills"));
    assert.equal(submit().disabled, false);

    // A mark lands and the figure reloads: the untouched box follows it.
    await render(24);
    assert.equal(box().value, "24");

    await React.act(async () => root.unmount());
    container.remove();
  });
});
