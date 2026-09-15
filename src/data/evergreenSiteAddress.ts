/**
 * Canonical locality for Evergreen demo houses.
 *
 * Hosted preview was renamed Maple→Cedar / Oakwood→Willow (#58) without
 * writing city/zip into `site_facts`. Seed used to key those fields off
 * `name === "Maple House"`, so Cedar would get the second-house zip.
 * Look up by the live site name instead.
 */

export type EvergreenHouseLocality = {
  address: string;
  city: string;
  county: string;
  zip: string;
  sitePhone: string;
  contactName: string;
  contactPhone: string;
};

const PRIMARY = {
  city: "Columbia",
  county: "Boone",
  sitePhone: "573-555-0144",
  contactName: "Sarah Mitchell",
  contactPhone: "573-555-0144",
} as const;

const SECONDARY = {
  city: "Columbia",
  county: "Boone",
  sitePhone: "573-555-0188",
  contactName: "James Wilson",
  contactPhone: "573-555-0188",
} as const;

export const EVERGREEN_DEMO_HOUSES: Record<string, EvergreenHouseLocality> = {
  "Maple House": { ...PRIMARY, address: "3201 Pompey Drive", zip: "65202" },
  "Cedar House": { ...PRIMARY, address: "418 Cedar Court", zip: "65202" },
  "Oakwood House": { ...SECONDARY, address: "1840 Oakwood Lane", zip: "65203" },
  "Willow House": { ...SECONDARY, address: "920 Willow Lane", zip: "65203" },
};

export function isPrimaryDemoHouse(siteName: string): boolean {
  return siteName === "Maple House" || siteName === "Cedar House";
}

export function demoSiteLocality(siteName: string): EvergreenHouseLocality {
  return (
    EVERGREEN_DEMO_HOUSES[siteName] ?? {
      ...SECONDARY,
      address: "",
      zip: "65203",
    }
  );
}

export function isHostedRosterRename(siteName: string): boolean {
  return siteName === "Cedar House" || siteName === "Willow House";
}
