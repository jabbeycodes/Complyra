// @vitest-environment jsdom
/**
 * OpenShiftsTab.spec.tsx — interactive flow for the Open Shifts tab using the
 * local demo store: an HM posts a shift, a DSP sees it and picks it up.
 * Run with `npx vitest run src/features/employeeHub/OpenShiftsTab.spec.tsx`.
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OpenShiftsTab } from "./OpenShiftsTab";
import { LocalOpenShiftStore } from "../../data/openShiftStore";
import type { SessionUser } from "../../data/types";

// Slice 11b: the tab now mounts @ui-sdk popups (AppSelect) — jsdom lacks
// the WAAPI/popover surface the SDK calls, so stub it (slice-8 harness rule).
const elProto = Element.prototype as unknown as Record<string, unknown>;
if (typeof elProto.getAnimations !== "function") elProto.getAnimations = () => [];
const htmlProto = HTMLElement.prototype as unknown as Record<string, unknown>;
if (typeof htmlProto.showPopover !== "function") htmlProto.showPopover = function () {};
if (typeof htmlProto.hidePopover !== "function") htmlProto.hidePopover = function () {};
if (typeof elProto.scrollIntoView !== "function") elProto.scrollIntoView = function () {};
if (typeof window !== "undefined" && typeof window.matchMedia !== "function") {  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
// jsdom has no CSS.escape; the SDK's label resolution calls it.
const cssGlobal = (globalThis as unknown as { CSS?: { escape?: (v: string) => string } }).CSS;
if (!cssGlobal || typeof cssGlobal.escape !== "function") {
  (globalThis as unknown as { CSS: { escape: (v: string) => string } }).CSS = {
    escape: (v: string) => v.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
  };
}

afterEach(() => cleanup());

function session(overrides: Partial<SessionUser>): SessionUser {
  return {
    userId: "hm",
    email: "hm@example.invalid",
    username: "hm",
    fullName: "Dana HM",
    jobTitle: "House Manager",
    role: "manager",
    roleKey: "house_manager",
    agencyId: "spec-agency",
    agencyName: "Spec Agency",
    agencyCode: "SPEC-MO",
    siteId: "lawton",
    mustChangePassword: false,
    expiresOn: null,
    permissions: { "hub.access": true, "hub.manage_schedule": true },
    platformAdmin: false,
    agencyStatus: "active",
    ...overrides,
  };
}

const sites = [
  { id: "lawton", name: "Lawton" },
  { id: "cedar", name: "Cedar" },
];

describe("Open Shifts tab", () => {
  it("an HM posts a shift and a DSP picks it up", async () => {
    const hmStore = new LocalOpenShiftStore({
      agencyId: "spec-agency", userId: "hm", fullName: "Dana HM", canManageSchedule: true, canPostAgencyWide: false,
    });
    const hm = render(
      <OpenShiftsTab session={session({})} store={hmStore} sites={sites} canPostSite canPostAgency={false} />,
    );

    expect(screen.getByText(/anything past 41 hours needs/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Evening 2:30p–10:30p" }));
    // The Evening preset's times are the form's initial values, so the chip
    // is already active; since slice 9 (ToggleGroup) clicking the active
    // chip no longer re-fires the handler that autofilled the name — a
    // pre-existing spec failure on pristine main, unrelated to slice 11b.
    // Type the name explicitly, as a user would.
    fireEvent.change(screen.getByLabelText(/^Name/), { target: { value: "Evening 2:30p–10:30p" } });
    // Slice 11b: "How it's filled" is an AppSelect (ui-sdk listbox) — open
    // it and pick the option instead of fireEvent.change on a native select.
    fireEvent.click(screen.getByRole("combobox", { name: /How it/ }));
    fireEvent.click(await screen.findByRole("option", { name: "First come, first served" }));
    fireEvent.click(screen.getByRole("button", { name: /Post shift/ }));

    await waitFor(() => expect(screen.getByText(/Staff trained at Lawton were notified/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/0 of 1 filled/)).toBeTruthy());
    hm.unmount();

    const dspStore = new LocalOpenShiftStore({
      agencyId: "spec-agency", userId: "dsp1", fullName: "Alex DSP", canManageSchedule: false, canPostAgencyWide: false,
    });
    render(
      <OpenShiftsTab
        session={session({ userId: "dsp1", fullName: "Alex DSP", role: "dsp", roleKey: "dsp", permissions: { "hub.access": true } })}
        store={dspStore}
        sites={sites}
        canPostSite={false}
        canPostAgency={false}
      />,
    );

    expect(screen.queryByText("Post coverage")).toBeNull();
    const pickUp = await screen.findByRole("button", { name: /Pick up Evening 2:30p–10:30p/ });
    fireEvent.click(pickUp);
    await waitFor(() => expect(screen.getByText(/is on your schedule/)).toBeTruthy());
  });
});
