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

    expect(screen.getByText(/You can work up to 40 hours a week/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Evening 2:30p–10:30p" }));
    fireEvent.change(screen.getByLabelText(/How it.s filled/), { target: { value: "first_come" } });
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
