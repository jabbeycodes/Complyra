import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BadgeCheck,
  Bell,
  Briefcase,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  HeartPulse,
  LibraryBig,
  ListChecks,
  ListTodo,
  LogOut,
  MessageSquare,
  Monitor,
  Pill,
  Search,
  Users,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { ComplyRerWordmark } from "../../brand/ComplyrerBrand";
import type { ComplyraApi, WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import type { PersonalWorkItem } from "../../data/dashboard";
import { pageVisible, roleLabel } from "../../data/status";
import { sitesVisibleTo } from "../../data/dashboard";
import {
  isUnread,
  type NotificationRow,
} from "../notifications/notify";
import { mobileTiles, type MobileTileId } from "./tiles";
import { bottomNavItems, moreSheetTiles, type BottomNavId } from "./bottomNav";
import BottomNavPill from "./BottomNavPill";
import { centralHour, greetingForHour, type TrackingCategoryId } from "./today";
import { formatCentralTime } from "./mar";
import { useTodayTracking } from "./useTodayTracking";
import MobileToday from "./MobileToday";
import MobileComplianceCard from "./MobileComplianceCard";
import MobileComplianceBand from "./MobileComplianceBand";
import type { MobileNav } from "./types";
import MobileMar from "./MobileMar";
import MobileHealth from "./MobileHealth";
import MobileQuickLog from "./MobileQuickLog";
import MobileMessages from "./MobileMessages";
import MobileScheduling, { MobileYourShiftDetail } from "./MobileScheduling";
import { useYourShift } from "./useYourShift";
import { yourShiftText } from "./scheduling";
import MobileHouseCard from "./MobileHouseCard";
import MobilePersonalSpending from "./MobilePersonalSpending";
import MobileCarePlans from "./MobileCarePlans";
import MobileConsents from "./MobileConsents";
import MobileLifeEvents from "./MobileLifeEvents";
import MobileHub, { type HubSection } from "./MobileHub";
import MobileReports from "./MobileReports";
import MobileQaReview from "./MobileQaReview";
import MobileIsp from "./MobileIsp";
import MobilePeopleList from "./MobilePeopleList";
import "./mobile.css";

export type ShellView =
  | "home"
  | "sites"
  | "mar"
  | "isp"
  | "health"
  | "quicklog"
  | "messages"
  | "scheduling"
  | "yourshift"
  | "tasks"
  | "people"
  | "housecard"
  | "spending"
  | "careplans"
  | "consents"
  | "lifeevents"
  | "hub"
  | "reports"
  | "qa"
  | "notifications";

const TILE_ICONS: Record<MobileTileId, LucideIcon> = {
  medications: Pill,
  ispData: ClipboardList,
  health: HeartPulse,
  quickLog: Zap,
  messages: MessageSquare,
  scheduling: CalendarDays,
  timeClock: Clock,
  myHub: Briefcase,
  myTasks: ListTodo,
  individuals: Users,
  appointments: CalendarDays,
  checklists: ListChecks,
  houseCard: Wallet,
  reports: LibraryBig,
  qaReview: BadgeCheck,
};

const VIEW_TITLES: Partial<Record<ShellView, string>> = {
  sites: "Select your home",
  mar: "Medications",
  isp: "ISP Data",
  health: "Health",
  quicklog: "Quick log",
  messages: "Messages",
  scheduling: "Scheduling",
  yourshift: "Your shift",
  tasks: "My Tasks",
  people: "Individuals",
  housecard: "House Card",
  spending: "Personal spending",
  careplans: "Care plans",
  consents: "Consents",
  lifeevents: "Life events",
  hub: "My Hub",
  reports: "Report Library",
  qa: "QA Review",
  notifications: "Notifications",
};

const TONE_LABELS: Record<PersonalWorkItem["tone"], string> = {
  overdue: "Overdue",
  due: "Due",
  review: "Needs review",
};

function siteStorageKey(userId: string) {
  return `complyrer.mobileSite.${userId}`;
}

function initialsOf(fullName: string) {
  const parts = fullName.trim().split(/\s+/);
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return `${first}${last}`.toUpperCase();
}

export default function MobileShell({
  api,
  session,
  workspace,
  queueItems,
  onSignOut,
  onDesktopView,
  nav,
  startView,
  startSheetOpen,
}: {
  api: ComplyraApi;
  session: SessionUser;
  workspace: WorkspaceView;
  queueItems: PersonalWorkItem[];
  onSignOut: () => void;
  onDesktopView: () => void;
  nav: MobileNav;
  /**
   * Where the platform bottom navigation (on the desktop-layout pages)
   * asked the shell to open. Read once at mount — the shell remounts on
   * every return from a deep-linked page, so a fresh intent always lands
   * on a fresh mount. The home picker still wins when a multi-home user
   * has no remembered home: nothing is scoped until a home is picked.
   */
  startView?: ShellView;
  /** Open the More sheet on arrival (the pill's More destination). */
  startSheetOpen?: boolean;
}) {
  const sites = workspace.sites;
  const [siteId, setSiteId] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(siteStorageKey(session.userId));
    } catch {
      return null;
    }
  });
  const storedSite = sites.find((site) => site.id === siteId) ?? null;
  const scopedSite =
    storedSite ??
    sites.find((site) => site.id === session.siteId) ??
    sites[0] ??
    null;
  // Multi-home users with no remembered home pick one first (the shell's
  // home-first rule); single-home users skip straight in.
  const [view, setView] = useState<ShellView>(() =>
    sites.length > 1 && !storedSite ? "sites" : (startView ?? "home"),
  );
  const [siteQuery, setSiteQuery] = useState("");
  const [ispPersonId, setIspPersonId] = useState<string | null>(null);
  const [spendingPersonId, setSpendingPersonId] = useState<string | null>(
    null,
  );
  // The person whose chart sections (Care Plans / Consents / Life
  // Events) are open — set from the Health person view's rows.
  const [chartPersonId, setChartPersonId] = useState<string | null>(null);
  // Where the next hub entry should land: the home compliance band
  // deep-links to My Compliance; the hub tile starts at the hub home.
  const [hubStartSection, setHubStartSection] = useState<HubSection>("home");
  const staffNames = useMemo(
    () => new Map(workspace.staff.map((member) => [member.id, member.name])),
    [workspace.staff],
  );
  const [ispKey, setIspKey] = useState(0);
  const [ispFormActive, setIspFormActive] = useState(false);
  const [messagesInThread, setMessagesInThread] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState<boolean>(
    () => startSheetOpen ?? false,
  );
  const [notifRows, setNotifRows] = useState<NotificationRow[]>([]);

  const tiles = useMemo(
    () =>
      mobileTiles({
        roleKey: session.roleKey,
        permissions: session.permissions,
        canPage: (page) => pageVisible(session, page),
      }),
    [session],
  );
  const navItems = useMemo(() => bottomNavItems(tiles), [tiles]);
  const sheetTiles = useMemo(() => moreSheetTiles(tiles), [tiles]);

  const people = useMemo(
    () =>
      scopedSite
        ? workspace.individuals.filter(
            (person) => person.siteId === scopedSite.id,
          )
        : [],
    [workspace.individuals, scopedSite],
  );

  // Returning to the home view bumps the tracking refresh key exactly
  // once per return, so doses and entries recorded in the MAR/ISP flows
  // are reflected on the donut, Up next, and the greeting summary
  // without a page reload. No polling — a return is the only trigger.
  const [homeRefreshKey, setHomeRefreshKey] = useState(0);
  const previousView = useRef(view);
  useEffect(() => {
    if (previousView.current !== "home" && view === "home") {
      setHomeRefreshKey((key) => key + 1);
    }
    previousView.current = view;
  }, [view]);

  const tracking = useTodayTracking({
    api,
    session,
    siteId: scopedSite?.id ?? null,
    people,
    canChecklist: pageVisible(session, "Weekly checklist"),
    refreshKey: homeRefreshKey,
  });

  // The "Your shift" strip: the signed-in person's own shift today at
  // the picked home, with the accountability engine's counts for its
  // window. Managers tap through to the Scheduling board; everyone else
  // gets a read-only detail of their own shift. Absent entirely when
  // they have no shift today.
  const ownShift = useYourShift({
    api,
    session,
    siteId: scopedSite?.id ?? null,
    refreshKey: homeRefreshKey,
  });
  const canOpenScheduling = pageVisible(session, "Scheduling");
  const ownShiftText = ownShift.acc ? yourShiftText(ownShift.acc) : null;
  const ownShiftStrip = ownShift.acc && ownShiftText ? (
    <button
      type="button"
      className="msh-row msh-yourshift"
      onClick={() => setView(canOpenScheduling ? "scheduling" : "yourshift")}
    >
      <span className="msh-row-main">
        <strong>{ownShiftText.title}</strong>
        <small className="msh-status-text">{ownShiftText.detail}</small>
      </span>
      <span className="msh-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  ) : null;

  // Houses the Scheduling board may show this viewer — the desktop
  // page's own scoping (an HM's houses; PM/admin every house).
  const schedSites = useMemo(
    () => sitesVisibleTo(session, workspace.sites, workspace.staff),
    [session, workspace],
  );

  const refreshNotifications = useCallback(async () => {
    try {
      setNotifRows(await api.listNotifications());
    } catch {
      // The badge simply stays at its last known count.
    }
  }, [api]);

  useEffect(() => {
    void refreshNotifications();
  }, [refreshNotifications]);

  const unreadCount = notifRows.filter(isUnread).length;

  const markNotificationsRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    setNotifRows((rows) =>
      rows.map((row) =>
        ids.includes(row.id) && isUnread(row)
          ? { ...row, read_at: new Date().toISOString() }
          : row,
      ),
    );
    try {
      await api.markNotificationsRead(ids);
    } catch {
      void refreshNotifications();
    }
  };

  const filteredSites = useMemo(() => {
    const q = siteQuery.trim().toLowerCase();
    if (!q) return sites;
    return sites.filter(
      (site) =>
        site.name.toLowerCase().includes(q) ||
        session.agencyName.toLowerCase().includes(q),
    );
  }, [sites, siteQuery, session.agencyName]);

  const pickSite = (id: string) => {
    setSiteId(id);
    try {
      window.localStorage.setItem(siteStorageKey(session.userId), id);
    } catch {
      // Storage unavailable (private mode) — the pick still applies.
    }
    setView("home");
  };

  const openTile = (id: MobileTileId) => {
    switch (id) {
      case "medications":
        setView("mar");
        break;
      case "ispData":
        setIspPersonId(null);
        setIspKey((value) => value + 1);
        setView("isp");
        break;
      case "health":
        setView("health");
        break;
      case "quickLog":
        setView("quicklog");
        break;
      case "messages":
        setView("messages");
        break;
      case "scheduling":
        setView("scheduling");
        break;
      case "timeClock":
        nav.openPage("Employee Hub");
        break;
      case "myHub":
        setHubStartSection("home");
        setView("hub");
        break;
      case "reports":
        setView("reports");
        break;
      case "qaReview":
        setView("qa");
        break;
      case "myTasks":
        setView("tasks");
        break;
      case "individuals":
        setView("people");
        break;
      case "appointments":
        nav.openPage("Appointments");
        break;
      case "checklists":
        nav.openPage("Weekly checklist");
        break;
      case "houseCard":
        setView("housecard");
        break;
    }
  };

  const openIspForPerson = (personId: string) => {
    setIspPersonId(personId);
    setIspKey((value) => value + 1);
    setView("isp");
  };

  const openCategory = (id: TrackingCategoryId) => {
    if (id === "medications") setView("mar");
    else if (id === "ispData") openTile("ispData");
    else if (id === "checklists") nav.openPage("Weekly checklist");
  };

  const openQueueItem = (item: PersonalWorkItem) => {
    if (item.personName) nav.openPersonChart(item.personName);
    else nav.openPage("Overview");
  };

  const goNav = (id: BottomNavId) => {
    if (id === "more") {
      setSheetOpen(true);
      return;
    }
    if (id === "home") setView("home");
    else if (id === "tasks") setView("tasks");
    else if (id === "meds") setView("mar");
    else if (id === "people") setView("people");
  };

  const activeNav: BottomNavId | null =
    view === "home"
      ? "home"
      : view === "tasks"
        ? "tasks"
        : view === "people"
          ? "people"
          : null;

  // The pill shows on the home and list-level screens. It hides on the
  // home picker, in the MAR flow (the MAR's own Scheduled/PRN/Other bar
  // owns the bottom there), on the notifications surface, while the
  // ISP entry form is open, and while a message conversation is open
  // (the reply composer owns the bottom there) — never two bars stacked.
  const showBottomNav =
    view === "home" ||
    view === "tasks" ||
    view === "people" ||
    view === "health" ||
    view === "quicklog" ||
    view === "scheduling" ||
    view === "hub" ||
    view === "reports" ||
    view === "qa" ||
    (view === "messages" && !messagesInThread) ||
    (view === "isp" && !ispFormActive);

  const greeting = greetingForHour(centralHour());
  const firstName = session.fullName.split(" ")[0];
  const summaryParts: string[] = [];
  if (!tracking.loading && tracking.medsLeft !== null) {
    summaryParts.push(
      tracking.medsLeft > 0
        ? `${tracking.medsLeft} med dose${tracking.medsLeft === 1 ? "" : "s"} left to record`
        : "All med doses recorded",
    );
  }
  if (queueItems.length > 0) {
    summaryParts.push(
      `${queueItems.length} task${queueItems.length === 1 ? "" : "s"} due for you`,
    );
  }

  return (
    <div className="msh-shell">
      <header className="msh-header">
        <div className="msh-brand">
          <ComplyRerWordmark size={26} />
          {scopedSite && (
            <span className="msh-brand-home">• {scopedSite.name}</span>
          )}
        </div>
        <div className="msh-header-actions">
          <button
            type="button"
            className="msh-bell"
            aria-label={
              unreadCount > 0
                ? `Notifications, ${unreadCount} unread`
                : "Notifications"
            }
            onClick={() => {
              setMenuOpen(false);
              setView("notifications");
              void refreshNotifications();
            }}
          >
            <Bell size={21} aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="msh-bell-badge">{unreadCount}</span>
            )}
          </button>
          <div className="msh-avatar-wrap">
            <button
              type="button"
              className="msh-avatar-button"
              aria-label={`Account menu for ${session.fullName}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              {initialsOf(session.fullName)}
            </button>
            {menuOpen && (
              <>
                <button
                  type="button"
                  className="msh-menu-backdrop"
                  aria-label="Close account menu"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="msh-menu" role="menu">
                  <p className="msh-menu-head">
                    <strong>{session.fullName}</strong>
                    <small>
                      {roleLabel(session.roleKey, session.jobTitle)} ·{" "}
                      {session.agencyName}
                    </small>
                  </p>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setView("sites");
                    }}
                  >
                    Switch home
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDesktopView();
                    }}
                  >
                    <Monitor size={17} aria-hidden="true" /> Desktop view
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onSignOut();
                    }}
                  >
                    <LogOut size={17} aria-hidden="true" /> Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {view !== "home" && (
        <div className="msh-subheader">
          <button
            type="button"
            className="msh-text-button"
            onClick={() => setView("home")}
          >
            ‹ Home
          </button>
          <strong>{VIEW_TITLES[view]}</strong>
        </div>
      )}

      <main className={`msh-main${showBottomNav ? " with-nav" : ""}`}>
        {view === "home" && (
          <>
            <section className="msh-greeting">
              <p className="msh-greeting-eyebrow">
                {greeting}, {firstName}
              </p>
              <h1 className="msh-greeting-title">
                {scopedSite ? `Today at ${scopedSite.name}` : "Your day today"}
              </h1>
              <p className="msh-greeting-summary">
                {summaryParts.length > 0
                  ? summaryParts.join(" · ")
                  : "Nothing outstanding right now."}
              </p>
              <p className="msh-greeting-identity">
                {session.fullName} ·{" "}
                {roleLabel(session.roleKey, session.jobTitle)} ·{" "}
                {session.agencyName}
              </p>
            </section>

            {scopedSite && (
              <button
                type="button"
                className="msh-site-chip"
                onClick={() => setView("sites")}
                aria-label={`Current home ${scopedSite.name}. Switch home`}
              >
                <span className="msh-row-main">
                  <strong>{scopedSite.name}</strong>
                  <small>
                    {scopedSite.program} · {people.length} Individual
                    {people.length === 1 ? "" : "s"}
                  </small>
                </span>
                <ChevronDown size={20} aria-hidden="true" />
              </button>
            )}

            {scopedSite && (
              <MobileToday
                tracking={tracking}
                queueItems={queueItems}
                onOpenCategory={openCategory}
                onOpenTasks={() => setView("tasks")}
                onOpenMar={() => setView("mar")}
                onOpenQueueItem={openQueueItem}
                yourShift={ownShiftStrip}
                complianceBand={
                  <MobileComplianceBand
                    session={session}
                    workspace={workspace}
                    onOpenCompliance={() => {
                      setHubStartSection("compliance");
                      setView("hub");
                    }}
                    onOpenSite={pickSite}
                  />
                }
                complianceCard={
                  <MobileComplianceCard
                    session={session}
                    onOpen={() =>
                      nav.openMyCompliance
                        ? nav.openMyCompliance()
                        : nav.openPage("Employee Hub")
                    }
                  />
                }
              />
            )}

            <div className="msh-grid">
              {tiles.map((tile) => {
                const Icon = TILE_ICONS[tile.id];
                return (
                  <button
                    key={tile.id}
                    type="button"
                    className="msh-tile"
                    onClick={() => openTile(tile.id)}
                  >
                    <span className="msh-tile-icon" aria-hidden="true">
                      <Icon size={26} />
                    </span>
                    <strong>{tile.label}</strong>
                    <small>{tile.hint}</small>
                    {tile.id === "myTasks" && queueItems.length > 0 && (
                      <span className="msh-badge">{queueItems.length}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {view === "sites" && (
          <div>
            <p className="msh-section-note">
              Everything in the mobile view is scoped to the home you pick.
            </p>
            {sites.length > 6 && (
              <label className="msh-search">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={siteQuery}
                  onChange={(event) => setSiteQuery(event.target.value)}
                  placeholder="Search homes"
                  aria-label="Search homes"
                />
              </label>
            )}
            <div className="msh-list">
              {filteredSites.map((site) => (
                <button
                  key={site.id}
                  type="button"
                  className="msh-row"
                  onClick={() => pickSite(site.id)}
                >
                  <span
                    className="msh-avatar msh-avatar-initials"
                    aria-hidden="true"
                    style={{ background: site.color }}
                  >
                    {site.initials}
                  </span>
                  <span className="msh-row-main">
                    <strong>{site.name}</strong>
                    <small>
                      {session.agencyName} · {site.program}
                    </small>
                    <small>{site.address}</small>
                  </span>
                  {scopedSite?.id === site.id && (
                    <span className="msh-current">Current home</span>
                  )}
                </button>
              ))}
              {filteredSites.length === 0 && (
                <p className="msh-empty">No homes match your search.</p>
              )}
            </div>
          </div>
        )}

        {view === "mar" && scopedSite && (
          <MobileMar
            api={api}
            session={session}
            people={people}
            onOpenChart={nav.openPersonChart}
          />
        )}

        {view === "isp" && scopedSite && (
          <MobileIsp
            key={ispKey}
            api={api}
            session={session}
            people={people}
            siteId={scopedSite.id}
            siteName={scopedSite.name}
            initialPersonId={ispPersonId}
            onOpenChart={nav.openPersonChart}
            onFormActiveChange={setIspFormActive}
          />
        )}

        {view === "health" && scopedSite && (
          <MobileHealth
            api={api}
            session={session}
            people={people}
            onOpenChart={nav.openPersonChart}
            onOpenMedications={() => setView("mar")}
            onOpenSpending={(person) => {
              setSpendingPersonId(person.id);
              setView("spending");
            }}
            onOpenCarePlans={(person) => {
              setChartPersonId(person.id);
              setView("careplans");
            }}
            onOpenConsents={(person) => {
              setChartPersonId(person.id);
              setView("consents");
            }}
            onOpenLifeEvents={(person) => {
              setChartPersonId(person.id);
              setView("lifeevents");
            }}
          />
        )}

        {(view === "careplans" || view === "consents" || view === "lifeevents") &&
          (() => {
            const person = workspace.individuals.find(
              (row) => row.id === chartPersonId,
            );
            if (!person) {
              return (
                <p className="msh-empty">
                  Pick an Individual from the Health view to see this
                  section of their chart.
                </p>
              );
            }
            if (view === "careplans") {
              return (
                <MobileCarePlans
                  api={api}
                  session={session}
                  person={person}
                  staffNames={staffNames}
                  onOpenChart={nav.openPersonChart}
                  onBack={() => setView("health")}
                />
              );
            }
            if (view === "consents") {
              return (
                <MobileConsents
                  api={api}
                  session={session}
                  person={person}
                  onOpenChart={nav.openPersonChart}
                  onBack={() => setView("health")}
                />
              );
            }
            return (
              <MobileLifeEvents
                api={api}
                session={session}
                person={person}
                onOpenChart={nav.openPersonChart}
                onBack={() => setView("health")}
              />
            );
          })()}

        {view === "quicklog" && scopedSite && (
          <MobileQuickLog
            api={api}
            session={session}
            siteId={scopedSite.id}
            siteName={scopedSite.name}
            people={people}
            drills={workspace.monthly.drills.filter(
              (drill) => drill.siteId === scopedSite.id,
            )}
            onOpenChart={nav.openPersonChart}
            onOpenMedications={() => setView("mar")}
            onOpenHouseCard={() => setView("housecard")}
            onOpenSpending={(person) => {
              setSpendingPersonId(person.id);
              setView("spending");
            }}
          />
        )}

        {view === "messages" && (
          <MobileMessages
            api={api}
            session={session}
            individuals={workspace.individuals.map((person) => ({
              id: person.id,
              name: person.name,
            }))}
            onOpenIndividual={(individualId) => {
              const person = workspace.individuals.find(
                (row) => row.id === individualId,
              );
              if (person) nav.openPersonChart(person.name);
            }}
            onThreadOpenChange={setMessagesInThread}
          />
        )}

        {view === "scheduling" && (
          <MobileScheduling
            api={api}
            session={session}
            sites={schedSites.map((site) => ({ id: site.id, name: site.name }))}
            staff={workspace.staff}
            initialSiteId={scopedSite?.id ?? null}
          />
        )}

        {view === "yourshift" && ownShift.acc && (
          <MobileYourShiftDetail
            acc={ownShift.acc}
            siteName={scopedSite?.name ?? ""}
          />
        )}

        {view === "housecard" && scopedSite && (
          <MobileHouseCard
            api={api}
            session={session}
            siteId={scopedSite.id}
            siteName={scopedSite.name}
            people={people.map((person) => ({
              id: person.id,
              name: person.name,
            }))}
          />
        )}

        {view === "spending" &&
          (() => {
            const person = workspace.individuals.find(
              (row) => row.id === spendingPersonId,
            );
            if (!person) {
              return (
                <p className="msh-empty">
                  Pick an Individual from the Health view to see their
                  personal spending.
                </p>
              );
            }
            const personSite = sites.find((site) => site.id === person.siteId);
            return (
              <MobilePersonalSpending
                api={api}
                session={session}
                person={person}
                siteName={personSite?.name ?? ""}
                staffOptions={workspace.staff.map((member) => ({
                  id: member.id,
                  name: member.name,
                }))}
                onBack={() => setView("health")}
                onOpenChart={nav.openPersonChart}
              />
            );
          })()}

        {view === "hub" && (
          <MobileHub
            api={api}
            session={session}
            onOpenFullHub={() => nav.openPage("Employee Hub")}
            startSection={hubStartSection}
          />
        )}

        {view === "reports" && (
          <MobileReports api={api} session={session} workspace={workspace} />
        )}

        {view === "qa" && scopedSite && (
          <MobileQaReview
            api={api}
            session={session}
            siteId={scopedSite.id}
            siteName={scopedSite.name}
          />
        )}

        {view === "tasks" && (
          <div>
            <p className="msh-section-note">
              Your due and priority work across {session.agencyName}.
            </p>
            <div className="msh-list">
              {queueItems.length === 0 && (
                <p className="msh-empty">Nothing due for you right now.</p>
              )}
              {queueItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="msh-row"
                  onClick={() => openQueueItem(item)}
                >
                  <span className="msh-row-main">
                    <strong>{item.title}</strong>
                    <small>{item.detail}</small>
                    <small className="msh-status-text">
                      {TONE_LABELS[item.tone]}
                      {item.siteName ? ` · ${item.siteName}` : ""}
                    </small>
                  </span>
                  <span className="msh-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {view === "people" && (
          <MobilePeopleList
            people={people}
            onPick={(person) => nav.openPersonChart(person.name)}
            emptyText="No Individuals at this home."
          />
        )}

        {view === "notifications" && (
          <div>
            <div className="msh-notif-head">
              <p className="msh-section-note">
                Reminders and updates for you at {session.agencyName}.
              </p>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="msh-chip-button"
                  onClick={() =>
                    void markNotificationsRead(
                      notifRows.filter(isUnread).map((row) => row.id),
                    )
                  }
                >
                  Mark all read
                </button>
              )}
            </div>
            <div className="msh-list">
              {notifRows.length === 0 && (
                <p className="msh-empty">No notifications yet.</p>
              )}
              {notifRows.map((row) => {
                const unread = isUnread(row);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className="msh-row"
                    onClick={() => {
                      if (unread) void markNotificationsRead([row.id]);
                    }}
                  >
                    <span className="msh-row-main">
                      <strong>{row.title}</strong>
                      <small>{row.body}</small>
                      <small className="msh-status-text">
                        {unread ? "Unread · " : ""}
                        {formatCentralTime(row.created_at)} Central
                      </small>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </main>

      {showBottomNav && (
        <BottomNavPill
          items={navItems}
          activeId={activeNav}
          taskCount={queueItems.length}
          onSelect={goNav}
        />
      )}

      {sheetOpen && (
        <>
          <button
            type="button"
            className="msh-sheet-backdrop"
            aria-label="Close more menu"
            onClick={() => setSheetOpen(false)}
          />
          <div className="msh-sheet" role="dialog" aria-label="More">
            <h3 className="msh-sheet-title">More</h3>
            <div className="msh-list">
              {sheetTiles.map((tile) => {
                const Icon = TILE_ICONS[tile.id];
                return (
                  <button
                    key={tile.id}
                    type="button"
                    className="msh-row"
                    onClick={() => {
                      setSheetOpen(false);
                      openTile(tile.id);
                    }}
                  >
                    <span className="msh-tile-icon" aria-hidden="true">
                      <Icon size={22} />
                    </span>
                    <span className="msh-row-main">
                      <strong>{tile.label}</strong>
                      <small>{tile.hint}</small>
                    </span>
                    <span className="msh-chevron" aria-hidden="true">
                      ›
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                className="msh-row"
                onClick={() => {
                  setSheetOpen(false);
                  setView("sites");
                }}
              >
                <span className="msh-row-main">
                  <strong>Switch home</strong>
                  <small>Scope everything to another home</small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
              <button
                type="button"
                className="msh-row"
                onClick={() => {
                  setSheetOpen(false);
                  onDesktopView();
                }}
              >
                <span className="msh-row-main">
                  <strong>Desktop view</strong>
                  <small>Use the full desktop layout</small>
                </span>
                <span className="msh-chevron" aria-hidden="true">
                  ›
                </span>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
