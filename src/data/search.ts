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
