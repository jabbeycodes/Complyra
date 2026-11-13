// @vitest-environment jsdom
/**
 * KioskClockPage.spec.tsx — component tests for the kiosk time clock.
 *
 * Named *.spec.tsx (not *.test.tsx) on purpose: the repo's `npm test`
 * runner globs only *.test.tsx and executes them with node:test, which
 * cannot run vitest-style suites. Vitest picks up *.spec.* by default, so
 * `npx vitest run src/features/kiosk/` runs these while `npm test` is
 * unaffected.
 *
 * The kiosk store is injected via setKioskClient (mocked per test); the
 * offline-queue test installs a small in-memory IndexedDB fake (no new
 * deps) because jsdom ships without IndexedDB. Photo capture was cut
 * from the kiosk entirely, so there are no camera mocks here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import KioskClockPage from "./KioskClockPage";
import { setKioskClient, type KioskPunchInput } from "./kioskClient";
import { listQueued } from "./kioskQueue";

// Vitest doesn't provide globals by default, so register RTL cleanup manually.
afterEach(() => cleanup());

/* --------------------- in-memory IndexedDB fake ---------------------- */

function installFakeIndexedDB() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const clone = (v: unknown) => JSON.parse(JSON.stringify(v));
  class FakeRequest {
    result: unknown = undefined;
    error: unknown = null;
    onsuccess: ((e: unknown) => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    onupgradeneeded: ((e: unknown) => void) | null = null;
  }
  class FakeObjectStore {
    constructor(private map: Map<string, Record<string, unknown>>) {}
    private asyncOp(run: (req: FakeRequest) => void) {
      const req = new FakeRequest();
      queueMicrotask(() => {
        try {
          run(req);
          req.onsuccess?.({ target: req });
        } catch (err) {
          req.error = err;
          req.onerror?.({ target: req });
        }
      });
      return req;
    }
    put(value: Record<string, unknown>) {
      return this.asyncOp((req) => {
        this.map.set(value.id as string, clone(value));
        req.result = value.id;
      });
    }
    get(key: string) {
      return this.asyncOp((req) => {
        const found = this.map.get(key);
        req.result = found === undefined ? undefined : clone(found);
      });
    }
    getAll() {
      return this.asyncOp((req) => {
        req.result = [...this.map.values()].map(clone);
      });
    }
    delete(key: string) {
      return this.asyncOp((req) => {
        this.map.delete(key);
        req.result = undefined;
      });
    }
  }
  class FakeDB {
    objectStoreNames = { contains: (name: string) => stores.has(name) };
    createObjectStore(name: string) {
      stores.set(name, new Map());
    }
    transaction(storeName: string) {
      const tx = {
        oncomplete: null as ((e: unknown) => void) | null,
        onerror: null as ((e: unknown) => void) | null,
        error: null,
        objectStore: () => {
          const map = stores.get(storeName);
          if (!map) throw new Error(`no store ${storeName}`);
          return new FakeObjectStore(map);
        },
      };
      return tx;
    }
    close() {}
  }
  (globalThis as Record<string, unknown>).indexedDB = {
    open: () => {
      const req = new FakeRequest();
      queueMicrotask(() => {
        const db = new FakeDB();
        (req as { result: unknown }).result = db;
        if (!stores.has("punches")) req.onupgradeneeded?.({ target: req });
        req.onsuccess?.({ target: req });
      });
      return req;
    },
  };
}

/* --------------------------- client mock ----------------------------- */

const SITE = { siteId: "site-1", siteName: "Maple House", agencyId: "agency-1" };

function makeClient(overrides: Record<string, unknown> = {}) {
  const submitted: Array<{ token: string; input: KioskPunchInput }> = [];
  let failSubmit = false;
  const client = {
    resolveKioskToken: async () => ({ ...SITE }),
    verifyKioskPin: async () => ({ ok: true, staffId: "staff-1", displayName: "Test Staffer" }),
    suggestKioskShift: async () => ({
      shiftLabel: "Day 7a–3p",
      serviceType: "ISL Support",
      individualId: "ind-1",
      individualName: "Sample Individual",
    }),
    fetchKioskStatus: async () => ({
      clockedIn: false,
      sinceIso: null,
      scheduledShiftLabel: "Day 7a–3p",
      onBreak: false,
      breakSinceIso: null,
    }),
    fetchKioskIndividuals: async () => [{ id: "ind-1", name: "Sample Individual" }],
    submitKioskPunch: async (token: string, input: KioskPunchInput) => {
      if (failSubmit) throw new Error("network down");
      submitted.push({ token, input });
      return { ok: true };
    },
    ...overrides,
  };
  return {
    client,
    submitted,
    setFailSubmit: (v: boolean) => {
      failSubmit = v;
    },
  };
}

function pressDigits(digits: string) {
  for (const d of digits) {
    fireEvent.click(screen.getByRole("button", { name: d }));
  }
}

/** Walk the ID + PIN steps; lands on the action screen. */
async function loginThroughPin(pinDigits = "1234") {
  await screen.findByLabelText("Employee ID");
  pressDigits("4321");
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
  await screen.findByText("Enter your PIN");
  pressDigits(pinDigits);
  fireEvent.click(screen.getByRole("button", { name: "Verify PIN" }));
  await screen.findByText("Hi, Test Staffer");
}

beforeEach(() => {
  delete (globalThis as Record<string, unknown>).indexedDB;
});

/* ------------------------------- tests ------------------------------- */

describe("KioskClockPage", () => {
  it("shows the house name for a valid token", async () => {
    const { client } = makeClient();
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    expect(await screen.findByRole("heading", { name: "Maple House" })).toBeTruthy();
  });

  it("shows a friendly error for an invalid token", async () => {
    const { client } = makeClient({
      resolveKioskToken: async () => {
        throw new Error("bad token");
      },
    });
    setKioskClient(client as never);
    render(<KioskClockPage token="bad-token" />);
    expect(await screen.findByText(/This kiosk link isn’t valid/)).toBeTruthy();
  });

  it("walks ID → PIN → clock-in to a confirmation", async () => {
    const { client, submitted } = makeClient();
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    await loginThroughPin();

    fireEvent.click(screen.getByRole("button", { name: "CLOCK IN" }));
    // Suggested shift, one-tap confirm — CONFIRM submits the punch directly.
    expect(await screen.findByText("Day 7a–3p")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM" }));

    // Confirmation: checkmark, name, kind.
    expect(await screen.findByText("Clocked in")).toBeTruthy();
    expect(screen.getByText("Test Staffer")).toBeTruthy();
    expect(submitted).toHaveLength(1);
    expect(submitted[0].token).toBe("good-token");
    expect(submitted[0].input.kind).toBe("in");
    // Verification is stamped server-side — the client sends no method.
    expect("verificationMethod" in submitted[0].input).toBe(false);
    expect(submitted[0].input.serviceType).toBe("ISL Support");
    expect(submitted[0].input.individualId).toBe("ind-1");
    expect(submitted[0].input.offline).toBe(false);
    // No photo anywhere in the payload.
    expect("photoDataUrl" in submitted[0].input).toBe(false);
  });

  it("shows the attempts-left warning on a bad PIN", async () => {
    const { client } = makeClient({
      verifyKioskPin: async () => ({ ok: false, reason: "bad_pin", attemptsLeft: 2 }),
    });
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    await screen.findByLabelText("Employee ID");
    pressDigits("4321");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Enter your PIN");
    pressDigits("9999");
    fireEvent.click(screen.getByRole("button", { name: "Verify PIN" }));
    expect(await screen.findByText(/Incorrect PIN\. 2 tries left before lockout\./)).toBeTruthy();
  });

  it("shows a lockout countdown when the PIN is locked", async () => {
    const lockedUntil = new Date(Date.now() + 125_000).toISOString();
    const { client } = makeClient({
      verifyKioskPin: async () => ({ ok: false, reason: "locked", lockedUntil }),
    });
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    await screen.findByLabelText("Employee ID");
    pressDigits("4321");
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByText("Enter your PIN");
    pressDigits("9999");
    fireEvent.click(screen.getByRole("button", { name: "Verify PIN" }));
    expect(await screen.findByText("Locked")).toBeTruthy();
    expect(await screen.findByText(/Try again in 2:0/)).toBeTruthy();
  });

  it("asks the meal-break attestation on clock-out and records the answer", async () => {
    const { client, submitted } = makeClient({
      fetchKioskStatus: async () => ({
        clockedIn: true,
        sinceIso: "2026-09-16T12:00:00.000Z",
        scheduledShiftLabel: "Day 7a–3p",
        onBreak: false,
        breakSinceIso: null,
      }),
    });
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    await loginThroughPin();

    expect(screen.getByText(/Clocked in since/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "CLOCK OUT" }));
    expect(
      await screen.findByText("Did you take your 30-minute meal break?"),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "YES" }));

    expect(await screen.findByText("Clocked out")).toBeTruthy();
    expect(submitted).toHaveLength(1);
    expect(submitted[0].token).toBe("good-token");
    expect(submitted[0].input.kind).toBe("out");
    expect("verificationMethod" in submitted[0].input).toBe(false);
    expect(
      (JSON.parse(submitted[0].input.attestation as string) as { meal_break_taken: boolean })
        .meal_break_taken,
    ).toBe(true);
  });

  it("records a break punch straight from the action screen", async () => {
    const { client, submitted } = makeClient({
      fetchKioskStatus: async () => ({
        clockedIn: true,
        sinceIso: "2026-09-16T12:00:00.000Z",
        scheduledShiftLabel: "Day 7a–3p",
        onBreak: false,
        breakSinceIso: null,
      }),
    });
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    await loginThroughPin();

    fireEvent.click(screen.getByRole("button", { name: "BREAK" }));
    expect(await screen.findByText("Break started")).toBeTruthy();
    expect(submitted).toHaveLength(1);
    expect(submitted[0].token).toBe("good-token");
    expect(submitted[0].input.kind).toBe("break_in");
    expect("verificationMethod" in submitted[0].input).toBe(false);
    expect(submitted[0].input.serviceType).toBeNull();
    expect(submitted[0].input.individualId).toBeNull();
    expect("photoDataUrl" in submitted[0].input).toBe(false);
  });

  it("queues the punch offline and syncs it when the connection returns", async () => {
    installFakeIndexedDB();
    const { client, submitted, setFailSubmit } = makeClient();
    setFailSubmit(true);
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    await loginThroughPin();

    fireEvent.click(screen.getByRole("button", { name: "CLOCK IN" }));
    expect(await screen.findByText("Day 7a–3p")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM" }));

    // Punch went through the offline queue, not the failed submit.
    expect(await screen.findByText("Clocked in")).toBeTruthy();
    expect(screen.getByText(/Saved on this kiosk/)).toBeTruthy();
    expect(submitted).toHaveLength(0);
    const queued = await listQueued();
    expect(queued).toHaveLength(1);
    expect(queued[0].token).toBe("good-token");
    expect(queued[0].input.offline).toBe(true);
    expect(queued[0].input.kind).toBe("in");
    expect("verificationMethod" in queued[0].input).toBe(false);

    // Connection returns: the `online` event flushes the queue.
    setFailSubmit(false);
    window.dispatchEvent(new Event("online"));
    await waitFor(async () => {
      expect(await listQueued()).toHaveLength(0);
    });
    expect(submitted).toHaveLength(1);
    expect(submitted[0].token).toBe("good-token");
    expect(submitted[0].input.offline).toBe(true);
  });

  it("lets the employee pick service details when no shift is suggested", async () => {
    const { client, submitted } = makeClient({
      suggestKioskShift: async () => null,
    });
    setKioskClient(client as never);
    render(<KioskClockPage token="good-token" />);
    await loginThroughPin();

    fireEvent.click(screen.getByRole("button", { name: "CLOCK IN" }));
    expect(await screen.findByText(/No scheduled shift found/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Service type"), {
      target: { value: "Community Networking" },
    });
    fireEvent.change(screen.getByLabelText("Individual served"), {
      target: { value: "ind-1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "CONFIRM" }));
    expect(await screen.findByText("Clocked in")).toBeTruthy();
    expect(submitted[0].token).toBe("good-token");
    expect(submitted[0].input.serviceType).toBe("Community Networking");
    expect(submitted[0].input.individualId).toBe("ind-1");
  });
});
