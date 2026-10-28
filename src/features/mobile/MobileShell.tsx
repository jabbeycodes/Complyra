import { useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Clock,
  FileText,
  ListChecks,
  ListTodo,
  LogOut,
  Monitor,
  Package,
  Pill,
  Search,
  Users,
  type LucideIcon,
} from "lucide-react";
import { ComplyRerWordmark } from "../../brand/ComplyrerBrand";
import type { ComplyraApi, WorkspaceView } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import type { PersonalWorkItem } from "../../data/dashboard";
import { pageVisible, roleLabel } from "../../data/status";
import { mobileTiles, type MobileTileId } from "./tiles";
import type { MobileNav } from "./types";
import MobileMar from "./MobileMar";
import MobileIsp from "./MobileIsp";
import MobileShiftNotes from "./MobileShiftNotes";
import MobilePeopleList from "./MobilePeopleList";
import "./mobile.css";

type ShellView =
  | "home"
  | "sites"
  | "mar"
  | "isp"
  | "notes"
  | "tasks"
  | "people";

const TILE_ICONS: Record<MobileTileId, LucideIcon> = {
  medications: Pill,
  shiftNotes: FileText,
  ispData: ClipboardList,
  timeClock: Clock,
  myTasks: ListTodo,
  individuals: Users,
  appointments: CalendarDays,
  checklists: ListChecks,
  medCount: Package,
};

const VIEW_TITLES: Partial<Record<ShellView, string>> = {
  sites: "Select your home",
  mar: "Medications",
  isp: "ISP Data",
  notes: "Shift Notes",
  tasks: "My Tasks",
  people: "Individuals",
};

const TONE_LABELS: Record<PersonalWorkItem["tone"], string> = {
  overdue: "Overdue",
  due: "Due",
  review: "Needs review",
};

function siteStorageKey(userId: string) {
  return `complyrer.mobileSite.${userId}`;
}

export default function MobileShell({
  api,
  session,
  workspace,
  queueItems,
  onSignOut,
  onDesktopView,
  nav,
}: {
  api: ComplyraApi;
  session: SessionUser;
  workspace: WorkspaceView;
  queueItems: PersonalWorkItem[];
  onSignOut: () => void;
  onDesktopView: () => void;
  nav: MobileNav;
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
  const [view, setView] = useState<ShellView>(
    sites.length > 1 && !storedSite ? "sites" : "home",
  );
  const [siteQuery, setSiteQuery] = useState("");
  const [ispPersonId, setIspPersonId] = useState<string | null>(null);
  const [ispKey, setIspKey] = useState(0);

  const tiles = useMemo(
    () =>
      mobileTiles({
        roleKey: session.roleKey,
        permissions: session.permissions,
        canPage: (page) => pageVisible(session, page),
      }),
    [session],
  );

  const people = useMemo(
    () =>
      scopedSite
        ? workspace.individuals.filter(
            (person) => person.siteId === scopedSite.id,
          )
        : [],
    [workspace.individuals, scopedSite],
  );

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
      case "shiftNotes":
        setView("notes");
        break;
      case "ispData":
        setIspPersonId(null);
        setIspKey((value) => value + 1);
        setView("isp");
        break;
      case "timeClock":
        nav.openPage("Employee Hub");
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
      case "medCount":
        nav.openPage("Supply forecast");
        break;
    }
  };

  const openIspForPerson = (personId: string) => {
    setIspPersonId(personId);
    setIspKey((value) => value + 1);
    setView("isp");
  };

  return (
    <div className="msh-shell">
      <header className="msh-header">
        <ComplyRerWordmark size={28} />
        <div className="msh-header-actions">
          <button
            type="button"
            className="msh-header-button"
            onClick={onDesktopView}
          >
            <Monitor size={17} aria-hidden="true" />
            <span>Desktop view</span>
          </button>
          <button
            type="button"
            className="msh-header-button"
            onClick={onSignOut}
          >
            <LogOut size={17} aria-hidden="true" />
            <span>Sign out</span>
          </button>
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

      <main className="msh-main">
        {view === "home" && (
          <>
            <section className="msh-welcome">
              <h2>Welcome, {session.fullName.split(" ")[0]}</h2>
              <p>
                {session.fullName} · {roleLabel(session.roleKey, session.jobTitle)}
              </p>
              <p className="msh-welcome-agency">{session.agencyName}</p>
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
                    <Icon size={30} aria-hidden="true" />
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
            siteName={scopedSite.name}
            initialPersonId={ispPersonId}
            onOpenChart={nav.openPersonChart}
          />
        )}

        {view === "notes" && scopedSite && (
          <MobileShiftNotes
            api={api}
            session={session}
            siteId={scopedSite.id}
            siteName={scopedSite.name}
            people={people}
            onCreateEntry={openIspForPerson}
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
                  onClick={() => {
                    if (item.personName) nav.openPersonChart(item.personName);
                    else nav.openPage("Overview");
                  }}
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
      </main>
    </div>
  );
}
