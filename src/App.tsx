import { useEffect, useRef, useState } from "react";
import {
  LayoutDashboard,
  Users,
  Building2,
  ListChecks,
  FolderOpen,
  ClipboardCheck,
  ShieldCheck,
  History,
  Settings,
  HelpCircle,
  ChevronDown,
  Search,
  Bell,
  Sparkles,
  Plus,
  UserPlus,
  ArrowRight,
  ArrowUpRight,
  Download,
  Upload,
  Check,
  FileText,
  LockKeyhole,
  X,
  Send,
  CalendarDays,
  Filter,
  Menu,
  CheckCheck,
  BookOpen,
  CircleAlert,
  ChevronRight,
  RotateCcw,
  ExternalLink,
  PenLine,
  LogOut,
  KeyRound,
} from "lucide-react";
import Dashboard from "./Dashboard";
import {
  Avatar,
  Badge,
  DueChip,
  Empty,
  FilterBar,
  Modal,
  PageHeading,
  RequirementTable,
  SourceCard,
  formatDate,
  formatDateLong,
} from "./components";
import {
  categories,
  exportCsv,
  metrics,
} from "./domain";
import type { Plan, Requirement } from "./domain";
import AuthEntry from "./auth/AuthEntry";
import ChangePasswordScreen from "./auth/ChangePasswordScreen";
import PendingAgencyScreen from "./auth/PendingAgencyScreen";
import AcknowledgmentSheet from "./features/AcknowledgmentSheet";
import AddIndividualForm from "./features/AddIndividualForm";
import AddSiteForm from "./features/AddSiteForm";
import IndividualChart from "./features/IndividualChart";
import SiteMonthlyChecks from "./features/SiteMonthlyChecks";
import SiteReviewPanel from "./features/SiteReviewPanel";
import MonthlyDueSettings from "./features/MonthlyDueSettings";
import AgencyLogoSettings, { AgencyMark } from "./features/AgencyLogoSettings";
// LIFEPATH-P2-IMPORT (training engine)
import StaffCompliancePage from "./features/training/StaffCompliancePage";
// LIFEPATH-P3-IMPORT (delegation forms)
// LIFEPATH-P4-IMPORT (certificates)
// LIFEPATH-P5-IMPORT (HM weekly checklist)
// LIFEPATH-P6-IMPORT (med inventory)
import AssignRoleControl from "./features/AssignRoleControl";
import InviteMemberForm from "./features/InviteMemberForm";
import PlatformConsole from "./features/PlatformConsole";
import ResetPasswordControl from "./features/ResetPasswordControl";
import RolesAccessPage from "./features/RolesAccessPage";
import { useData } from "./data/DataProvider";
import { personalQueue, sitesVisibleTo } from "./data/dashboard";
import { isSiteReviewInPlace, normalizeSiteFacts } from "./data/siteReview";
import { todayIso } from "./data/chart";
import { canCreateIndividual } from "./data/permissions";
import { can, pageVisible } from "./data/status";
import { canSeeRenewals, renewalBadge } from "./data/planStack";
import type { PacketDetail } from "./data/types";
function download(name: string, body: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const {
    session,
    workspace,
    loading,
    api,
    refresh,
    signOut,
    usingHostedBackend,
  } = useData();
  const [page, setPage] = useState("Overview");
  const [site, setSite] = useState("All sites");
  const [status, setStatus] = useState("All statuses");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<string | null>(null);
  const [addPersonSiteId, setAddPersonSiteId] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [packet, setPacket] = useState<PacketDetail | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [evidence, setEvidence] = useState("");
  const [formError, setFormError] = useState("");
  const [confirm, setConfirm] = useState<null | {
    title: string;
    body: string;
    action: string;
    run: () => void;
  }>(null);
  const [editDraft, setEditDraft] = useState<null | {
    title: string;
    ownerUserId: string;
    due: string;
    frequency: string;
  }>(null);
  const [copilotQuestion, setCopilotQuestion] = useState("");
  const [answer, setAnswer] = useState<{
    text: string;
    items: Requirement[];
  } | null>(null);
  const [auditCategory, setAuditCategory] = useState("All categories");
  const [auditPerson, setAuditPerson] = useState("All individuals");
  const [auditOwner, setAuditOwner] = useState("All staff");
  const [auditFrom, setAuditFrom] = useState("2026-09-01");
  const [auditTo, setAuditTo] = useState("2026-09-30");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    setModal(null);
    setPacket(null);
    setSelectedId(null);
    setPerson(null);
    setPlan(null);
    setSite("All sites");
  }, [session?.userId]);
  useEffect(() => {
    if (!session) return;
    if (page !== "Overview" && !pageVisible(session, page)) {
      setPage("Overview");
    }
  }, [session, page]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        // If focus is inside a field, let the field keep its own behavior
        // instead of wiping the global search while the user is typing.
        if (
          document.activeElement instanceof HTMLInputElement ||
          document.activeElement instanceof HTMLTextAreaElement
        ) {
          return;
        }
        setGlobalQuery("");
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    document.body.classList.toggle("nav-open", mobileOpen);
    return () => document.body.classList.remove("nav-open");
  }, [mobileOpen]);
  if (loading) {
    return <div className="login-shell">Loading workspace…</div>;
  }
  if (!session) {
    return <AuthEntry />;
  }
  if (session.mustChangePassword) {
    return <ChangePasswordScreen />;
  }
  if (!session.platformAdmin && session.agencyStatus !== "active") {
    return <PendingAgencyScreen />;
  }
  if (!workspace) {
    return <div className="login-shell">Loading workspace…</div>;
  }
  const sites = sitesVisibleTo(session, workspace.sites, workspace.staff);
  const individuals = workspace.individuals.filter((person) =>
    sites.some((row) => row.name === person.site),
  );
  const staff = workspace.staff;
  const data = {
    requirements: workspace.requirements,
    plans: workspace.plans,
    activity: workspace.activity,
  };
  const selected = selectedId
    ? (data.requirements.find((r) => r.id === selectedId) ?? null)
    : null;
  const canManage = can(session, "requirements.approve");
  const canUpload = can(session, "documents.upload");
  const canAddSite = can(session, "sites.create");
  const canAddPerson = canCreateIndividual(session.roleKey);
  const canInvite = can(session, "members.invite");
  const canAssign = can(session, "members.assign_roles");
  const canCompleteWork = can(session, "requirements.complete");
  const canExportAudit = can(session, "audit.export");
  const canResetPassword = can(session, "members.reset_password");
  const visibleSiteNames = new Set(sites.map((row) => row.name));
  const visibleRequirements = data.requirements.filter((r) =>
    visibleSiteNames.has(r.site),
  );
  const scoped = visibleRequirements.filter(
    (r) => site === "All sites" || r.site === site,
  );
  const alertItems = scoped.filter((r) =>
    ["Overdue", "Expired", "Pending review"].includes(r.status),
  );
  const personalItems = personalQueue({
    session,
    items: visibleRequirements,
    packets: workspace.packets,
    planStacks: workspace.planStacks,
    canApprove: canManage,
    monthly: workspace.monthly,
    monthlyDue: workspace.monthlyDue,
    individuals,
    sites,
    siteReviews: workspace.siteReviews,
  });
  const m = metrics(scoped);
  const isCategory = categories.includes(page as (typeof categories)[number]);
  const auditMode = page === "Audit center";
  const filtered = scoped.filter(
    (r) =>
      (!isCategory || r.category === page) &&
      (page !== "Review queue" || r.status === "Pending review") &&
      (status === "All statuses" ||
        r.status === status ||
        (status === "Overdue" && r.status === "Expired")) &&
      `${r.title} ${r.person} ${r.site} ${r.owner} ${r.source}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const auditItems = scoped.filter(
    (r) =>
      (auditCategory === "All categories" || r.category === auditCategory) &&
      (auditPerson === "All individuals" || r.person === auditPerson) &&
      (auditOwner === "All staff" || r.owner === auditOwner) &&
      r.due >= auditFrom &&
      r.due <= auditTo,
  );
  function navigate(next: string, nextStatus = "All statuses") {
    if (next !== "Individual chart") setPerson(null);
    setPage(next);
    setStatus(nextStatus);
    setQuery("");
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function openPersonChart(name: string) {
    setPerson(name);
    setPage("Individual chart");
    setQuery("");
    setMobileOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  function selectRequirement(r: Requirement) {
    setSelectedId(r.id);
    setEvidence("");
    setFormError("");
  }
  function notify(message: string) {
    setToast(message);
  }
  async function finishRequirement() {
    if (!selected) return;
    try {
      await api.completeRequirement(selected.id, evidence);
      await refresh();
      setEvidence("");
      notify("Completion saved. Your compliance overview is up to date.");
    } catch (e) {
      setFormError((e as Error).message);
    }
  }
  async function approve() {
    if (!selected) return;
    try {
      await api.approveRequirement(selected.id);
      await refresh();
      setSelectedId(null);
      notify(
        "Requirement approved and activated. Earlier plan versions are retained.",
      );
    } catch (e) {
      setFormError((e as Error).message);
    }
  }
  function openEdit() {
    if (!selected) return;
    setFormError("");
    setEditDraft({
      title: selected.title,
      ownerUserId: staff.find((s) => s.name === selected.owner)?.id ?? "",
      due: selected.due.slice(0, 10),
      frequency: selected.frequency,
    });
  }
  async function saveEdit() {
    if (!selected || !editDraft) return;
    const title = editDraft.title.trim();
    if (!title) {
      setFormError("Enter a title for the requirement.");
      return;
    }
    try {
      await api.updateRequirement(selected.id, {
        title,
        dueOn: editDraft.due,
        frequency: editDraft.frequency,
        ownerUserId: editDraft.ownerUserId || undefined,
      });
      await refresh();
      setEditDraft(null);
      setFormError("");
      notify("Correction saved to the audit trail.");
    } catch (e) {
      setFormError((e as Error).message);
    }
  }
  function askCopilot(question: string) {
    setCopilotQuestion(question);
    const q = question.toLowerCase();
    let result = scoped.filter(
      (r) => r.status !== "Compliant" && r.status !== "Pending review",
    );
    const matchingPerson = individuals.find((p) =>
      q.includes(p.name.split(" ")[0].toLowerCase()),
    );
    const matchingSite = sites.find(
      (s) =>
        q.includes(s.name.toLowerCase()) || q.includes(s.address.split(" ")[0]),
    );
    if (matchingPerson)
      result = scoped.filter((r) => r.person === matchingPerson.name);
    if (matchingSite)
      result = result.filter((r) => r.site === matchingSite.name);
    if (/delegat|expir/.test(q))
      result = result.filter((r) => r.category === "Nursing delegations");
    if (/equipment/.test(q))
      result = result.filter((r) => r.category === "Equipment checks");
    if (/acknowledg|sign|pcsp/.test(q))
      result = result.filter((r) => r.category === "PCSP acknowledgments");
    if (/overdue|urgent/.test(q))
      result = result.filter((r) => ["Overdue", "Expired"].includes(r.status));
    const understood =
      matchingPerson ||
      matchingSite ||
      /audit|risk|prioriti|missing|overdue|delegat|expir|equipment|acknowledg|sign|pcsp|attention/.test(
        q,
      );
    setAnswer(
      understood
        ? {
            text: result.length
              ? `I found ${result.length} matching ${result.length === 1 ? "requirement" : "requirements"} in ${site === "All sites" ? "the sample agency" : site}. ${result.filter((r) => ["Overdue", "Expired"].includes(r.status)).length} are overdue or expired. Open a source below to see the responsible person and next action.`
              : "There are no matching requirements in the current sample data and site selection. This does not confirm that a care instruction is absent from a real plan.",
            items: result.slice(0, 8),
          }
        : {
            text: "This preview can look up requirements, overdue work, delegations, equipment checks, and plan acknowledgments in the sample records. Try “What should we fix before an audit?”",
            items: [],
          },
    );
  }
  const navItems = [
    {
      title: "WORKSPACE",
      items: [
        ["Overview", LayoutDashboard],
        ["Platform", ShieldCheck],
        ["Individuals", Users],
        ["Sites & programs", Building2],
        ["Staff", Users],
        ["Roles & access", KeyRound],
      ],
    },
    {
      title: "COMPLIANCE",
      items: [
        ["Requirements", ListChecks],
        ["Documents", FolderOpen],
        ["Review queue", ClipboardCheck],
        ["Audit center", ShieldCheck],
        ["Acknowledgments", PenLine],
        ["Activity log", History],
      ],
    },
    {
      title: "LIFEPATH",
      items: [
        // LIFEPATH-P2-NAV (training engine)
        ["Training", BookOpen],
        // LIFEPATH-P3-NAV (delegation forms)
        // LIFEPATH-P4-NAV (certificates)
        // LIFEPATH-P5-NAV (HM weekly checklist)
        // LIFEPATH-P6-NAV (med inventory)
      ],
    },
  ] as const;
  return (
    <div className="app-shell">
      {mobileOpen && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={`sidebar ${mobileOpen ? "mobile-open" : ""}`}>
        <button
          className="sidebar-close icon-button"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        >
          <X size={20} />
        </button>
        <button
          className="brand"
          onClick={() => navigate("Overview")}
          aria-label="Complyrer home"
        >
          <img src="/favicon.svg" alt="" />
          <span>
            complyrer<span className="brand-period">.</span>
          </span>
        </button>
        <div className="brand-tagline">COMPLIANCE, CONNECTED.</div>
        <button className="agency-picker" onClick={() => setModal("agency")}>
          <AgencyMark name={session.agencyName} logoUrl={workspace.branding.logoUrl} />
          <span>
            <strong>{session.agencyName}</strong>
            <small>{usingHostedBackend ? "Hosted workspace" : "Local workspace"}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <nav>
          {navItems.map((group) => {
            const items = group.items.filter(([name]) =>
              pageVisible(session, name),
            );
            if (!items.length) return null;
            return (
            <div className="nav-group" key={group.title}>
              <div className="nav-label">{group.title}</div>
              {items.map(([name, Icon]) => (
                <button
                  key={name}
                  onClick={() => navigate(name)}
                  aria-current={page === name ? "page" : undefined}
                  className={`nav-item ${page === name || (name === "Requirements" && isCategory) ? "active" : ""}`}
                >
                  <Icon size={18} />
                  <span>{name}</span>
                  {name === "Review queue" &&
                    metrics(data.requirements).review > 0 && (
                      <span className="nav-count">
                        {metrics(data.requirements).review}
                      </span>
                    )}
                  {name === "Acknowledgments" &&
                    workspace.packets.some((p) =>
                      p.rows.some((row) => !row.signedAt && p.packet.status === "open"),
                    ) && (
                      <span className="nav-count">
                        {
                          workspace.packets.filter((p) =>
                            p.rows.some((row) => !row.signedAt),
                          ).length
                        }
                      </span>
                    )}
                </button>
              ))}
            </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="assistant-card"
            onClick={() => setModal("copilot")}
          >
            <span className="assistant-card-top">
              <Sparkles size={18} />
              <span>RECORDS LOOKUP</span>
            </span>
            <strong>A little help, a lot of clarity.</strong>
            <span>
              Find answers in your agency’s
              <br />
              compliance records.
            </span>
            <b>
              Ask Complyrer <ArrowUpRight size={15} />
            </b>
          </button>
          <button
            className={`nav-item ${page === "Settings" ? "active" : ""}`}
            onClick={() => navigate("Settings")}
          >
            <Settings size={18} />
            <span>Settings</span>
          </button>
          <button className="nav-item" onClick={() => setModal("help")}>
            <HelpCircle size={18} />
            <span>Help & resources</span>
            <ExternalLink size={13} />
          </button>
          <button
            className="profile"
            aria-label="Your profile"
            onClick={() => setModal("profile")}
          >
            <Avatar name={session.fullName} color="peach" />
            <span>
              <strong>{session.fullName}</strong>
              <small>{session.jobTitle}</small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMobileOpen(true)}
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{isCategory ? "Requirements" : page}</strong>
          </div>
          <div className="topbar-actions">
            <div className="global-search">
              <Search size={16} />
              <input
                ref={searchRef}
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder="Search anything…"
                aria-label="Search all requirements"
              />
              <kbd>⌘ K</kbd>
              {globalQuery && (
                <div className="search-results">
                  <div className="search-heading">REQUIREMENTS & RECORDS</div>
                  {scoped
                    .filter((r) =>
                      `${r.person} ${r.title} ${r.site} ${r.owner}`
                        .toLowerCase()
                        .includes(globalQuery.toLowerCase()),
                    )
                    .slice(0, 6)
                    .map((r) => (
                      <button
                        key={r.id}
                        onClick={() => {
                          selectRequirement(r);
                          setGlobalQuery("");
                        }}
                      >
                        <FileText size={17} />
                        <span>
                          <strong>{r.title}</strong>
                          <small>
                            {r.person} · {r.site}
                          </small>
                        </span>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                  {!scoped.some((r) =>
                    `${r.person} ${r.title} ${r.site} ${r.owner}`
                      .toLowerCase()
                      .includes(globalQuery.toLowerCase()),
                  ) && <p>No matching records. Try a name or site.</p>}
                </div>
              )}
            </div>
            <span className="topbar-divider" />
            <button
              className="notification-button icon-button"
              aria-label="View notifications"
              onClick={() => setModal("notifications")}
            >
              <Bell size={19} />
              {alertItems.length > 0 && <i />}
            </button>
            <Avatar name={session.fullName} color="peach" small />
          </div>
        </header>
        <main>
          {page === "Overview" ? (
            <Dashboard
              items={scoped}
              allItems={visibleRequirements}
              scorecard={workspace.scorecard}
              activity={data.activity}
              sites={sites}
              siteReviews={workspace.siteReviews}
              individuals={individuals}
              site={site}
              personalItems={personalItems}
              onSite={setSite}
              onNavigate={navigate}
              onRequirement={selectRequirement}
              onOpenPerson={openPersonChart}
              onExport={() => {
                download(
                  "complyrer-sample-compliance-report.csv",
                  exportCsv(scoped),
                );
                notify("Your sample compliance report has been downloaded.");
              }}
              onCopilot={() => setModal("copilot")}
              onActivity={() => navigate("Activity log")}
            />
          ) : (
            <>
              {(page === "Requirements" ||
                page === "Review queue" ||
                isCategory) && (
                <>
                  <PageHeading
                    eyebrow={
                      page === "Review queue"
                        ? "HUMAN REVIEW. CONFIDENT DECISIONS."
                        : "CLEAR RESPONSIBILITIES, EVERY DAY."
                    }
                    title={
                      page === "Review queue" ? "Ready for your review" : page
                    }
                    description={
                      page === "Review queue"
                        ? "Review source references and responsibilities before a draft requirement becomes active."
                        : "Know what needs to happen, who owns it, and what proves it’s done."
                    }
                  >
                    {canManage && (
                      <button
                        className="button primary"
                        onClick={() => setModal("new")}
                      >
                        <Plus size={16} /> Add requirement
                      </button>
                    )}
                  </PageHeading>
                  <div className="tabs">
                    <button
                      className={status === "All statuses" ? "selected" : ""}
                      onClick={() => setStatus("All statuses")}
                    >
                      All requirements{" "}
                      <span>
                        {page === "Review queue"
                          ? scoped.filter((r) => r.status === "Pending review")
                              .length
                          : scoped.length}
                      </span>
                    </button>
                    {page !== "Review queue" &&
                      ["Overdue", "Due soon", "Compliant"].map((s) => (
                        <button
                          key={s}
                          className={status === s ? "selected" : ""}
                          onClick={() => setStatus(s)}
                        >
                          {s}
                        </button>
                      ))}
                    <div className="tabs-right">
                      <select
                        aria-label="Requirement site"
                        value={site}
                        onChange={(e) => setSite(e.target.value)}
                      >
                        <option>All sites</option>
                        {sites.map((s) => (
                          <option key={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <section className="panel">
                    <FilterBar
                      query={query}
                      setQuery={setQuery}
                      status={status}
                      setStatus={setStatus}
                      count={filtered.length}
                      statuses={
                        page === "Review queue"
                          ? ["All statuses", "Pending review"]
                          : undefined
                      }
                    />
                    <RequirementTable
                      items={filtered}
                      onSelect={selectRequirement}
                    />
                  </section>
                </>
              )}
              {page === "Individuals" && (
                <>
                  <PageHeading
                    eyebrow="PEOPLE AT THE CENTER."
                    title="Every person. One connected record."
                    description="Care plans, responsibilities, and evidence, organized around the people you support."
                  >
                    {canAddPerson && (
                      <button
                        className="button primary"
                        onClick={() => setModal("add-person")}
                      >
                        <UserPlus size={16} /> Add a person
                      </button>
                    )}
                    {canUpload && (
                      <button
                        className="button"
                        onClick={() => setModal("upload")}
                      >
                        <Upload size={16} /> Add a plan
                      </button>
                    )}
                  </PageHeading>
                  <div className="list-controls">
                    <div className="input-search">
                      <Search size={17} />
                      <input
                        aria-label="Search individuals"
                        placeholder="Find an individual…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                    </div>
                    <select
                      aria-label="Individuals site"
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                    >
                      <option>All sites</option>
                      {sites.map((s) => (
                        <option key={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="people-grid">
                    {individuals
                      .filter(
                        (p) =>
                          (site === "All sites" || p.site === site) &&
                          p.name.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((p) => {
                        const pm = metrics(
                          data.requirements.filter((r) => r.person === p.name),
                        );
                        const renewals =
                          session && canSeeRenewals(session.roleKey)
                            ? (
                                workspace.planStacks.find((stack) => stack.individualId === p.id)
                                  ?.renewals ?? []
                              ).filter((row) => row.status !== "current")
                            : [];
                        return (
                          <button
                            className="panel person-card"
                            key={p.id}
                            onClick={() => openPersonChart(p.name)}
                          >
                            <div className="person-card-top">
                              <Avatar name={p.name} color={p.color} />
                              <ArrowUpRight size={18} />
                            </div>
                            <h2>{p.name}</h2>
                            <p>
                              <Building2 size={14} />
                              {p.site}
                            </p>
                            {renewals.length > 0 && (
                              <ul className="person-renewals">
                                {renewals.map((row) => (
                                  <li key={row.id}>
                                    <span>{row.title}</span>
                                    <DueChip
                                      date={row.nextDueOn}
                                      status={renewalBadge(row.status)}
                                    />
                                  </li>
                                ))}
                              </ul>
                            )}
                            <div className="person-card-progress">
                              <span>Compliance readiness</span>
                              <strong>{pm.score}%</strong>
                            </div>
                            <div className="progress-track">
                              <span style={{ width: `${pm.score}%` }} />
                            </div>
                            <div className="person-card-bottom">
                              <span>{pm.total} requirements</span>
                              {pm.overdue ? (
                                <span className="overdue-text">
                                  {pm.overdue} need attention
                                </span>
                              ) : (
                                <span className="positive">
                                  <Check size={13} /> On track
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })}
                  </div>
                </>
              )}
              {page === "Individual chart" && person && (
                <IndividualChart
                  individualId={
                    individuals.find((p) => p.name === person)?.id ?? ""
                  }
                  onBack={() => navigate("Individuals")}
                />
              )}
              {page === "Sites & programs" && (
                <>
                  <PageHeading
                    eyebrow="ONE AGENCY. CONNECTED CARE."
                    title="A home for every detail."
                    description="See how each site is doing and give your team the support it needs."
                  />
                  <div className="list-controls">
                    <span>
                      {sites.length} program sites · {individuals.length}{" "}
                      individuals ·{" "}
                      {new Set(sites.map((row) => row.program)).size} programs
                    </span>
                    <select
                      aria-label="Select site"
                      value={site}
                      onChange={(e) => setSite(e.target.value)}
                    >
                      <option>All sites</option>
                      {sites.map((s) => (
                        <option key={s.name}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="site-grid">
                    {canAddSite && (
                      <button
                        type="button"
                        className="panel add-site-tile"
                        aria-label="Add a site"
                        onClick={() => setModal("add-site")}
                      >
                        <span className="add-site-plus" aria-hidden="true">
                          <Plus size={22} strokeWidth={3} />
                        </span>
                        <strong>Add a site</strong>
                        <span>Open a new program home as you grow</span>
                      </button>
                    )}
                    {sites
                      .filter((s) => site === "All sites" || s.name === site)
                      .map((s) => {
                        const sm = metrics(
                          data.requirements.filter((r) => r.site === s.name),
                        );
                        const review = workspace.siteReviews.find(
                          (row) => row.siteId === s.id,
                        );
                        const reviewInPlace = isSiteReviewInPlace(
                          review,
                          normalizeSiteFacts(s),
                          todayIso(),
                        );
                        return (
                          <section className="panel location-card" key={s.name}>
                            <div className="location-top">
                              <span className={`house-icon ${s.color}`}>
                                <Building2 size={20} />
                              </span>
                              <div className="location-title">
                                <h2>{s.name}</h2>
                                <p>
                                  {s.address}
                                  <span className="program-tag">{s.program}</span>
                                </p>
                              </div>
                              <Badge
                                status={
                                  sm.overdue ? "Needs attention" : "On track"
                                }
                              />
                            </div>
                            <div className="location-stat">
                              <strong>
                                {sm.score}
                                <small>%</small>
                              </strong>
                              <span>ready</span>
                              <div className="progress-track">
                                <span style={{ width: `${sm.score}%` }} />
                              </div>
                              <em>
                                {sm.overdue} overdue
                              </em>
                            </div>
                            <div className="location-manager">
                              <Avatar name={s.manager} small color={s.color} />
                              <span>{s.manager}</span>
                              <span className="muted">
                                {individuals.filter((person) => person.site === s.name).length}{" "}
                                individuals
                                {" · "}
                                {reviewInPlace
                                  ? "Site review in place"
                                  : "Site review open"}
                              </span>
                            </div>
                            <div className="heading-actions">
                              {canAddPerson && (
                                <button
                                  className="button"
                                  onClick={() => {
                                    setAddPersonSiteId(s.id);
                                    setModal("add-person");
                                  }}
                                >
                                  <UserPlus size={16} /> Add a person
                                </button>
                              )}
                              <button
                                className="button"
                                onClick={() => setSite(s.name)}
                              >
                                Site review pack
                              </button>
                              <button
                                className="button"
                                onClick={() => setSite(s.name)}
                              >
                                This month’s checks
                              </button>
                              <button
                                className="button full"
                                onClick={() => {
                                  setSite(s.name);
                                  navigate("Requirements");
                                }}
                              >
                                View site requirements <ArrowRight size={16} />
                              </button>
                            </div>
                          </section>
                        );
                      })}
                  </div>
                  {site !== "All sites" &&
                    sites
                      .filter((row) => row.name === site)
                      .map((row) => (
                        <div key={row.id}>
                          <SiteReviewPanel siteId={row.id} />
                          <SiteMonthlyChecks siteId={row.id} />
                        </div>
                      ))}
                </>
              )}
              {page === "Staff" && (
                <>
                  <PageHeading
                    eyebrow="SUPPORTED TEAMS. CONSISTENT CARE."
                    title="Your people make it possible."
                    description="Keep every staff member connected to their assigned responsibilities."
                  >
                    {canInvite && (
                      <button
                        className="button primary"
                        onClick={() => setModal("invite")}
                      >
                        <UserPlus size={16} /> Add member
                      </button>
                    )}
                  </PageHeading>
                  <section className="panel">
                    <div className="filter-bar">
                      <div className="input-search">
                        <Search size={17} />
                        <input
                          placeholder="Search staff…"
                          aria-label="Search staff"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <span className="muted">{staff.length} team members</span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Team member</th>
                            <th>Username</th>
                            <th>Role</th>
                            <th>Assigned site</th>
                            <th>Open requirements</th>
                            {canAssign && <th>Assign role</th>}
                            {canResetPassword && <th>Password</th>}
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {staff
                            .filter(
                              (s) =>
                                s.name
                                  .toLowerCase()
                                  .includes(query.toLowerCase()) &&
                                (site === "All sites" || s.site === site),
                            )
                            .map((s) => (
                              <tr key={s.name}>
                                <td>
                                  <span className="person-cell">
                                    <Avatar name={s.name} />
                                    <strong>{s.name}</strong>
                                  </span>
                                </td>
                                <td>{s.username || s.email}</td>
                                <td>{s.role}</td>
                                <td>{s.site}</td>
                                <td>
                                  {
                                    data.requirements.filter(
                                      (r) =>
                                        r.owner === s.name &&
                                        r.status !== "Compliant",
                                    ).length
                                  }
                                </td>
                                {canAssign && (
                                  <td>
                                    <AssignRoleControl
                                      userId={s.id}
                                      roleKey={s.roleKey}
                                      siteId={s.siteId}
                                      expiresOn={s.expiresOn}
                                      onAssigned={notify}
                                    />
                                  </td>
                                )}
                                {canResetPassword && (
                                  <td>
                                    <ResetPasswordControl
                                      userId={s.id}
                                      name={s.name}
                                      onReset={notify}
                                    />
                                  </td>
                                )}
                                <td>
                                  <button
                                    className="text-button"
                                    onClick={() => {
                                      navigate("Requirements");
                                      setQuery(s.name);
                                    }}
                                  >
                                    View assignments <ArrowRight size={14} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {page === "Documents" && (
                <>
                  <PageHeading
                    eyebrow="THE SOURCE OF TRUTH."
                    title="Plans change. History stays."
                    description="A connected library of current plans, draft updates, and earlier versions."
                  >
                    {canUpload && (
                    <button
                      className="button primary"
                      onClick={() => setModal("upload")}
                    >
                      <Upload size={16} /> Add document
                    </button>
                    )}
                  </PageHeading>
                  <div className="tabs">
                    {[
                      "All statuses",
                      "Active",
                      "Pending review",
                      "Archived",
                    ].map((s) => (
                      <button
                        key={s}
                        className={status === s ? "selected" : ""}
                        onClick={() => setStatus(s)}
                      >
                        {s === "All statuses" ? "All documents" : s}
                      </button>
                    ))}
                  </div>
                  <section className="panel">
                    <div className="filter-bar">
                      <div className="input-search">
                        <Search size={17} />
                        <input
                          aria-label="Search documents"
                          placeholder="Search documents or individuals…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </div>
                      <span className="muted">
                        Version history is always retained
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Document</th>
                            <th>Site</th>
                            <th>Version</th>
                            <th>Effective date</th>
                            <th>Status</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {data.plans
                            .filter(
                              (p) =>
                                (site === "All sites" || p.site === site) &&
                                (status === "All statuses" ||
                                  p.status === status) &&
                                p.name
                                  .toLowerCase()
                                  .includes(query.toLowerCase()),
                            )
                            .map((p) => (
                              <tr key={p.id}>
                                <td>
                                  <button
                                    className="document-name"
                                    onClick={() => setPlan(p)}
                                  >
                                    <span className="file-icon">
                                      <FileText size={18} />
                                    </span>
                                    <span>
                                      <strong>{p.name}</strong>
                                      <small>
                                        {p.pages} pages · Sample document record
                                      </small>
                                    </span>
                                  </button>
                                </td>
                                <td>{p.site}</td>
                                <td>
                                  <span className="version">{p.version}</span>
                                </td>
                                <td>{formatDateLong(p.effective)}</td>
                                <td>
                                  <Badge status={p.status} />
                                </td>
                                <td>
                                  <button
                                    className="icon-button"
                                    aria-label={`Open ${p.name} ${p.version}`}
                                    onClick={() => setPlan(p)}
                                  >
                                    <ArrowUpRight size={17} />
                                  </button>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              )}
              {page === "Audit center" && (
                <>
                  <PageHeading
                    eyebrow="READY WHEN IT MATTERS."
                    title="An audit starts with confidence."
                    description="Find the records you need, see the gaps, and export a focused evidence register."
                  >
                    <span className="audit-mode">
                      <LockKeyhole size={15} /> Read-only audit view
                    </span>
                  </PageHeading>
                  <div className="audit-intro">
                    <ShieldCheck size={27} />
                    <div>
                      <strong>Your evidence, brought together.</strong>
                      <p>
                        Choose a scope below. The export includes each
                        requirement, owner, source reference, and available
                        completion evidence.
                      </p>
                    </div>
                  </div>
                  <section className="panel audit-filters">
                    <label>
                      Program site
                      <select
                        value={site}
                        onChange={(e) => {
                          setSite(e.target.value);
                          setAuditPerson("All individuals");
                          setAuditOwner("All staff");
                        }}
                      >
                        <option>All sites</option>
                        {sites.map((s) => (
                          <option key={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Individual
                      <select
                        value={auditPerson}
                        onChange={(e) => setAuditPerson(e.target.value)}
                      >
                        <option>All individuals</option>
                        {individuals
                          .filter(
                            (p) => site === "All sites" || p.site === site,
                          )
                          .map((p) => (
                            <option key={p.id}>{p.name}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      Staff member
                      <select
                        value={auditOwner}
                        onChange={(e) => setAuditOwner(e.target.value)}
                      >
                        <option>All staff</option>
                        {staff.map((s) => (
                          <option key={s.name}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Category
                      <select
                        value={auditCategory}
                        onChange={(e) => setAuditCategory(e.target.value)}
                      >
                        <option>All categories</option>
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Due from
                      <input
                        type="date"
                        value={auditFrom}
                        onChange={(e) => setAuditFrom(e.target.value)}
                      />
                    </label>
                    <label>
                      Due through
                      <input
                        type="date"
                        value={auditTo}
                        onChange={(e) => setAuditTo(e.target.value)}
                      />
                    </label>
                  </section>
                  {auditFrom > auditTo && (
                    <div className="inline-error">
                      The end date must be on or after the start date.
                    </div>
                  )}
                  <div className="audit-summary">
                    <div>
                      <strong>{auditItems.length}</strong>
                      <span>Matching requirements</span>
                    </div>
                    <div>
                      <strong className="positive">
                        {metrics(auditItems).done}
                      </strong>
                      <span>Completion records</span>
                    </div>
                    <div>
                      <strong className="overdue-text">
                        {
                          auditItems.filter((r) => r.status !== "Compliant")
                            .length
                        }
                      </strong>
                      <span>Open or pending items</span>
                    </div>
                    {canExportAudit && (
                    <button
                      className="button primary"
                      disabled={!auditItems.length || auditFrom > auditTo}
                      onClick={() => {
                        download(
                          "complyrer-sample-audit-register.csv",
                          exportCsv(auditItems),
                        );
                        notify(
                          "Your filtered audit register has been downloaded.",
                        );
                      }}
                    >
                      <Download size={17} /> Export audit register
                    </button>
                    )}
                  </div>
                  <div className="quiet-note">
                    <CircleAlert size={15} /> Sample register only. Original
                    signed documents and secure auditor sharing are not
                    connected in this preview.
                  </div>
                  <section className="panel">
                    <RequirementTable
                      items={auditItems}
                      onSelect={selectRequirement}
                    />
                  </section>
                </>
              )}
              {page === "Acknowledgments" && (
                <>
                  <PageHeading
                    eyebrow="ONE SHEET. EVERY SIGNATURE."
                    title="PCSP acknowledgment sheets"
                    description="Every assigned staff member appears on one sheet. Export includes blanks for anyone who has not signed."
                  />
                  <section className="panel">
                    {workspace.packets.length ? (
                      <div className="table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Individual</th>
                              <th>Document</th>
                              <th>Signed</th>
                              <th>Pending</th>
                              <th>Status</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {workspace.packets
                              .filter(
                                (item) =>
                                  site === "All sites" ||
                                  item.site.name === site,
                              )
                              .map((item) => (
                                <tr key={item.packet.id}>
                                  <td>
                                    <button
                                      className="table-title"
                                      onClick={() => setPacket(item)}
                                    >
                                      {item.individual.fullName}
                                    </button>
                                    <span className="cell-sub">
                                      DOB {formatDate(item.individual.dateOfBirth)}
                                    </span>
                                  </td>
                                  <td>{item.packet.whatAcknowledging}</td>
                                  <td>
                                    {item.rows.filter((row) => row.signedAt).length}
                                  </td>
                                  <td>
                                    {item.rows.filter((row) => !row.signedAt).length}
                                  </td>
                                  <td>
                                    <Badge
                                      status={
                                        item.packet.status === "open"
                                          ? "Open"
                                          : "Archived"
                                      }
                                    />
                                  </td>
                                  <td>
                                    <button
                                      className="text-button"
                                      onClick={() => setPacket(item)}
                                    >
                                      Open sheet <ArrowRight size={14} />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="No acknowledgment sheets yet"
                        text="Approve an uploaded PCSP to build a roster from assigned staff."
                      />
                    )}
                  </section>
                </>
              )}
              {page === "Activity log" && (
                <>
                  <PageHeading
                    eyebrow="EVERY ACTION HAS A STORY."
                    title="A clear record of what happened."
                    description="Follow document changes, approvals, and completion evidence across your agency."
                  />
                  <section className="panel timeline-panel">
                    {data.activity.map((a) => (
                      <div className="timeline-row" key={a.id}>
                        <span
                          className={`activity-icon ${a.kind === "complete" ? "green" : a.kind === "alert" ? "red" : "purple"}`}
                        >
                          {a.kind === "complete" ? (
                            <Check size={17} />
                          ) : a.kind === "alert" ? (
                            <CircleAlert size={17} />
                          ) : (
                            <FileText size={17} />
                          )}
                        </span>
                        <div>
                          <h3>{a.text}</h3>
                          <p>{a.detail}</p>
                        </div>
                        <time>
                          {new Date(a.time).toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    ))}
                  </section>
                  <p className="quiet-note">
                    This local demonstration timeline is editable browser data.
                    A tamper-resistant server audit trail is part of the
                    production architecture.
                  </p>
                </>
              )}
              {page === "Platform" && (
                <PlatformConsole onSaved={notify} />
              )}
              {page === "Roles & access" && (
                <RolesAccessPage onSaved={notify} />
              )}
                            {/* LIFEPATH-P2-PAGE (training engine) */}
              {page === "Training" && <StaffCompliancePage onSaved={notify} />}
              {/* LIFEPATH-P3-PAGE (delegation forms) */}
              {/* LIFEPATH-P4-PAGE (certificates) */}
              {/* LIFEPATH-P5-PAGE (HM weekly checklist) */}
              {/* LIFEPATH-P6-PAGE (med inventory) */}
              {page === "Settings" && (
                <>
                  <PageHeading
                    title="Your workspace, thoughtfully set up."
                    description="Agency details and the boundaries of this product preview."
                  />
                  <section className="panel settings-panel">
                    <h2>{session.agencyName}</h2>
                    <p>
                      Provider code {session.agencyCode} · {sites.length} sites ·{" "}
                      {individuals.length} individuals · {staff.length} staff ·{" "}
                      {session.jobTitle}
                    </p>
                    <div className="settings-row">
                      <span>
                        <strong>Provider code</strong>
                        <small>
                          {session.agencyCode} is how every staff member signs
                          in. It cannot be changed after setup.
                        </small>
                      </span>
                      <Badge status={session.agencyCode} />
                    </div>
                    <div className="settings-row">
                      <span>
                        <strong>Workspace mode</strong>
                        <small>
                          {usingHostedBackend
                            ? "Hosted Supabase Auth, RLS, and private storage."
                            : "Schema-faithful local workspace. Add VITE_SUPABASE_URL to connect hosted backend."}
                        </small>
                      </span>
                      <Badge
                        status={
                          usingHostedBackend ? "Hosted backend" : "Local workspace"
                        }
                      />
                    </div>
                    <div className="settings-row">
                      <span>
                        <strong>Access and permissions</strong>
                        <small>
                          Signed in as {session.fullName} ({session.username}).
                          Template roles can be assigned and their access levels
                          adjusted by an administrator.
                        </small>
                      </span>
                      {canAssign ? (
                        <button
                          className="button"
                          onClick={() => navigate("Roles & access")}
                        >
                          <KeyRound size={16} /> Roles & access
                        </button>
                      ) : canInvite ? (
                        <button
                          className="button"
                          onClick={() => setModal("invite")}
                        >
                          <UserPlus size={16} /> Add member
                        </button>
                      ) : (
                        <LockKeyhole size={20} />
                      )}
                    </div>
                    <AgencyLogoSettings onSaved={notify} />
                    <MonthlyDueSettings onSaved={notify} />
                    <div className="settings-row">
                      <span>
                        <strong>Document intelligence</strong>
                        <small>
                          Manual review workflow. AI extraction and
                          notifications are not connected.
                        </small>
                      </span>
                      <Sparkles size={20} />
                    </div>
                    <div className="settings-row">
                      <span>
                        <strong>Data handling</strong>
                        <small>
                          Use fictional records only. This preview is not
                          configured to store sensitive care data.
                        </small>
                      </span>
                      <ShieldCheck size={20} />
                    </div>
                    {!usingHostedBackend && (
                      <button
                        className="button danger"
                        onClick={() => setModal("reset")}
                      >
                        <RotateCcw size={16} /> Reset sample workspace
                      </button>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </main>
        <div className="demo-strip">
          <span className="demo-dot" /> INTERACTIVE PREVIEW{" "}
          <span>Fictional records. Real possibilities.</span>
          <button onClick={() => setModal("help")}>
            About this workspace <ArrowUpRight size={12} />
          </button>
        </div>
      </div>
      {toast && (
        <div role="status" className="toast">
          <CheckCheck size={18} />
          {toast}
          <button
            onClick={() => setToast("")}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      )}
      {selected && (
        <Modal
          title={
            selected.status === "Pending review"
              ? "Review requirement"
              : "Requirement details"
          }
          onClose={() => setSelectedId(null)}
        >
          <div className="detail-status">
            <span className="detail-status-left">
              <Badge status={selected.status} />
              <span>{selected.id}</span>
            </span>
            {!auditMode && canManage && selected.status !== "Compliant" && (
              <button className="link-button" onClick={openEdit}>
                <PenLine size={14} /> Edit
              </button>
            )}
          </div>
          <h2 className="detail-title">{selected.title}</h2>
          <p className="detail-subtitle">
            {selected.person} · {selected.site}
          </p>
          <div className="detail-grid">
            <div>
              <small>RESPONSIBLE PERSON</small>
              <strong>{selected.owner}</strong>
              <span>{selected.role}</span>
            </div>
            <div>
              <small>DUE DATE</small>
              <strong>{formatDateLong(selected.due)}</strong>
              <span>{selected.frequency}</span>
            </div>
          </div>
          <h3 className="section-label">Source of this requirement</h3>
          <SourceCard item={selected} onClick={() => setModal("source")} />
          {selected.status === "Compliant" ? (
            <div className="evidence-confirmed">
              <CheckCheck size={20} />
              <div>
                <strong>Completion evidence recorded</strong>
                <p>{selected.evidence}</p>
                <small>
                  {selected.completedAt
                    ? new Date(selected.completedAt).toLocaleString()
                    : ""}
                </small>
              </div>
            </div>
          ) : selected.status === "Pending review" ? (
            <>
              <div className="review-callout">
                <Sparkles size={20} />
                <div>
                  <strong>Your judgment comes first.</strong>
                  <p>
                    Confirm the source, owner, frequency, and due date. This
                    draft will become an active obligation only when you approve
                    it.
                  </p>
                </div>
              </div>
              {!auditMode && canManage && (
                <>
                  <label className="form-label">
                    Assign responsibility
                    <select
                      value={
                        staff.find((s) => s.name === selected.owner)?.id ?? ""
                      }
                      onChange={async (e) => {
                        try {
                          await api.reassignRequirement(
                            selected.id,
                            e.target.value,
                          );
                          await refresh();
                        } catch (err) {
                          setFormError((err as Error).message);
                        }
                      }}
                    >
                      {staff
                        .filter(
                          (s) =>
                            s.site === selected.site || s.site === "Agency-wide",
                        )
                        .map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                    </select>
                    <span className="form-help">
                      Only staff assigned to {selected.site} or agency-wide are
                      listed.
                    </span>
                  </label>
                  <button
                    className="button primary full"
                    onClick={() =>
                      setConfirm({
                        title: "Approve this requirement?",
                        body: `“${selected.title}” will become an active obligation for ${selected.owner}. Earlier plan versions are retained.`,
                        action: "Approve & activate",
                        run: approve,
                      })
                    }
                  >
                    <Check size={17} /> Approve & activate requirement
                  </button>
                </>
              )}
            </>
          ) : !auditMode && canCompleteWork ? (
            <>
              <h3 className="section-label">Record a completion</h3>
              <p className="form-help">
                Describe the evidence or enter its reference. Saving this
                confirms completion in the sample workspace.
              </p>
              <label className="form-label">
                Completion evidence
                <textarea
                  value={evidence}
                  onChange={(e) => setEvidence(e.target.value)}
                  placeholder="e.g. Signed acknowledgment on file, reference ACK-2026-014"
                  rows={3}
                  required
                />
              </label>
              {formError && (
                <p className="inline-error" role="alert">
                  {formError}
                </p>
              )}
              <button
                className="button primary full"
                onClick={() =>
                  setConfirm({
                    title: "Mark this requirement complete?",
                    body: `“${selected.title}” will be recorded as complete with the evidence entered above.`,
                    action: "Save completion",
                    run: finishRequirement,
                  })
                }
              >
                <CheckCheck size={17} /> Save completion evidence
              </button>
            </>
          ) : (
            <div className="quiet-note">
              <LockKeyhole size={15} /> Audit mode displays records without
              editing.
            </div>
          )}
        </Modal>
      )}
      {confirm && (
        <Modal title={confirm.title} onClose={() => setConfirm(null)}>
          <p className="confirm-body">{confirm.body}</p>
          <div className="confirm-actions">
            <button className="button" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button
              className="button primary"
              onClick={() => {
                const run = confirm.run;
                setConfirm(null);
                run();
              }}
            >
              {confirm.action}
            </button>
          </div>
        </Modal>
      )}
      {editDraft && selected && (
        <Modal title="Correct requirement" onClose={() => setEditDraft(null)}>
          <p className="form-help">
            Fix a title, owner, due date, or frequency. The correction is
            written to the audit trail, so the original record is never
            silently rewritten.
          </p>
          <label className="form-label">
            Title
            <input
              value={editDraft.title}
              onChange={(e) =>
                setEditDraft({ ...editDraft, title: e.target.value })
              }
              required
            />
          </label>
          <div className="form-two">
            <label className="form-label">
              Owner
              <select
                value={editDraft.ownerUserId}
                onChange={(e) =>
                  setEditDraft({ ...editDraft, ownerUserId: e.target.value })
                }
              >
                {staff
                  .filter(
                    (s) =>
                      s.site === selected.site || s.site === "Agency-wide",
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="form-label">
              Due date
              <input
                type="date"
                value={editDraft.due}
                onChange={(e) =>
                  setEditDraft({ ...editDraft, due: e.target.value })
                }
                required
              />
            </label>
          </div>
          <label className="form-label">
            Frequency
            <select
              value={editDraft.frequency}
              onChange={(e) =>
                setEditDraft({ ...editDraft, frequency: e.target.value })
              }
            >
              <option>On plan update</option>
              <option>Daily</option>
              <option>Weekly</option>
              <option>Monthly</option>
              <option>Annually</option>
              <option>One time</option>
            </select>
          </label>
          {formError && (
            <p className="inline-error" role="alert">
              {formError}
            </p>
          )}
          <div className="confirm-actions">
            <button className="button" onClick={() => setEditDraft(null)}>
              Cancel
            </button>
            <button className="button primary" onClick={saveEdit}>
              Save correction
            </button>
          </div>
        </Modal>
      )}
      {plan && (
        <Modal title="Document record & history" onClose={() => setPlan(null)}>
          <div className="detail-status">
            <Badge status={plan.status} />
            <span>{plan.version}</span>
          </div>
          <h2 className="detail-title">{plan.name}</h2>
          <p className="detail-subtitle">
            {plan.site} · {plan.pages} pages · Effective{" "}
            {formatDateLong(plan.effective)}
          </p>
          <div className="review-callout">
            <FileText size={22} />
            <div>
              <strong>Sample document record</strong>
              <p>
                This preview contains a document index and linked requirements.
                An original PDF is not stored or available for this fictional
                record.
              </p>
            </div>
          </div>
          <h3 className="section-label">Version history</h3>
          <div className="version-list">
            {data.plans
              .filter((p) => p.name === plan.name)
              .sort((a, b) => b.effective.localeCompare(a.effective))
              .map((p) => (
                <div key={p.id}>
                  <span>
                    <strong>{p.version}</strong>
                    <small>Effective {formatDateLong(p.effective)}</small>
                  </span>
                  <Badge status={p.status} />
                </div>
              ))}
          </div>
          <button
            className="button full"
            onClick={() => {
              setPlan(null);
              setPerson(null);
              navigate("Requirements");
              setQuery(plan.person);
            }}
          >
            View related requirements <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {modal === "add-site" && (
        <Modal title="Add a program site" onClose={() => setModal(null)}>
          <AddSiteForm
            onCreated={(name) => {
              setModal(null);
              setSite(name);
              notify(`${name} is ready. Add people to this home next.`);
            }}
          />
        </Modal>
      )}
      {modal === "add-person" && (
        <Modal
          title="Add a person"
          onClose={() => {
            setModal(null);
            setAddPersonSiteId(null);
          }}
        >
          <AddIndividualForm
            initialSiteId={
              addPersonSiteId ??
              (site !== "All sites"
                ? sites.find((row) => row.name === site)?.id ?? null
                : null)
            }
            onCreated={(name, uploaded) => {
              setAddPersonSiteId(null);
              setModal(null);
              openPersonChart(name);
              notify(
                uploaded
                  ? `${name} was added. The PCSP is in Review queue.`
                  : `${name} was added. Upload a PCSP when you have it.`,
              );
            }}
          />
        </Modal>
      )}
      {(modal === "upload" || modal === "new") && (
        <CreateForm
          upload={modal === "upload"}
          onClose={() => setModal(null)}
          individuals={individuals}
          staff={staff}
          plans={data.plans}
          onSave={async (payload) => {
            if (payload.file) {
              await api.uploadDocument({
                individualId: payload.individualId,
                file: payload.file,
                pageCount: payload.pageCount,
                effectiveOn: payload.dueOn,
                requirementTitle: payload.title,
                category: payload.category,
                ownerUserId: payload.ownerUserId,
                dueOn: payload.dueOn,
                frequency: payload.frequency,
                sourcePage: payload.sourcePage,
              });
            } else {
              await api.createRequirementDraft({
                individualId: payload.individualId,
                title: payload.title,
                category: payload.category,
                ownerUserId: payload.ownerUserId,
                source: payload.source,
                sourcePage: payload.sourcePage,
                dueOn: payload.dueOn,
                frequency: payload.frequency,
              });
            }
            await refresh();
            setModal(null);
            navigate("Review queue");
            notify(
              "Draft created. Review and approve it before it becomes active.",
            );
          }}
        />
      )}
      {modal === "source" && selected && (
        <Modal title="Source reference" onClose={() => setModal(null)}>
          <span className="file-icon">
            <FileText size={24} />
          </span>
          <h2 className="detail-title">{selected.source}</h2>
          <p>
            Page {selected.page} · {selected.id}
          </p>
          <div className="review-callout">
            <BookOpen size={22} />
            <div>
              <strong>Requirement linked to this source</strong>
              <p>{selected.title}</p>
              <p>
                Responsible: {selected.owner}
                <br />
                Frequency: {selected.frequency}
                <br />
                Individual: {selected.person}
              </p>
            </div>
          </div>
          <p className="form-help">
            This is a sample source reference. The original document text is not
            included in the preview; always verify a real obligation against its
            approved source.
          </p>
        </Modal>
      )}
      {modal === "copilot" && (
        <Modal title="Ask Complyrer" onClose={() => setModal(null)}>
          <div className="copilot-welcome">
            <span>
              <Sparkles size={26} />
            </span>
            <h2>A clearer path to audit-ready.</h2>
            <p>
              Find the right requirement, the right person, and the next step.
            </p>
          </div>
          <div className="copilot-disclosure">
            Preview · Grounded lookups in sample records · {site}
          </div>
          <div className="suggested-questions">
            {[
              "What should we fix before an audit?",
              "Which delegations are expiring?",
              "Who needs to acknowledge Jodie’s PCSP?",
            ].map((q) => (
              <button key={q} onClick={() => askCopilot(q)}>
                {q}
                <ArrowUpRight size={15} />
              </button>
            ))}
          </div>
          {answer && (
            <div className="copilot-answer" aria-live="polite">
              <strong>
                <Sparkles size={15} /> From your compliance records
              </strong>
              <p>{answer.text}</p>
              {answer.items.map((r) => (
                <button
                  className="answer-source"
                  key={r.id}
                  onClick={() => {
                    setModal(null);
                    selectRequirement(r);
                  }}
                >
                  <span>
                    {r.title}
                    <small>
                      {r.person} · {r.owner} · {r.source}, p. {r.page}
                    </small>
                  </span>
                  <Badge status={r.status} />
                </button>
              ))}
            </div>
          )}
          <form
            className="copilot-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (copilotQuestion.trim()) askCopilot(copilotQuestion);
            }}
          >
            <input
              aria-label="Ask a compliance question"
              value={copilotQuestion}
              onChange={(e) => setCopilotQuestion(e.target.value)}
              placeholder="What would you like clarity on?"
            />
            <button
              aria-label="Send question"
              disabled={!copilotQuestion.trim()}
            >
              <ArrowRight size={18} />
            </button>
          </form>
        </Modal>
      )}
      {modal === "notifications" && (
        <Modal title="Your notifications" onClose={() => setModal(null)}>
          <p className="form-help">
            Sample activity and open priorities. Email reminders are not
            connected.
          </p>
          {alertItems.length === 0 ? (
            <Empty
              title="All caught up"
              text="No overdue items or drafts waiting on review."
            />
          ) : (
            alertItems.map((r) => (
              <button
                key={r.id}
                className="notification-row"
                onClick={() => {
                  setModal(null);
                  selectRequirement(r);
                }}
              >
                <span className="risk-icon red">
                  <CircleAlert size={17} />
                </span>
                <span>
                  <strong>{r.title}</strong>
                  <small>
                    {r.person} · {r.site}
                  </small>
                </span>
                <Badge status={r.status} />
              </button>
            ))
          )}
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="Welcome to Complyrer" onClose={() => setModal(null)}>
          <div className="help-brand">
            <img src="/favicon.svg" alt="" />
            <h2>Compliance, connected.</h2>
          </div>
          <p>
            Complyrer turns care plans, policies, and requirements into clear,
            trackable responsibilities—so your agency can focus on care with
            confidence.
          </p>
          <div className="help-steps">
            <div>
              <span>1</span>
              <p>
                <strong>Start with the source.</strong> Add a sample document
                record or requirement.
              </p>
            </div>
            <div>
              <span>2</span>
              <p>
                <strong>Put people in control.</strong> Review and approve a
                draft before it becomes active.
              </p>
            </div>
            <div>
              <span>3</span>
              <p>
                <strong>Close the loop.</strong> Record evidence and export your
                audit register.
              </p>
            </div>
          </div>
          <div className="quiet-note">
            This workspace uses signed-in roles, retained PDF uploads, human
            review, and a PCSP acknowledgment sheet. AI document analysis and
            email reminders are not connected. Do not enter real care or
            employee records until a hosted backend with RLS is verified.
          </div>
        </Modal>
      )}
      {modal === "agency" && (
        <Modal title="Agency workspace" onClose={() => setModal(null)}>
          <div className="agency-modal">
            <AgencyMark
              name={session.agencyName}
              logoUrl={workspace.branding.logoUrl}
              size={48}
            />
            <div>
              <h2>{session.agencyName}</h2>
              <p>
                {usingHostedBackend
                  ? "Hosted agency workspace"
                  : "Fictional demonstration agency"}
              </p>
            </div>
            <Check size={20} />
          </div>
          <div className="agency-details">
            <span>{sites.length} program sites</span>
            <span>{individuals.length} individuals</span>
            <span>{staff.length} team members</span>
          </div>
          <p className="form-help">
            Each agency’s records are isolated. Access is limited by role and
            assignment.
          </p>
          <button
            className="button full"
            onClick={() => {
              setModal(null);
              setSite("All sites");
              navigate("Overview");
            }}
          >
            View full agency overview <ArrowRight size={16} />
          </button>
        </Modal>
      )}
      {modal === "profile" && (
        <Modal title="Your profile" onClose={() => setModal(null)}>
          <div className="profile-heading">
            <Avatar name={session.fullName} color="peach" />
            <div>
              <h2>{session.fullName}</h2>
              <p>
                {session.jobTitle} · {session.username}
              </p>
            </div>
          </div>
          <p>
            You are signed in to {session.agencyName}. Your role controls who
            you can see, what you can approve, and which acknowledgment rows you
            may sign.
          </p>
          <button
            className="button full"
            onClick={() => {
              setModal(null);
              navigate("Settings");
            }}
          >
            <Settings size={16} /> Workspace settings
          </button>
          <button
            className="button full"
            onClick={async () => {
              await signOut();
            }}
          >
            <LogOut size={16} /> Sign out
          </button>
        </Modal>
      )}
      {modal === "invite" && (
        <Modal title="Add a member" onClose={() => setModal(null)}>
          <InviteMemberForm
            onCreated={() =>
              notify("Member account created. Share the credentials only once.")
            }
          />
        </Modal>
      )}
      {modal === "reset" && (
        <Modal title="Reset sample workspace?" onClose={() => setModal(null)}>
          <p>
            This removes your local demo changes, including draft requirements
            and completion notes, and restores the original fictional records.
          </p>
          <div className="modal-actions">
            <button className="button" onClick={() => setModal(null)}>
              Keep my changes
            </button>
            <button
              className="button danger"
              onClick={async () => {
                await api.resetWorkspace();
                await signOut();
                setModal(null);
                setSite("All sites");
                notify("The original sample workspace has been restored.");
              }}
            >
              Reset sample data
            </button>
          </div>
        </Modal>
      )}
      {packet && (
        <Modal
          title="PCSP acknowledgment sheet"
          onClose={() => setPacket(null)}
          wide
        >
          <AcknowledgmentSheet
            detail={
              workspace.packets.find((item) => item.packet.id === packet.packet.id) ??
              packet
            }
            onClose={() => setPacket(null)}
          />
        </Modal>
      )}
    </div>
  );
}
function CreateForm({
  upload,
  onClose,
  onSave,
  individuals,
  staff,
}: {
  upload: boolean;
  onClose: () => void;
  individuals: { id: string; name: string; site: string }[];
  staff: { id: string; name: string; site: string }[];
  plans: Plan[];
  onSave: (payload: {
    individualId: string;
    title: string;
    category: Requirement["category"];
    ownerUserId: string;
    source: string;
    sourcePage: number;
    dueOn: string;
    frequency: string;
    file?: File;
    pageCount: number;
  }) => Promise<void>;
}) {
  const [personId, setPersonId] = useState(individuals[0]?.id ?? "");
  const person = individuals.find((row) => row.id === personId) ?? individuals[0];
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<Requirement["category"]>(
    "PCSP acknowledgments",
  );
  return (
    <Modal
      title={upload ? "Upload a PCSP" : "Create a requirement draft"}
      onClose={onClose}
    >
      <p className="form-help">
        {upload
          ? "The PDF is retained as a versioned source document. Describe one requirement for human review. AI extraction is not connected."
          : "Create a traceable draft. A manager must review and approve it before staff can record completion."}
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (upload && !file) {
            setError("Choose a PDF document first.");
            return;
          }
          const title = String(f.get("title")).trim();
          const source = upload
            ? `${person.name} · PCSP upload`
            : String(f.get("source"));
          if (!title || !source.trim()) {
            setError("Enter a requirement title and source reference.");
            return;
          }
          const pageCount = Number(f.get("pages") || 1);
          const sourcePage = Number(f.get("page"));
          if (upload && sourcePage > pageCount) {
            setError("The source page cannot exceed the document’s page count.");
            return;
          }
          setBusy(true);
          try {
            await onSave({
              individualId: person.id,
              title,
              category,
              ownerUserId: String(f.get("owner")),
              source,
              sourcePage,
              dueOn: String(f.get("due")),
              frequency: String(f.get("frequency")),
              file: file ?? undefined,
              pageCount,
            });
          } catch (err) {
            setError((err as Error).message);
            setBusy(false);
          }
        }}
      >
        {upload && (
          <label className="upload-zone">
            <Upload size={25} />
            <strong>{file ? file.name : "Choose a PDF"}</strong>
            <span>Fictional documents only · PDF up to 10 MB · file is stored</span>
            <input
              aria-label="Choose sample PDF"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (chosen) {
                  if (
                    !chosen.name.toLowerCase().endsWith(".pdf") ||
                    chosen.size > 10 * 1024 * 1024
                  ) {
                    setError("Choose a PDF smaller than 10 MB.");
                    setFile(null);
                    e.target.value = "";
                  } else {
                    setFile(chosen);
                    setError("");
                  }
                }
              }}
            />
          </label>
        )}
        <label className="form-label">
          Individual
          <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
            {individuals.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Requirement
          <input
            name="title"
            required
            maxLength={180}
            placeholder="e.g. Acknowledge the updated supervision plan"
          />
        </label>
        <div className="form-two">
          <label className="form-label">
            Category
            <select
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as Requirement["category"])
              }
            >
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Responsible person
            <select name="owner" key={personId}>
              {staff
                .filter(
                  (s) => s.site === person.site || s.site === "Agency-wide",
                )
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {!upload && (
          <label className="form-label">
            Source document & version
            <input
              name="source"
              required
              placeholder="e.g. Jodie Williams · PCSP 2026 · v2"
            />
          </label>
        )}
        <div className="form-two">
          <label className="form-label">
            {upload ? "Effective / first due date" : "Due date"}
            <input
              type="date"
              name="due"
              required
              defaultValue="2026-09-18"
            />
          </label>
          <label className="form-label">
            Frequency
            <select name="frequency">
              <option>On plan update</option>
              <option>Daily</option>
              <option>Weekly</option>
              <option>Monthly</option>
              <option>Annually</option>
              <option>One time</option>
            </select>
          </label>
        </div>
        <div className="form-two">
          <label className="form-label">
            Source page
            <input
              type="number"
              name="page"
              min="1"
              max="9999"
              required
              defaultValue="1"
            />
          </label>
          {upload && (
            <label className="form-label">
              Document page count
              <input
                type="number"
                name="pages"
                min="1"
                max="9999"
                required
                defaultValue="1"
              />
            </label>
          )}
        </div>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="button primary full" type="submit" disabled={busy}>
          <ClipboardCheck size={17} /> Save draft for review
        </button>
      </form>
    </Modal>
  );
}
