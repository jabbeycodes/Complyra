import type { KeyboardEvent, MouseEvent } from "react";
import { ArrowRight, ChevronRight, Plus, UserPlus } from "lucide-react";
import { Avatar, Empty, PageHeading } from "../../components";
import { metrics } from "../../domain";
import { agencyStateCode, siteHeroAddressLine } from "../../data/siteAddress";
import { individualsAtSite } from "../../data/dashboard";
import {
  countIndividualsAtSite,
  siteCapacityLabel,
  siteIndividualCap,
} from "../../data/siteCapacity";
import {
  isSiteReviewInPlace,
  normalizeSiteFacts,
  type SiteReview,
} from "../../data/siteReview";
import { todayIso } from "../../data/chart";
import type { SessionUser } from "../../data/types";
import "./sitesList.css";

const AVATAR_LIMIT = 4;

type SiteCard = {
  id: string;
  name: string;
  address: string;
  city?: string;
  zip?: string;
  program: string;
  color: string;
  manager: string;
};

type PersonCard = {
  id: string;
  name: string;
  site: string;
  siteId?: string | null;
  color?: string;
  photoUrl?: string | null;
};

type RequirementRow = { site: string; status: string };

export default function SitesList(props: {
  session: SessionUser;
  sites: SiteCard[];
  individuals: PersonCard[];
  requirements: RequirementRow[];
  siteReviews: SiteReview[];
  siteFilter: string;
  onSiteFilter: (name: string) => void;
  onOpenSite: (siteId: string) => void;
  onAddSite?: () => void;
  onAddPerson?: (siteId: string) => void;
  canAddSite: boolean;
  canAddPerson: boolean;
}) {
  const {
    session,
    sites,
    individuals,
    requirements,
    siteReviews,
    siteFilter,
    onSiteFilter,
    onOpenSite,
    onAddSite,
    onAddPerson,
    canAddSite,
    canAddPerson,
  } = props;
  const cap = siteIndividualCap(session.agencyCode);
  const visible = sites.filter(
    (site) => siteFilter === "All sites" || site.name === siteFilter,
  );
  const programCount = new Set(sites.map((row) => row.program)).size;
  const summary = [
    `${sites.length} program site${sites.length === 1 ? "" : "s"}`,
    `${individuals.length} individual${individuals.length === 1 ? "" : "s"}`,
    `${programCount} program${programCount === 1 ? "" : "s"}`,
  ].join(" · ");

  function openSite(siteId: string, event?: MouseEvent | KeyboardEvent) {
    event?.stopPropagation();
    onOpenSite(siteId);
  }

  return (
    <>
      <PageHeading title="Sites & programs">
        {canAddSite && sites.length > 0 && (
          <button type="button" className="button" onClick={onAddSite} aria-label="Add a site">
            <Plus size={16} /> Add a site
          </button>
        )}
      </PageHeading>
      <div className="list-controls">
        <span>{summary}</span>
        <select
          aria-label="Select site"
          value={siteFilter}
          onChange={(e) => onSiteFilter(e.target.value)}
        >
          <option>All sites</option>
          {sites.map((site) => (
            <option key={site.id}>{site.name}</option>
          ))}
        </select>
      </div>
      {sites.length === 0 ? (
        <div className="sites-empty">
          <Empty
            title="No program sites yet."
            text={
              canAddSite
                ? "Add the first program home to start placing Individuals."
                : "No program sites are in your caseload."
            }
          />
          {canAddSite && (
            <button type="button" className="button primary" onClick={onAddSite} aria-label="Add a site">
              <Plus size={16} /> Add a site
            </button>
          )}
        </div>
      ) : (
        <div className="site-grid">
          {visible.map((site) => {
            const people = individualsAtSite(individuals, site);
            const count = countIndividualsAtSite(individuals, site.id) || people.length;
            const atCap = count >= cap;
            const address =
              siteHeroAddressLine({
                name: site.name,
                address: site.address,
                city: site.city,
                zip: site.zip,
                stateCode: agencyStateCode(null, session.agencyCode),
              }) || site.address;
            const score = metrics(
              requirements.filter((row) => row.site === site.name) as Parameters<
                typeof metrics
              >[0],
            ).score;
            const review = siteReviews.find((row) => row.siteId === site.id);
            const reviewInPlace = isSiteReviewInPlace(
              review,
              normalizeSiteFacts(site),
              todayIso(),
            );
            const overflow = Math.max(0, people.length - AVATAR_LIMIT);
            const faces = people.slice(0, AVATAR_LIMIT);
            return (
              <article
                key={site.id}
                className="panel location-card"
                tabIndex={0}
                aria-label={`${site.name}. Open site.`}
                onClick={() => onOpenSite(site.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openSite(site.id, event);
                  }
                }}
              >
                <div className="location-card-main">
                  <h2>{site.name}</h2>
                  {address ? <p className="location-address">{address}</p> : null}
                  <span className="program-tag">{site.program}</span>
                  <p className="location-capacity">
                    {siteCapacityLabel(count, cap)}
                    {atCap ? <span className="capacity-full">Full</span> : null}
                  </p>
                  {faces.length > 0 && (
                    <div className="location-faces" aria-hidden="true">
                      {faces.map((person) => (
                        <Avatar
                          key={person.id}
                          name={person.name}
                          small
                          color={person.color}
                          src={person.photoUrl}
                        />
                      ))}
                      {overflow > 0 ? (
                        <span className="location-faces-more">+{overflow}</span>
                      ) : null}
                    </div>
                  )}
                  <p className="location-glance muted">
                    {score}% ready
                    {reviewInPlace ? " · Site review in place" : " · Site review open"}
                  </p>
                </div>
                <div className="heading-actions" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="button primary"
                    onClick={(event) => openSite(site.id, event)}
                  >
                    Open site <ArrowRight size={16} />
                  </button>
                  {canAddPerson && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => onAddPerson?.(site.id)}
                    >
                      <UserPlus size={16} /> Add an individual
                    </button>
                  )}
                  <button type="button" className="button" onClick={() => onSiteFilter(site.name)}>
                    Site review pack
                  </button>
                  <button type="button" className="button" onClick={() => onSiteFilter(site.name)}>
                    This month’s checks
                  </button>
                </div>
                <span className="location-open-hint" aria-hidden="true">
                  Open <ChevronRight size={16} />
                </span>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
