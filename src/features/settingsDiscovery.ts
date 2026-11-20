/**
 * Settings discovery links (agency-admin slice 4).
 *
 * Agency-level configuration does not all live on the Settings page:
 * binder templates, pay settings, and the Punch/Clock rules live in the
 * Employee Hub; consent types are configured from the Consents page;
 * delegation templates from the Delegations page. An administrator
 * looking at Settings had no signpost to any of them.
 *
 * This helper returns the signposts a session may see. Every link is
 * gated on EXACTLY the gate its target already uses — the target's own
 * tab/page visibility plus the editor's own permission check — so a
 * link never promises a surface the role cannot open, and following it
 * grants nothing: the target re-checks its own gate when it renders.
 * Links only: nothing is moved, renamed, or re-gated here.
 */
import { canEditBinderTemplates, hasPermission } from "../data/permissions";
import { pageVisible } from "../data/status";
import type { SessionUser } from "../data/types";

export type SettingsDiscoveryTarget =
  | {
      kind: "hub-tab";
      tab: "binder-board" | "payroll";
      /** Deep-link subview inside the tab. Only the Binder Board has
       * one today: its "templates" view is where the template editor
       * lives, and the Binder templates link must land on the editor
       * itself — not on the board the tab opens to by default. */
      subview?: "templates";
    }
  | { kind: "page"; page: "Consents" | "Delegations" };

export interface SettingsDiscoveryLink {
  id:
    | "binder-templates"
    | "pay-settings"
    | "clock-settings"
    | "consent-types"
    | "delegation-templates";
  label: string;
  description: string;
  target: SettingsDiscoveryTarget;
}

export function settingsDiscoveryLinks(
  session: SessionUser | null | undefined,
): SettingsDiscoveryLink[] {
  if (!session) return [];
  const links: SettingsDiscoveryLink[] = [];
  const hubReachable = pageVisible(session, "Employee Hub");

  // Binder templates — the editor behind the Binder Board's "Templates"
  // view (Employee Hub → Binder Board). The board tab opens on
  // hub.view_team or its roleAny list (MANAGER_TABS in EmployeeHubPage);
  // editing the templates themselves is canEditBinderTemplates
  // (administrator / program manager). The link mirrors both, and it
  // carries the "templates" subview so it lands on the editor itself —
  // the board alone would be a false destination for this label. The
  // subview rides the same gate: only a session that passes both
  // checks above ever receives it.
  const binderBoardTabOpens =
    hasPermission(session, "hub.view_team") ||
    ["hr", "administrator", "auditor"].includes(session.roleKey);
  if (
    hubReachable &&
    binderBoardTabOpens &&
    canEditBinderTemplates(session.roleKey)
  ) {
    links.push({
      id: "binder-templates",
      label: "Binder templates",
      description:
        "The master checklists behind every New Hire Binder, edited from the Binder Board's Templates view in the Employee Hub.",
      target: { kind: "hub-tab", tab: "binder-board", subview: "templates" },
    });
  }

  // Pay settings + Punch/Clock rules — both editors render inside the
  // Employee Hub's Payroll tab, only for hub.manage_pay_settings
  // (PayrollTab in EmployeeHubPage). The Payroll tab itself opens on
  // hub.approve_payroll or the HR role (MANAGER_TABS). Mirror both.
  const payrollTabOpens =
    hasPermission(session, "hub.approve_payroll") ||
    session.roleKey === "hr";
  if (
    hubReachable &&
    payrollTabOpens &&
    hasPermission(session, "hub.manage_pay_settings")
  ) {
    links.push({
      id: "pay-settings",
      label: "Pay settings",
      description:
        "Payroll overtime rules and accrual policies, in the Employee Hub's Payroll tab. These decide pay; the operational overtime limits are set separately in Settings → Agency rules.",
      target: { kind: "hub-tab", tab: "payroll" },
    });
    links.push({
      id: "clock-settings",
      label: "Punch/Clock rules",
      description:
        "Clock settings — punch rounding, grace, and auto-clock-out — in the Employee Hub's Payroll tab. The points a late clock-in costs are set separately in Settings → Agency rules.",
      target: { kind: "hub-tab", tab: "payroll" },
    });
  }

  // Consent types — the exact gate on the "Configure consent types"
  // button in Consents.tsx: an agency-wide program manager (a program
  // manager with no home site).
  if (
    pageVisible(session, "Consents") &&
    session.roleKey === "program_manager" &&
    !session.siteId
  ) {
    links.push({
      id: "consent-types",
      label: "Consent types",
      description:
        "The agency's consent-type configuration, behind “Configure consent types” on the Consents page.",
      target: { kind: "page", page: "Consents" },
    });
  }

  // Delegation templates — the Delegations page's Template library tab
  // shows to every non-DSP role that can open the page
  // (DelegationsPage); DSPs land on the forms tab and never see the
  // library, so they get no link.
  if (pageVisible(session, "Delegations") && session.roleKey !== "dsp") {
    links.push({
      id: "delegation-templates",
      label: "Delegation templates",
      description:
        "The delegation template library — site activation and assignments start from the Template library tab on the Delegations page.",
      target: { kind: "page", page: "Delegations" },
    });
  }

  return links;
}
