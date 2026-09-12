import { isUsStateCode } from "./usStates";

export const AGENCY_SLUG_PATTERN = /^[a-z0-9]{2,20}$/;
export const AGENCY_CODE_PATTERN = /^[A-Z0-9]{2,20}-[A-Z]{2}$/;

const STOP_WORDS = new Set([
  "and",
  "the",
  "of",
  "for",
  "care",
  "services",
  "service",
  "llc",
  "inc",
  "corp",
  "corporation",
  "agency",
  "group",
  "health",
  "healthcare",
  "home",
  "homes",
  "residential",
]);

/** Provider codes are stored and shown in ALL CAPS. Login still accepts any case. */
export function normalizeAgencyCode(value: string) {
  return value.trim().toUpperCase().replaceAll(/\s+/g, "");
}

export function buildAgencyCode(slug: string, stateCode: string) {
  const shortName = slug.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  return `${shortName.toUpperCase()}-${stateCode.trim().toUpperCase()}`;
}

export function suggestAgencySlug(name: string) {
  const words = name
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter(Boolean) ?? [];
  const meaningful = words.filter((word) => !STOP_WORDS.has(word));
  const source = meaningful.length ? meaningful : words;
  if (!source.length) return "";
  if (source.length === 1) return source[0].slice(0, 20);
  if (source.length >= 3) return source.map((word) => word[0]).join("").slice(0, 8);
  return source[0].slice(0, 20);
}

export function validateAgencyCodeParts(slug: string, stateCode: string) {
  const normalizedSlug = slug.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const state = stateCode.trim().toUpperCase();
  if (!AGENCY_SLUG_PATTERN.test(normalizedSlug)) {
    return "Agency code should be 2–20 letters or numbers, then the state.";
  }
  if (!isUsStateCode(state)) {
    return "Choose the agency’s home state.";
  }
  return null;
}

export function generateTempPassword() {
  return `Reset!${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
}
