/**
 * Canonical program-site location for UI and generated documents.
 *
 * Source of truth is the SiteRecord: name (title) + street (`address`) +
 * city / zip, with agency `stateCode`. Individual `profile.address` is the
 * person/visit default and is never used for home/program location on print.
 *
 * Display line is `street, city, ST zip`. Empty parts are omitted so a
 * missing zip never prints "undefined".
 */

export type SiteAddressParts = {
  name?: string | null;
  /** Street line stored on `sites.address`. */
  address?: string | null;
  city?: string | null;
  county?: string | null;
  zip?: string | null;
  stateCode?: string | null;
};

export function cleanAddressPart(value?: string | null): string {
  if (value == null) return "";
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "undefined" || text.toLowerCase() === "null") {
    return "";
  }
  return text;
}

function fold(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Two-letter state from an agency code like EVERGREEN-MO. */
export function agencyStateCode(
  agency?: { stateCode?: string | null } | null,
  agencyCode?: string | null,
): string {
  const fromAgency = cleanAddressPart(agency?.stateCode).toUpperCase();
  if (fromAgency) return fromAgency;
  const match = cleanAddressPart(agencyCode).match(/-([A-Za-z]{2})$/);
  return match ? match[1].toUpperCase() : "";
}

export function siteHasLocality(parts: SiteAddressParts): boolean {
  return Boolean(
    cleanAddressPart(parts.city) ||
      cleanAddressPart(parts.zip) ||
      cleanAddressPart(parts.stateCode),
  );
}

/** Quiet complete line: street, city, ST zip. */
export function formatSiteAddressLine(parts: SiteAddressParts): string {
  const street = cleanAddressPart(parts.address);
  const city = cleanAddressPart(parts.city);
  const state = cleanAddressPart(parts.stateCode).toUpperCase();
  const zip = cleanAddressPart(parts.zip);
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  return [street, cityStateZip].filter(Boolean).join(", ");
}

export function siteLocationFields(parts: SiteAddressParts): {
  name: string;
  address?: string;
} {
  const name = cleanAddressPart(parts.name);
  const street = cleanAddressPart(parts.address);
  const addressLine = formatSiteAddressLine(parts);
  if (!name && !addressLine) return { name: "" };
  if (!addressLine) return { name };
  if (!name) return { name: addressLine };
  const nameIsStreet = fold(name) === fold(street);
  const nameIsFull = fold(name) === fold(addressLine);
  // Name === street and nothing else on the address: one line (no stutter).
  if ((nameIsStreet || nameIsFull) && !siteHasLocality(parts)) {
    return { name };
  }
  // Name already is the full printed address.
  if (nameIsFull) return { name };
  return { name, address: addressLine };
}

/** Hero subtitle: empty when printing it would duplicate the title. */
export function siteHeroAddressLine(parts: SiteAddressParts): string {
  return siteLocationFields(parts).address ?? "";
}

export function siteLocationFrom(
  site: {
    name?: string | null;
    address?: string | null;
    city?: string | null;
    zip?: string | null;
  } | null | undefined,
  stateCode?: string | null,
): SiteAddressParts {
  return {
    name: site?.name ?? "Home",
    address: site?.address,
    city: site?.city,
    zip: site?.zip,
    stateCode,
  };
}
