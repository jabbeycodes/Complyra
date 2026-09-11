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
} from "lucide-react";
import Dashboard from "./Dashboard";
import {
  Avatar,
  Badge,
  Empty,
  FilterBar,
  Modal,
  PageHeading,
  RequirementTable,
  SourceCard,
  formatDate,
} from "./components";
import {
  categories,
  exportCsv,
  metrics,
} from "./domain";
import type { Plan, Requirement } from "./domain";
import AuthEntry from "./auth/AuthEntry";
import ChangePasswordScreen from "./auth/ChangePasswordScreen";
import AcknowledgmentSheet from "./features/AcknowledgmentSheet";
import InviteMemberForm from "./features/InviteMemberForm";
import { useData } from "./data/DataProvider";
import { isAgencyAdmin, isPrivileged } from "./data/status";
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
  const [person, setPerson] = useState<string | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [packet, setPacket] = useState<PacketDetail | null>(null);
  const [globalQuery, setGlobalQuery] = useState("");
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [evidence, setEvidence] = useState("");
  const [formError, setFormError] = useState("");
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
  }, [session?.userId]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setGlobalQuery("");
        setMobileOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  if (loading) {
    return <div className="login-shell">Loading workspace…</div>;
  }
  if (!session) {
    return <AuthEntry />;
  }
  if (session.mustChangePassword) {
    return <ChangePasswordScreen />;
  }
  if (!workspace) {
    return <div className="login-shell">Loading workspace…</div>;
  }
  const sites = workspace.sites;
  const individuals = workspace.individuals;
  const staff = workspace.staff;
  const data = {
    requirements: workspace.requirements,
    plans: workspace.plans,
    activity: workspace.activity,
  };
  const selected = selectedId
    ? (data.requirements.find((r) => r.id === selectedId) ?? null)
    : null;
  const canManage = isPrivileged(session.role);
  const scoped = data.requirements.filter(
    (r) => site === "All sites" || r.site === site,
  );
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
    setPage(next);
    setStatus(nextStatus);
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
        ["Individuals", Users],
        ["Sites & programs", Building2],
        ["Staff", Users],
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
          className="brand"
          onClick={() => navigate("Overview")}
          aria-label="Complyra home"
        >
          <img src="/favicon.svg" alt="" />
          <span>
            complyra<span className="brand-period">.</span>
          </span>
        </button>
        <div className="brand-tagline">COMPLIANCE, CONNECTED.</div>
        <button className="agency-picker" onClick={() => setModal("agency")}>
          <span className="agency-mark">
            <Building2 size={20} />
          </span>
          <span>
            <strong>{session.agencyName}</strong>
            <small>{usingHostedBackend ? "Hosted workspace" : "Local workspace"}</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <nav>
          {navItems.map((group) => (
            <div className="nav-group" key={group.title}>
              <div className="nav-label">{group.title}</div>
              {group.items.map(([name, Icon]) => (
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
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="assistant-card"
            onClick={() => setModal("copilot")}
          >
            <span className="assistant-card-top">
              <Sparkles size={18} />
              <span>YOUR COMPLIANCE PARTNER</span>
            </span>
            <strong>A little help, a lot of clarity.</strong>
            <span>
              Find answers in your agency’s
              <br />
              compliance records.
            </span>
            <b>
              Ask Complyra <ArrowUpRight size={15} />
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
              <i />
            </button>
            <Avatar name={session.fullName} color="peach" small />
          </div>
        </header>
        <main>
          {page === "Overview" ? (
            <Dashboard
              items={scoped}
              activity={data.activity}
              sites={sites}
              individuals={individuals}
              site={site}
              onSite={setSite}
              onNavigate={navigate}
              onRequirement={selectRequirement}
              onExport={() => {
                download(
                  "complyra-sample-compliance-report.csv",
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
                    {canManage && (
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
                        return (
                          <button
                            className="panel person-card"
                            key={p.id}
                            onClick={() => setPerson(p.name)}
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
              {page === "Sites & programs" && (
                <>
                  <PageHeading
                    eyebrow="ONE AGENCY. CONNECTED CARE."
                    title="A home for every detail."
                    description="See how each site is doing and give your team the support it needs."
                  />
                  <div className="list-controls">
                    <span>
                      {sites.length} program sites · 24 individuals · 2 programs
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
                    {sites
                      .filter((s) => site === "All sites" || s.name === site)
                      .map((s) => {
                        const sm = metrics(
                          data.requirements.filter((r) => r.site === s.name),
                        );
                        return (
                          <section className="panel location-card" key={s.name}>
                            <div className="location-top">
                              <span className={`house-icon ${s.color}`}>
                                <Building2 size={24} />
                              </span>
                              <Badge
                                status={
                                  sm.overdue ? "Needs attention" : "On track"
                                }
                              />
                            </div>
                            <h2>{s.name}</h2>
                            <p>{s.address}</p>
                            <span className="program-tag">{s.program}</span>
                            <div className="location-stat">
                              <strong>
                                {sm.score}
                                <small>%</small>
                              </strong>
                              <span>
                                compliance
                                <br />
                                readiness
                              </span>
                              <div>
                                {sm.overdue}
                                <small>overdue</small>
                              </div>
                            </div>
                            <div className="progress-track">
                              <span style={{ width: `${sm.score}%` }} />
                            </div>
                            <div className="location-manager">
                              <Avatar name={s.manager} small color={s.color} />
                              <span>
                                {s.manager}
                                <small>House manager</small>
                              </span>
                              <span className="muted">4 individuals</span>
                            </div>
                            <button
                              className="button full"
                              onClick={() => {
                                setSite(s.name);
                                navigate("Requirements");
                              }}
                            >
                              View site requirements <ArrowRight size={16} />
                            </button>
                          </section>
                        );
                      })}
                  </div>
                </>
              )}
              {page === "Staff" && (
                <>
                  <PageHeading
                    eyebrow="SUPPORTED TEAMS. CONSISTENT CARE."
                    title="Your people make it possible."
                    description="Keep every staff member connected to their assigned responsibilities."
                  >
                    {isAgencyAdmin(session.role) && (
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
                    {canManage && (
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
                                <td>{formatDate(p.effective)}, 2026</td>
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
                    <button
                      className="button primary"
                      disabled={!auditItems.length || auditFrom > auditTo}
                      onClick={() => {
                        download(
                          "complyra-sample-audit-register.csv",
                          exportCsv(auditItems),
                        );
                        notify(
                          "Your filtered audit register has been downloaded.",
                        );
                      }}
                    >
                      <Download size={17} /> Export audit register
                    </button>
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
              {page === "Settings" && (
                <>
                  <PageHeading
                    title="Your workspace, thoughtfully set up."
                    description="Agency details and the boundaries of this product preview."
                  />
                  <section className="panel settings-panel">
                    <h2>{session.agencyName}</h2>
                    <p>
                      Agency code {session.agencyCode} · {sites.length} sites ·{" "}
                      {individuals.length} individuals · {staff.length} staff ·{" "}
                      {session.role.replaceAll("_", " ")}
                    </p>
                    <div className="settings-row">
                      <span>
                        <strong>Agency code</strong>
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
                          Role enforcement is active for this workspace.
                        </small>
                      </span>
                      {isAgencyAdmin(session.role) ? (
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
            <Badge status={selected.status} />
            <span>{selected.id}</span>
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
              <strong>{formatDate(selected.due)}, 2026</strong>
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
                  </label>
                  <button className="button primary full" onClick={approve}>
                    <Check size={17} /> Approve & activate requirement
                  </button>
                </>
              )}
            </>
          ) : !auditMode ? (
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
                onClick={finishRequirement}
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
      {person && (
        <Modal
          title="Individual compliance profile"
          onClose={() => setPerson(null)}
          wide
        >
          <div className="profile-heading">
            <Avatar name={person} />
            <div>
              <h2>{person}</h2>
              <p>
                {individuals.find((p) => p.name === person)?.site} · DOB{" "}
                {individuals.find((p) => p.name === person)?.dateOfBirth
                  ? formatDate(
                      individuals.find((p) => p.name === person)!.dateOfBirth,
                    )
                  : "—"}
              </p>
            </div>
            <span className="profile-score">
              {
                metrics(data.requirements.filter((r) => r.person === person))
                  .score
              }
              %<small>readiness</small>
            </span>
          </div>
          <h3 className="section-label">Plans & version history</h3>
          <div className="plan-list">
            {data.plans
              .filter((p) => p.person === person)
              .map((p) => (
                <button key={p.id} onClick={() => setPlan(p)}>
                  <FileText size={18} />
                  <span>
                    {p.name}
                    <small>
                      {p.version} · Effective {formatDate(p.effective)}
                    </small>
                  </span>
                  <Badge status={p.status} />
                </button>
              ))}
          </div>
          <h3 className="section-label">Acknowledgment sheets</h3>
          <div className="plan-list">
            {workspace.packets
              .filter((item) => item.individual.fullName === person)
              .map((item) => (
                <button key={item.packet.id} onClick={() => setPacket(item)}>
                  <PenLine size={18} />
                  <span>
                    {item.packet.whatAcknowledging}
                    <small>
                      {item.rows.filter((row) => row.signedAt).length}/
                      {item.rows.length} signed
                    </small>
                  </span>
                  <Badge
                    status={item.packet.status === "open" ? "Open" : "Archived"}
                  />
                </button>
              ))}
          </div>
          <h3 className="section-label">Assigned requirements</h3>
          <RequirementTable
            items={data.requirements.filter((r) => r.person === person)}
            onSelect={selectRequirement}
            compact
          />
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
            {formatDate(plan.effective)}, 2026
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
                    <small>Effective {formatDate(p.effective)}, 2026</small>
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
        <Modal title="Ask Complyra" onClose={() => setModal(null)}>
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
          {scoped
            .filter((r) =>
              ["Overdue", "Expired", "Pending review"].includes(r.status),
            )
            .map((r) => (
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
            ))}
        </Modal>
      )}
      {modal === "help" && (
        <Modal title="Welcome to Complyra" onClose={() => setModal(null)}>
          <div className="help-brand">
            <img src="/favicon.svg" alt="" />
            <h2>Compliance, connected.</h2>
          </div>
          <p>
            Complyra turns care plans, policies, and requirements into clear,
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
            <span className="agency-mark">
              <Building2 size={27} />
            </span>
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
