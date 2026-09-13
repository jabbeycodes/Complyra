import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Badge } from "../components";
import { todayIso } from "../data/chart";
import {
  asMonthlyCollections,
  monthKeyFrom,
  siteSafetyView,
} from "../data/monthlyChecks";
import { openPrintable } from "../data/openFile";
import {
  SERVICE_TYPE_LABELS,
  SITE_REVIEW_LINE_DEFS,
  SITE_REVIEW_SECTIONS,
  blankSiteReview,
  canEditSiteReview,
  isSiteReviewInPlace,
  monthlySafetyOnFile,
  normalizeSiteFacts,
  siteReviewGaps,
  type SiteFacts,
  type SiteReview,
  type SiteReviewLineStatus,
  type SiteServiceType,
} from "../data/siteReview";
import { useData } from "../data/DataProvider";

const STATUS_OPTIONS: { value: SiteReviewLineStatus; label: string }[] = [
  { value: "unchecked", label: "Not marked" },
  { value: "satisfactory", label: "Satisfactory" },
  { value: "unsatisfactory", label: "Unsatisfactory" },
  { value: "na", label: "N/A" },
];

function yesNoNull(value: boolean | null): string {
  if (value === true) return "yes";
  if (value === false) return "no";
  return "";
}

function parseYesNo(value: string): boolean | null {
  if (value === "yes") return true;
  if (value === "no") return false;
  return null;
}

export default function SiteReviewPanel({ siteId }: { siteId: string }) {
  const { api, session, workspace, refresh } = useData();
  const today = todayIso();
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<SiteReview | null>(null);
  const [factsDraft, setFactsDraft] = useState<SiteFacts | null>(null);
  if (!session || !workspace) return null;

  const site = workspace.sites.find((row) => row.id === siteId);
  const stored = workspace.siteReviews.find((row) => row.siteId === siteId);
  const review = draft ?? stored ?? (site ? blankSiteReview({
    agencyId: session.agencyId,
    siteId,
  }) : null);
  const facts = factsDraft ?? (site ? normalizeSiteFacts(site) : null);
  const collections = asMonthlyCollections(workspace.monthly);
  const safetyOnFile = monthlySafetyOnFile(
    siteSafetyView(collections, siteId, monthKeyFrom(today)),
  );
  const canEdit = canEditSiteReview(session.roleKey);
  const inPlace = review && facts ? isSiteReviewInPlace(review, facts, today) : false;
  const gaps = review && facts ? siteReviewGaps(review, facts, today) : [];
  const people = workspace.individuals.filter((row) => row.site === site?.name);

  const linesBySection = useMemo(() => {
    if (!review) return [];
    return SITE_REVIEW_SECTIONS.map((section) => ({
      ...section,
      lines: SITE_REVIEW_LINE_DEFS.filter((def) => def.section === section.id).map((def) => ({
        def,
        line: review.lines.find((row) => row.id === def.id) ?? {
          id: def.id,
          status: "unchecked" as const,
          comment: "",
        },
      })),
    }));
  }, [review]);

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!site || !review || !facts) return null;

  return (
    <section className="panel site-review" aria-labelledby="site-review-heading">
      <div className="panel-heading">
        <div>
          <h2 id="site-review-heading">Site review pack · {site.name}</h2>
          <p>
            DPM confirms the environmental and HCBS checks are in place at
            this home. Smoke, CO, water temperature, extinguisher, and first
            aid stay on the monthly safety report — this pack points at that
            evidence instead of asking staff to check them twice.
          </p>
        </div>
        <Badge status={inPlace ? "Compliant" : "Overdue"} />
      </div>
      {error && <p className="form-error">{error}</p>}

      <div className="site-review-toolbar">
        <p>
          {inPlace
            ? "Checks are in place. Download the working copies for survey."
            : `${gaps.length} item${gaps.length === 1 ? "" : "s"} still open.`}
        </p>
        <div className="heading-actions">
          <button
            className="button"
            onClick={() =>
              run(async () => {
                const file = await api.downloadSiteReviewPdf(siteId);
                await openPrintable(file.name, file.blob, "download");
              })
            }
          >
            <Download size={16} /> Download site review
          </button>
          <button
            className="button"
            onClick={() =>
              run(async () => {
                const file = await api.downloadPreSurveyPdf(siteId);
                await openPrintable(file.name, file.blob, "download");
              })
            }
          >
            <Download size={16} /> Download pre-survey sheet
          </button>
        </div>
      </div>

      <fieldset className="site-review-facts" disabled={!canEdit}>
        <legend>Location facts for the pre-survey sheet</legend>
        <label>
          Service type
          <select
            aria-label="Service type"
            value={facts.serviceType}
            onChange={(e) =>
              setFactsDraft({
                ...facts,
                serviceType: e.target.value as SiteServiceType,
              })
            }
          >
            {Object.entries(SERVICE_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          City
          <input
            value={facts.city}
            onChange={(e) => setFactsDraft({ ...facts, city: e.target.value })}
          />
        </label>
        <label>
          County
          <input
            value={facts.county}
            onChange={(e) => setFactsDraft({ ...facts, county: e.target.value })}
          />
        </label>
        <label>
          ZIP
          <input
            value={facts.zip}
            onChange={(e) => setFactsDraft({ ...facts, zip: e.target.value })}
          />
        </label>
        <label>
          Site phone
          <input
            value={facts.sitePhone}
            onChange={(e) => setFactsDraft({ ...facts, sitePhone: e.target.value })}
          />
        </label>
        <label>
          Contact name
          <input
            value={facts.contactName}
            onChange={(e) => setFactsDraft({ ...facts, contactName: e.target.value })}
          />
        </label>
        <label>
          Contact phone
          <input
            value={facts.contactPhone}
            onChange={(e) => setFactsDraft({ ...facts, contactPhone: e.target.value })}
          />
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={facts.staffed24h}
            onChange={(e) => setFactsDraft({ ...facts, staffed24h: e.target.checked })}
          />
          24-hour staff
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={facts.overnightSleepStaff}
            onChange={(e) =>
              setFactsDraft({ ...facts, overnightSleepStaff: e.target.checked })
            }
          />
          Overnight sleep staff
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={facts.wellWater}
            onChange={(e) => setFactsDraft({ ...facts, wellWater: e.target.checked })}
          />
          Well water
        </label>
        {facts.wellWater && (
          <label>
            Last well-water test
            <input
              type="date"
              value={facts.lastWaterTestOn}
              onChange={(e) =>
                setFactsDraft({ ...facts, lastWaterTestOn: e.target.value })
              }
            />
          </label>
        )}
      </fieldset>

      <div className="site-review-meta">
        <label>
          Reviewer
          <input
            disabled={!canEdit}
            value={review.reviewerName}
            onChange={(e) => setDraft({ ...review, reviewerName: e.target.value })}
          />
        </label>
        <label>
          Support coordinator
          <input
            disabled={!canEdit}
            value={review.supportCoordinator}
            onChange={(e) =>
              setDraft({ ...review, supportCoordinator: e.target.value })
            }
          />
        </label>
        <label>
          Reviewed on
          <input
            type="date"
            disabled={!canEdit}
            value={review.reviewedOn}
            onChange={(e) => setDraft({ ...review, reviewedOn: e.target.value })}
          />
        </label>
        <label>
          Provider owned or controlled
          <select
            disabled={!canEdit}
            value={yesNoNull(review.providerOwnedControlled)}
            onChange={(e) =>
              setDraft({
                ...review,
                providerOwnedControlled: parseYesNo(e.target.value),
              })
            }
          >
            <option value="">Not marked</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Heightened scrutiny
          <select
            disabled={!canEdit}
            value={yesNoNull(review.heightenedScrutiny)}
            onChange={(e) =>
              setDraft({
                ...review,
                heightenedScrutiny: parseYesNo(e.target.value),
              })
            }
          >
            <option value="">Not marked</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>
          Meets individual needs
          <select
            disabled={!canEdit}
            aria-label="Meets individual needs"
            value={yesNoNull(review.meetsIndividualNeeds)}
            onChange={(e) =>
              setDraft({
                ...review,
                meetsIndividualNeeds: parseYesNo(e.target.value),
              })
            }
          >
            <option value="">Not marked</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={review.part2Verified}
            onChange={(e) => setDraft({ ...review, part2Verified: e.target.checked })}
          />
          Part II verified before first day of services
        </label>
      </div>

      <p className="site-review-people">
        People at this home: {people.map((row) => row.name).join(", ") || "none yet"}.
        Keep diets, equipment, and visit hours on each chart so the pre-survey
        sheet stays current.
      </p>

      {linesBySection.map((section) => (
        <div key={section.id} className="site-review-section">
          <h3>{section.title}</h3>
          <p>{section.help}</p>
          {section.lines.map(({ def, line }) => (
            <fieldset key={def.id} className="site-review-line" disabled={!canEdit}>
              <legend>{def.label}</legend>
              {def.hint && <p className="stack-help">{def.hint}</p>}
              {def.evidence === "monthly-safety" && (
                <p className="evidence-note">
                  {safetyOnFile
                    ? "Current monthly home safety report is on file."
                    : "Monthly home safety report for this month is not finished yet."}
                </p>
              )}
              {def.evidence === "monthly-drills" && (
                <p className="evidence-note">
                  Use this month’s emergency drills as the evac-practice record.
                </p>
              )}
              <label>
                Status
                <select
                  aria-label={`${def.label} status`}
                  value={line.status}
                  onChange={(e) =>
                    setDraft({
                      ...review,
                      lines: review.lines.map((row) =>
                        row.id === def.id
                          ? { ...row, status: e.target.value as SiteReviewLineStatus }
                          : row,
                      ),
                    })
                  }
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Comments
                <input
                  value={line.comment}
                  onChange={(e) =>
                    setDraft({
                      ...review,
                      lines: review.lines.map((row) =>
                        row.id === def.id
                          ? { ...row, comment: e.target.value }
                          : row,
                      ),
                    })
                  }
                />
              </label>
            </fieldset>
          ))}
        </div>
      ))}

      {canEdit && (
        <div className="site-review-save">
          <button
            className="button primary"
            onClick={() =>
              run(async () => {
                await api.saveSiteFacts(siteId, facts);
                await api.saveSiteReview({
                  id: review.id,
                  reviewerName: review.reviewerName,
                  supportCoordinator: review.supportCoordinator,
                  reviewedOn: review.reviewedOn,
                  providerOwnedControlled: review.providerOwnedControlled,
                  heightenedScrutiny: review.heightenedScrutiny,
                  meetsIndividualNeeds: review.meetsIndividualNeeds,
                  part2Verified: review.part2Verified,
                  lines: review.lines,
                });
                setDraft(null);
                setFactsDraft(null);
              })
            }
          >
            Save site review
          </button>
        </div>
      )}
    </section>
  );
}
