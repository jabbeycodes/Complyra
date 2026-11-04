import type { Requirement, Status } from "../domain";

const DEFAULT_LIMIT = 6;

const STATUS_RANK: Record<Status, number> = {
  Overdue: 0,
  Expired: 1,
  "Pending review": 2,
  "Due soon": 3,
  Upcoming: 4,
  Compliant: 5,
};

/** Same haystack the topbar already searched — keep empty-state matching identical. */
export function requirementMatchesQuery(item: Requirement, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return `${item.person} ${item.title} ${item.site} ${item.owner}`
    .toLowerCase()
    .includes(q);
}

/* ------------------------------------------------------------------ */
/* Directory search (simulation batch 13): the header search also finds */
/* people and homes, not just requirements. A real agency built through */
/* the UI can have few or no requirement rows, which left the header    */
/* search answering "No matching records" to every name query. The      */
/* caller passes ONLY collections already scoped to the caller's        */
/* readable sites, so a hit can never leak a cross-site record.         */
/* ------------------------------------------------------------------ */

export interface DirectoryIndividual {
  id: string;
  name: string;
  site: string;
}

export interface DirectoryStaffMember {
  id: string;
  name: string;
  role: string;
  site: string;
}

export interface DirectorySite {
  id: string;
  name: string;
}

export type DirectoryHit =
  | { kind: "individual"; id: string; name: string; site: string }
  | { kind: "staff"; id: string; name: string; role: string; site: string }
  | { kind: "site"; id: string; name: string };

/**
 * Every whitespace-separated token of the query must appear in the name,
 * so a first name ("Alex"), a last name, or "Alex Riv" all match the
 * same person.
 */
export function directoryNameMatches(name: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const haystack = name.toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

function rankByName<T extends { name: string }>(rows: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return [...rows].sort((a, b) => {
    const aPrefix = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const bPrefix = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    if (aPrefix !== bPrefix) return aPrefix - bPrefix;
    return a.name.localeCompare(b.name);
  });
}

export function searchDirectory(
  input: {
    individuals: DirectoryIndividual[];
    staff: DirectoryStaffMember[];
    sites: DirectorySite[];
  },
  query: string,
  perGroupLimit = 4,
): DirectoryHit[] {
  if (!query.trim()) return [];
  const hits: DirectoryHit[] = [];
  const seen = new Set<string>();
  const push = (hit: DirectoryHit) => {
    const key = `${hit.kind}:${hit.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(hit);
  };
  for (const person of rankByName(
    input.individuals.filter((p) => directoryNameMatches(p.name, query)),
    query,
  ).slice(0, perGroupLimit)) {
    push({ kind: "individual", id: person.id, name: person.name, site: person.site });
  }
  for (const member of rankByName(
    input.staff.filter((s) => directoryNameMatches(s.name, query)),
    query,
  ).slice(0, perGroupLimit)) {
    push({
      kind: "staff",
      id: member.id,
      name: member.name,
      role: member.role,
      site: member.site,
    });
  }
  for (const home of rankByName(
    input.sites.filter((s) => directoryNameMatches(s.name, query)),
    query,
  ).slice(0, perGroupLimit)) {
    push({ kind: "site", id: home.id, name: home.name });
  }
  return hits;
}

/**
 * Filter, drop duplicate ids, then surface open work before completed copies
 * of the same title. Limit is applied after ranking so "Ellis" is not five
 * identical Compliant PCSP rows.
 */
export function searchRequirements(
  items: Requirement[],
  query: string,
  limit = DEFAULT_LIMIT,
) {
  const matches = items.filter((item) => requirementMatchesQuery(item, query));
  const uniqueById = [
    ...new Map(matches.map((item) => [item.id, item])).values(),
  ];
  uniqueById.sort((a, b) => {
    const rank =
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (rank !== 0) return rank;
    if (a.due !== b.due) return a.due.localeCompare(b.due);
    if (a.page !== b.page) return a.page - b.page;
    return a.id.localeCompare(b.id);
  });
  // Seed filler can clone title/person/due/page. Keep the first (highest-ranked) lookalike.
  const seenLook = new Set<string>();
  const unique: Requirement[] = [];
  for (const item of uniqueById) {
    const look = `${item.title}|${item.person}|${item.site}|${item.status}|${item.due}|${item.page}|${item.source}`;
    if (seenLook.has(look)) continue;
    seenLook.add(look);
    unique.push(item);
    if (unique.length >= limit) break;
  }
  return unique;
}
