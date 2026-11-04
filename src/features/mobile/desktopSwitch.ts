/**
 * Phone → Desktop view switch (simulation batch 28): switching used to
 * drop the user on whatever page the desktop hash last held, in
 * whatever house the desktop filter remembered. The switch now
 * preserves the current screen and house scope: each shell view maps
 * to its desktop counterpart, and every site-scoped screen lands on
 * that same house's Site detail page.
 */

export interface DesktopTarget {
  page: string;
  /** Set only for "Site detail": the house to open. */
  siteId: string | null;
}

export function desktopTargetFor(input: {
  view: string;
  siteId: string | null;
  canPage: (page: string) => boolean;
}): DesktopTarget {
  const { view, siteId, canPage } = input;
  const siteDetail: DesktopTarget = siteId
    ? { page: "Site detail", siteId }
    : { page: "Overview", siteId: null };
  const named = (page: string): DesktopTarget =>
    canPage(page) ? { page, siteId: null } : siteDetail;
  switch (view) {
    case "messages":
      return named("Messages");
    case "hub":
    case "yourshift":
      return named("Employee Hub");
    case "reports":
      return named("Report Library");
    case "qa":
      return named("QA Review");
    case "scheduling":
      return named("Scheduling");
    case "consents":
      return named("Consents");
    default:
      // home, tasks, people, health, mar, isp, quicklog, housecard,
      // spending, careplans, lifeevents, sites, notifications: all
      // site-scoped work lives on the house's Site detail page.
      return siteDetail;
  }
}
