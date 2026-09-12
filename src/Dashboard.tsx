import { useState } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  Clock3,
  CircleAlert,
  Files,
  ChevronRight,
  Sparkles,
  Check,
  Building2,
  MoreHorizontal,
  CalendarDays,
  Download,
  FileText,
  Activity as ActivityIcon,
  CircleCheck,
  ClipboardCheck,
  PenLine,
  BookOpen,
} from "lucide-react";
import { categories, metrics } from "./domain";
import type { Requirement, Activity } from "./domain";
import { Badge, Empty } from "./components";
import type { PersonalWorkItem } from "./data/dashboard";

interface SiteCard {
  id: string;
  name: string;
  address: string;
  program: string;
  manager: string;
  color?: string;
}

interface Props {
  items: Requirement[];
  allItems: Requirement[];
  scorecard?: {
    score: number;
    total: number;
    done: number;
    overdue: number;
    dueSoon: number;
    review: number;
  };
  activity: Activity[];
  sites: SiteCard[];
  individuals: { name: string; site: string }[];
  site: string;
  personalItems: PersonalWorkItem[];
  onSite: (s: string) => void;
  onNavigate: (page: string, status?: string) => void;
  onRequirement: (r: Requirement) => void;
  onOpenPerson: (name: string) => void;
  onExport: () => void;
  onCopilot: () => void;
  onActivity: () => void;
}

function scoreTone(score: number, overdue: number) {
  if (overdue > 0 || score < 70) return "warn";
  if (score < 90) return "watch";
  return "good";
}

export default function Dashboard({
  items,
  allItems,
  scorecard,
  activity,
  sites,
  individuals,
  site,
  personalItems,
  onSite,
  onNavigate,
  onRequirement,
  onOpenPerson,
  onExport,
  onCopilot,
  onActivity,
}: Props) {
  const [sitesOpen, setSitesOpen] = useState(true);
  const agency = scorecard ?? metrics(allItems);
  const risks = items.filter((r) => ["Overdue", "Expired"].includes(r.status));

  function openPersonal(item: PersonalWorkItem) {
    if (item.requirementId) {
      const requirement = allItems.find((row) => row.id === item.requirementId);
      if (requirement) {
        onRequirement(requirement);
        return;
      }
    }
    if (item.personName) {
      onOpenPerson(item.personName);
      return;
    }
    if (item.kind === "review") onNavigate("Review queue", "Pending review");
  }

  return (
    <>
      <div className="dashboard-heading">
        <div className="eyebrow">YOUR AGENCY, AT A GLANCE</div>
        <div className="heading-row">
          <div>
            <h1>
              A little clarity. A lot of confidence
              <span className="purple-dot">.</span>
            </h1>
            <p>
              Agency-wide scores first. Then the homes you are assigned to, and
              the work waiting on you.
            </p>
          </div>
          <button className="button" onClick={onExport}>
            <Download size={16} /> Export report
          </button>
        </div>
      </div>
      <div className="scope-row">
        <div className="scope-controls">
          <label className="select-shell">
            <Building2 size={16} />
            <select
              aria-label="Filter by site"
              value={site}
              onChange={(e) => onSite(e.target.value)}
            >
              <option>All sites</option>
              {sites.map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
          <span className="scope-divider" />
          <span className="date-label">
            <CalendarDays size={15} />{" "}
            {new Date().toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </span>
        </div>
        <span className="snapshot-label">
          <span /> Sample agency snapshot
        </span>
      </div>
      <div className="readiness-banner">
        <div className="readiness-symbol">
          <ShieldCheck size={25} />
        </div>
        <div>
          <strong>You’re building a more audit-ready agency.</strong>
          <p>
            {agency.overdue
              ? `${agency.overdue} items need attention across the agency. Let’s close the gaps, together.`
              : "No overdue items agency-wide. Keep up the good work."}
          </p>
        </div>
        <button onClick={() => onNavigate("Requirements", "Overdue")}>
          Review priorities <ArrowRight size={16} />
        </button>
      </div>
      <div className="stat-grid">
        <button
          className="stat-card"
          onClick={() => onNavigate("Requirements")}
        >
          <div className="stat-label">
            Agency current{" "}
            <span className="stat-icon purple">
              <ShieldCheck size={17} />
            </span>
          </div>
          <div className="stat-value">
            {agency.score}
            <span>%</span>
          </div>
          <div className="stat-foot">
            <span className="positive">
              <Check size={13} /> {agency.done} complete
            </span>
            <span>of {agency.total} active requirements</span>
          </div>
        </button>
        <button
          className="stat-card"
          onClick={() => onNavigate("Requirements", "Overdue")}
        >
          <div className="stat-label">
            Needs attention{" "}
            <span className="stat-icon red">
              <CircleAlert size={17} />
            </span>
          </div>
          <div className="stat-value">
            {agency.overdue.toString().padStart(2, "0")}
            <span className="stat-descriptor">items</span>
          </div>
          <div className="stat-foot">
            <span className="priority-dot" /> Overdue or expired{" "}
            <ArrowUpRight size={14} />
          </div>
        </button>
        <button
          className="stat-card"
          onClick={() => onNavigate("Requirements", "Due soon")}
        >
          <div className="stat-label">
            Due in the next 7 days{" "}
            <span className="stat-icon amber">
              <Clock3 size={17} />
            </span>
          </div>
          <div className="stat-value">
            {agency.dueSoon.toString().padStart(2, "0")}
            <span className="stat-descriptor">requirements</span>
          </div>
          <div className="stat-foot">
            A little action now, peace of mind later <ArrowUpRight size={14} />
          </div>
        </button>
        <button
          className="stat-card"
          onClick={() => onNavigate("Review queue", "Pending review")}
        >
          <div className="stat-label">
            Ready for your review{" "}
            <span className="stat-icon blue">
              <Files size={17} />
            </span>
          </div>
          <div className="stat-value">
            {agency.review.toString().padStart(2, "0")}
            <span className="stat-descriptor">requirements</span>
          </div>
          <div className="stat-foot">
            <span className="review-dot" /> Your approval makes it official{" "}
            <ArrowUpRight size={14} />
          </div>
        </button>
      </div>
      <section className="panel agency-hero">
        <button
          type="button"
          className="agency-hero-toggle"
          aria-expanded={sitesOpen}
          aria-controls="site-compliance-grid"
          onClick={() => setSitesOpen((open) => !open)}
        >
          <div className="agency-hero-copy">
            <div className="eyebrow">AGENCY-WIDE COMPLIANCE</div>
            <h2>How the whole agency is doing</h2>
            <p>
              {agency.done} of {agency.total} current · {agency.overdue} need
              attention
            </p>
          </div>
          <div className={`agency-hero-score ${scoreTone(agency.score, agency.overdue)}`}>
            <strong>
              {agency.score}
              <small>%</small>
            </strong>
            <span>current</span>
          </div>
          <span className="agency-hero-hint">
            {sitesOpen ? "Hide site scores" : "View program site scores"}{" "}
            <ChevronRight size={16} />
          </span>
        </button>
        <div className="agency-hero-bar" aria-hidden="true">
          <span style={{ width: `${agency.score}%` }} />
        </div>
        {sitesOpen && (
          <div className="site-score-block" id="site-compliance-grid">
            <div className="panel-heading site-score-heading">
              <div>
                <h3>Program site compliance</h3>
                <p>
                  {sites.length === 1
                    ? "The home you are assigned to."
                    : "Homes you can see. Open a card to focus this dashboard."}
                </p>
              </div>
              <button
                className="text-button"
                onClick={() => onNavigate("Sites & programs")}
              >
                All sites <ArrowRight size={14} />
              </button>
            </div>
            {sites.length ? (
              <div className="site-score-grid">
                {sites.map((s) => {
                  const sm = metrics(allItems.filter((r) => r.site === s.name));
                  const people = individuals.filter((p) => p.site === s.name).length;
                  const selected = site === s.name;
                  return (
                    <button
                      type="button"
                      key={s.id || s.name}
                      className={`site-score-card ${scoreTone(sm.score, sm.overdue)}${selected ? " selected" : ""}`}
                      aria-label={`${s.name} compliance ${sm.score} percent`}
                      onClick={() => onSite(selected ? "All sites" : s.name)}
                    >
                      <div className="site-score-top">
                        <span className={`house-icon ${s.color ?? "purple"}`}>
                          <Building2 size={18} />
                        </span>
                        <Badge
                          status={sm.overdue ? "Needs attention" : "On track"}
                        />
                      </div>
                      <strong>{s.name}</strong>
                      <small>{s.program || s.address}</small>
                      <div className="site-score-value">
                        {sm.score}
                        <span>%</span>
                      </div>
                      <div className="progress-track">
                        <span style={{ width: `${sm.score}%` }} />
                      </div>
                      <div className="site-score-meta">
                        <span>{people} people</span>
                        {sm.overdue ? (
                          <span className="overdue-text">
                            {sm.overdue} need attention
                          </span>
                        ) : (
                          <span className="positive">
                            <Check size={13} /> All clear
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <Empty
                title="No assigned program sites"
                text="When you are assigned to a home, its compliance score will show here."
              />
            )}
          </div>
        )}
      </section>
      <section className="panel personal-queue">
        <div className="panel-heading">
          <div>
            <h2>
              Your work{" "}
              <span className="count-pill">{personalItems.length}</span>
            </h2>
            <p>What is waiting on you — not the whole agency.</p>
          </div>
        </div>
        {personalItems.length ? (
          <div className="personal-queue-list">
            {personalItems.map((item) => (
              <button
                type="button"
                className={`personal-queue-row ${item.tone}`}
                key={item.id}
                onClick={() => openPersonal(item)}
              >
                <span className={`personal-queue-icon ${item.tone}`}>
                  {item.kind === "training" ? (
                    <BookOpen size={17} />
                  ) : item.kind === "acknowledgment" ? (
                    <PenLine size={17} />
                  ) : item.kind === "review" ? (
                    <ClipboardCheck size={17} />
                  ) : (
                    <CircleAlert size={17} />
                  )}
                </span>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.detail}</small>
                </span>
                <em>
                  {item.kind === "review"
                    ? "Review"
                    : item.tone === "due"
                      ? "Due soon"
                      : "Waiting on you"}
                </em>
                <ChevronRight size={16} />
              </button>
            ))}
          </div>
        ) : (
          <Empty
            title="You’re caught up"
            text="Nothing is pending for you right now."
          />
        )}
      </section>
      <div className="dashboard-middle">
        <section className="panel priorities-panel">
          <div className="panel-heading">
            <div>
              <h2>
                What needs your attention{" "}
                <span className="count-pill">{risks.length}</span>
              </h2>
              <p>Small gaps today. Bigger peace of mind tomorrow.</p>
            </div>
            <button
              className="text-button"
              onClick={() => onNavigate("Requirements", "Overdue")}
            >
              View all <ArrowRight size={14} />
            </button>
          </div>
          <div className="risk-list">
            {risks.length ? (
              risks.map((r, i) => (
                <button
                  className="risk-row"
                  key={r.id}
                  onClick={() => onRequirement(r)}
                >
                  <div className={`risk-icon ${i === 1 ? "amber" : "red"}`}>
                    {i === 1 ? (
                      <Clock3 size={19} />
                    ) : i === 2 ? (
                      <Building2 size={19} />
                    ) : (
                      <FileText size={19} />
                    )}
                  </div>
                  <div className="risk-copy">
                    <strong>{r.title}</strong>
                    <span>
                      {r.person === "Site-wide" ? r.site : r.person}{" "}
                      <span className="dot-separator">·</span>{" "}
                      {r.person === "Site-wide" ? r.owner : r.site}
                    </span>
                    <span className="risk-meta">
                      {r.category} <span>·</span> Assigned to{" "}
                      {r.owner.split(" ")[0]}
                    </span>
                  </div>
                  <div className="risk-end">
                    <Badge status={r.status} />
                    <ChevronRight size={17} />
                  </div>
                </button>
              ))
            ) : (
              <Empty
                title="No overdue requirements"
                text="Your team is up to date in this view."
              />
            )}
          </div>
          <div className="priority-footer">
            <ShieldCheck size={14} /> Every action brings your agency closer to
            audit-ready.
          </div>
        </section>
        <section className="panel category-panel">
          <div className="panel-heading">
            <div>
              <h2>Compliance by category</h2>
              <p>The bigger picture, broken down.</p>
            </div>
            <span className="subtle-icon">
              <ShieldCheck size={18} />
            </span>
          </div>
          <div className="category-list">
            {categories.map((category, i) => {
              const group = items.filter((r) => r.category === category);
              const cm = metrics(group);
              return (
                <button
                  key={category}
                  className="category-row"
                  onClick={() => onNavigate(category)}
                >
                  <div>
                    <span>{category}</span>
                    <strong>{cm.score}%</strong>
                  </div>
                  <div className="progress-track">
                    <span
                      style={{
                        width: `${cm.score}%`,
                        background:
                          i === 4
                            ? "#c4a06a"
                            : cm.score === 100
                              ? "#5d7a52"
                              : "#8b5e3c",
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
          <div className="category-key">
            <span>
              <i />
              Completed
            </span>
            <span>
              <i />
              Remaining
            </span>
            <span>{agency.total} active requirements</span>
          </div>
        </section>
      </div>
      <section className="panel activity-panel dashboard-activity">
        <div className="panel-heading">
          <div>
            <h2>Recent activity</h2>
            <p>A record of care in action.</p>
          </div>
          <button
            className="icon-button"
            aria-label="View full activity timeline"
            onClick={onActivity}
          >
            <MoreHorizontal size={20} />
          </button>
        </div>
        <div className="activity-list">
          {activity.slice(0, 3).map((a, i) => (
            <div className="activity-row" key={a.id}>
              <span
                className={`activity-icon ${a.kind === "complete" ? "green" : a.kind === "alert" ? "red" : "purple"}`}
              >
                {a.kind === "complete" ? (
                  <Check size={14} />
                ) : a.kind === "document" ? (
                  <FileText size={14} />
                ) : (
                  <ActivityIcon size={14} />
                )}
              </span>
              <div>
                <strong>{a.text}</strong>
                <p>{a.detail}</p>
                <small>
                  {i === 0
                    ? "Most recent"
                    : new Date(a.time).toLocaleTimeString("en-US", {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                </small>
              </div>
            </div>
          ))}
        </div>
        <button className="activity-link" onClick={onActivity}>
          View activity log <ArrowRight size={14} />
        </button>
      </section>
      <button className="copilot-banner" onClick={onCopilot}>
        <span className="copilot-banner-icon">
          <Sparkles size={21} />
        </span>
        <span>
          <strong>A clearer answer is one question away.</strong>
          <small>
            Ask Complyrer what to prioritize, what’s missing, or where to find
            it.
          </small>
        </span>
        <span className="copilot-banner-action">
          Ask Complyrer <ArrowUpRight size={17} />
        </span>
      </button>
      <div className="page-footer">
        <span>
          <CircleCheck size={13} /> Clear responsibilities. Confident care.
        </span>
        <span>Made for the people who care for people.</span>
      </div>
    </>
  );
}
