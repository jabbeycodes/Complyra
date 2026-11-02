import { useMemo, useState } from "react";
import {
  CalendarCheck,
  ClipboardList,
  FileText,
  FolderCheck,
  FolderOpen,
  Monitor,
  ShieldCheck,
  Star,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { SessionUser } from "../../data/types";
import { createHrStore } from "../../data/hrStore";
import { hasHubTeamPermission } from "../../data/permissions";
import {
  formatDueDate,
  readinessStatusLabel,
} from "../personalCompliance/personalCompliance";
import { usePersonalCompliance } from "../personalCompliance/usePersonalCompliance";
import MobileTimeOff from "./MobileTimeOff";
import MobileBinder from "./MobileBinder";
import MobilePerformance from "./MobilePerformance";
import MobileDocuments from "./MobileDocuments";
import type { ComplyraApi } from "../../data/localApi";

export type HubSection = "home" | "compliance" | "timeoff" | "binder" | "performance" | "documents";

/**
 * Mobile Employee Hub — the employee's self-service hub on the phone:
 * My Compliance (the full readiness list behind the home card's
 * roll-up), Time Off, my New Hire Binder, my Performance file, and
 * Documents with acknowledgment signing. Each section is a dedicated
 * mobile component over the same HrStore the desktop Employee Hub
 * builds from the session — the same construction EmployeeHubPage
 * uses. The other manager tabs (Binder Board, the template editor)
 * stay on the desktop hub, as do the punch surfaces; the hub home
 * carries a door to the full hub for those.
 *
 * Wave 7S (batch 103): the three team tools HR owns — Attendance,
 * Timecards, Payroll (HR hub rule, Joshua 2026-10-31) — get their own
 * doors here, gated by hasHubTeamPermission, the same rule the
 * desktop hub's tab registry uses. On the phone they were unreachable:
 * the hub home listed only self-service sections, and the desktop
 * tabs behind the generic door were gated on stored template keys
 * the HR role may not carry. Each door opens the full hub at its tab.
 *
 * The auditor exclusion mirrors the desktop hub: auditors are kept
 * out of Time Off entirely (employment data, not an Individual's
 * compliance record). The shell only offers the hub tile with
 * hub.access, the desktop page's own gate.
 */
export default function MobileHub({
  api,
  session,
  onOpenFullHub,
  onOpenHubTab,
  startSection,
}: {
  api: ComplyraApi;
  session: SessionUser;
  onOpenFullHub: () => void;
  /** Deep-link into the full hub at a named tab (Attendance /
   *  Timecards / Payroll). Falls back to the generic full-hub door
   *  when the shell provides no tab deep-link. */
  onOpenHubTab?: (tab: string) => void;
  /**
   * Section to open on — the home compliance band deep-links straight
   * to My Compliance. Read once at mount; the shell remounts the hub
   * on every entry, so each arrival honors the latest intent.
   */
  startSection?: HubSection;
}) {
  const store = useMemo(
    () => createHrStore({ agencyId: session.agencyId, userId: session.userId }),
    [session.agencyId, session.userId],
  );
  const [section, setSection] = useState<HubSection>(startSection ?? "home");
  const isAuditor = session.roleKey === "auditor";

  if (section === "timeoff" && !isAuditor) {
    return (
      <MobileTimeOff
        store={store}
        session={session}
        onBack={() => setSection("home")}
      />
    );
  }
  if (section === "binder") {
    return (
      <MobileBinder
        api={api}
        store={store}
        session={session}
        onBack={() => setSection("home")}
      />
    );
  }
  if (section === "performance") {
    return (
      <MobilePerformance
        store={store}
        session={session}
        onBack={() => setSection("home")}
      />
    );
  }
  if (section === "documents") {
    return (
      <MobileDocuments
        store={store}
        session={session}
        onBack={() => setSection("home")}
      />
    );
  }
  if (section === "compliance") {
    return (
      <ComplianceDetail
        session={session}
        onBack={() => setSection("home")}
        onOpenFullHub={onOpenFullHub}
      />
    );
  }

  const rows: {
    id: HubSection;
    icon: LucideIcon;
    label: string;
    hint: string;
  }[] = [
    {
      id: "compliance",
      icon: ShieldCheck,
      label: "My compliance",
      hint: "Your certifications, training, and requirements",
    },
    ...(!isAuditor
      ? [
          {
            id: "timeoff" as HubSection,
            icon: CalendarCheck,
            label: "Time off",
            hint: "Balances, requests, and your time-off history",
          },
        ]
      : []),
    {
      id: "binder",
      icon: FolderCheck,
      label: "New Hire Binder",
      hint: "Your onboarding file — upload documents here",
    },
    {
      id: "performance",
      icon: Star,
      label: "Performance",
      hint: "Your reviews and corrective actions",
    },
    {
      id: "documents",
      icon: FolderOpen,
      label: "Documents",
      hint: "Handbooks and policies — acknowledge what is assigned",
    },
  ];

  // Team tools the signed-in role owns in the Employee Hub — for HR
  // that's Attendance, Timecards and Payroll by role (HR hub rule);
  // any other role sees a door only when it holds the matching hub
  // permission, exactly the desktop tab registry's gates. Each door
  // opens the full hub at its tab.
  const managerRows: {
    tab: string;
    icon: LucideIcon;
    label: string;
    hint: string;
  }[] = [
    ...(hasHubTeamPermission(session, "hub.view_team")
      ? [
          {
            tab: "attendance",
            icon: ClipboardList,
            label: "Attendance",
            hint: "Team attendance, punches, and missed-punch review",
          },
        ]
      : []),
    ...(hasHubTeamPermission(session, "hub.review_timecards")
      ? [
          {
            tab: "timecards",
            icon: FileText,
            label: "Timecards",
            hint: "Review and approve the team's timecards",
          },
        ]
      : []),
    ...(hasHubTeamPermission(session, "hub.approve_payroll")
      ? [
          {
            tab: "payroll",
            icon: Wallet,
            label: "Payroll",
            hint: "Pay periods, hours, and payroll approval",
          },
        ]
      : []),
  ];

  return (
    <div>
      <p className="msh-section-note">
        Your employee hub at {session.agencyName}: compliance, time off,
        your binder, performance file, and documents.
      </p>
      <div className="msh-list">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <button
              key={row.id}
              type="button"
              className="msh-row"
              onClick={() => setSection(row.id)}
            >
              <span className="msh-tile-icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <span className="msh-row-main">
                <strong>{row.label}</strong>
                <small>{row.hint}</small>
              </span>
              <span className="msh-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          );
        })}
        {managerRows.map((row) => {
          const Icon = row.icon;
          return (
            <button
              key={row.tab}
              type="button"
              className="msh-row"
              onClick={() =>
                onOpenHubTab ? onOpenHubTab(row.tab) : onOpenFullHub()
              }
            >
              <span className="msh-tile-icon" aria-hidden="true">
                <Icon size={22} />
              </span>
              <span className="msh-row-main">
                <strong>{row.label}</strong>
                <small>{row.hint}</small>
              </span>
              <span className="msh-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          );
        })}
        <button type="button" className="msh-row" onClick={onOpenFullHub}>
          <span className="msh-tile-icon" aria-hidden="true">
            <Monitor size={22} />
          </span>
          <span className="msh-row-main">
            <strong>Full Employee Hub</strong>
            <small>
              Time clock, schedule, timecards, and manager tabs on the
              desktop hub
            </small>
          </span>
          <span className="msh-chevron" aria-hidden="true">
            ›
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * The full personal-compliance list behind the home card: every
 * requirement with its status in words and its due date, from the
 * same usePersonalCompliance roll-up the card reads.
 */
function ComplianceDetail({
  session,
  onBack,
  onOpenFullHub,
}: {
  session: SessionUser;
  onBack: () => void;
  onOpenFullHub: () => void;
}) {
  const state = usePersonalCompliance(session);
  const { loading, error, items, summary } = state;
  return (
    <div>
      <button type="button" className="msh-text-button" onClick={onBack}>
        ‹ My Hub
      </button>
      <h3 className="msh-pass-title">My compliance</h3>
      {error && (
        <p className="msh-alert" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p className="msh-empty">Loading your compliance…</p>
      ) : items.length === 0 ? (
        <p className="msh-empty">
          No requirements assigned to your role right now.
        </p>
      ) : (
        <>
          <p className="msh-status-text">
            {summary.percentCurrent}% current · {summary.current} of{" "}
            {summary.total} complete
            {summary.attentionCount > 0
              ? ` · ${summary.attentionCount} need${summary.attentionCount === 1 ? "s" : ""} attention`
              : ""}
          </p>
          <div className="msh-list">
            {items.map((item) => (
              <div key={item.requirement.id} className="msh-row static">
                <span className="msh-row-main">
                  <strong>{item.requirement.label}</strong>
                  <small className="msh-status-text">
                    {readinessStatusLabel(item.status)}
                    {item.dueOn ? ` · due ${formatDueDate(item.dueOn)}` : ""}
                  </small>
                  {item.evidenceNote && <small>{item.evidenceNote}</small>}
                </span>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="msh-button secondary block"
            onClick={onOpenFullHub}
          >
            Open the full My Compliance tab
          </button>
        </>
      )}
    </div>
  );
}
