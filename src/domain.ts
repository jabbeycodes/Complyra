export type Status =
  | "Compliant"
  | "Due soon"
  | "Overdue"
  | "Expired"
  | "Upcoming"
  | "Pending review";
export type Category =
  | "PCSP acknowledgments"
  | "Nursing delegations"
  | "Equipment checks"
  | "Behavior plan training"
  | "Emergency drills"
  | "Required forms";
export interface Requirement {
  id: string;
  title: string;
  person: string;
  site: string;
  category: Category;
  owner: string;
  role: string;
  due: string;
  status: Status;
  source: string;
  page: number;
  frequency: string;
  evidence: string;
  completedAt?: string;
}
export interface Activity {
  id: string;
  text: string;
  detail: string;
  time: string;
  kind: "complete" | "document" | "review" | "alert";
}
export interface Plan {
  id: string;
  name: string;
  person: string;
  site: string;
  version: string;
  effective: string;
  status: "Active" | "Pending review" | "Archived";
  pages: number;
}
export const DEMO_DATE = "2026-09-11";
export const categories: Category[] = [
  "PCSP acknowledgments",
  "Nursing delegations",
  "Equipment checks",
  "Behavior plan training",
  "Emergency drills",
  "Required forms",
];
export const sites = [
  {
    name: "Maple House",
    address: "3201 Pompey Drive",
    manager: "Sarah Mitchell",
    initials: "SM",
    color: "purple",
    program: "Residential services",
  },
  {
    name: "Oakwood House",
    address: "1840 Oakwood Lane",
    manager: "James Wilson",
    initials: "JW",
    color: "green",
    program: "Residential services",
  },
];
export const individuals = [
  {
    id: "IND-001",
    name: "Jodie Williams",
    site: "Maple House",
    initials: "JW",
    color: "purple",
    manager: "Sarah Mitchell",
  },
  {
    id: "IND-002",
    name: "Brandon Miller",
    site: "Maple House",
    initials: "BM",
    color: "green",
    manager: "Sarah Mitchell",
  },
  {
    id: "IND-003",
    name: "Sylvester Jones",
    site: "Oakwood House",
    initials: "SJ",
    color: "peach",
    manager: "James Wilson",
  },
  {
    id: "IND-004",
    name: "Maya Johnson",
    site: "Oakwood House",
    initials: "MJ",
    color: "blue",
    manager: "James Wilson",
  },
];
export const staff = [
  { name: "Sarah Mitchell", role: "House Manager", site: "Maple House" },
  { name: "James Wilson", role: "House Manager", site: "Oakwood House" },
  { name: "Alex Morgan", role: "DSP", site: "Maple House" },
  { name: "Taylor Reed", role: "DSP", site: "Maple House" },
  { name: "Jordan Lee", role: "DSP", site: "Oakwood House" },
  { name: "Casey Adams", role: "DSP", site: "Oakwood House" },
  { name: "Cameron Price", role: "Nurse", site: "Maple House" },
];
const base = { role: "DSP", frequency: "On plan update", evidence: "" };
const open: Requirement[] = [
  {
    ...base,
    id: "REQ-121",
    title: "Acknowledge updated PCSP",
    person: "Jodie Williams",
    site: "Maple House",
    category: "PCSP acknowledgments",
    owner: "Alex Morgan",
    due: "2026-09-08",
    status: "Overdue",
    source: "Jodie Williams · PCSP 2026 · v2",
    page: 12,
  },
  {
    ...base,
    id: "REQ-122",
    title: "Renew medication delegation",
    person: "Brandon Miller",
    site: "Maple House",
    category: "Nursing delegations",
    owner: "Taylor Reed",
    due: "2026-09-09",
    status: "Expired",
    source: "Brandon Miller · Medication delegation · v1",
    page: 3,
    frequency: "Annually",
  },
  {
    ...base,
    id: "REQ-123",
    title: "Record September emergency drill",
    person: "Site-wide",
    site: "Maple House",
    category: "Emergency drills",
    owner: "Sarah Mitchell",
    role: "House Manager",
    due: "2026-09-10",
    status: "Overdue",
    source: "Emergency preparedness policy · v3",
    page: 8,
    frequency: "Monthly",
  },
  {
    ...base,
    id: "REQ-124",
    title: "Complete adaptive equipment check",
    person: "Maya Johnson",
    site: "Oakwood House",
    category: "Equipment checks",
    owner: "Casey Adams",
    due: "2026-09-14",
    status: "Due soon",
    source: "Maya Johnson · PCSP 2026 · v1",
    page: 14,
    frequency: "Monthly",
  },
  {
    ...base,
    id: "REQ-125",
    title: "Renew enteral feeding delegation",
    person: "Sylvester Jones",
    site: "Oakwood House",
    category: "Nursing delegations",
    owner: "Jordan Lee",
    due: "2026-09-17",
    status: "Due soon",
    source: "Sylvester Jones · Nursing plan · v1",
    page: 6,
    frequency: "Annually",
  },
  {
    ...base,
    id: "REQ-126",
    title: "Acknowledge specialized diet plan",
    person: "Sylvester Jones",
    site: "Oakwood House",
    category: "PCSP acknowledgments",
    owner: "Jordan Lee",
    due: "2026-09-16",
    status: "Due soon",
    source: "Sylvester Jones · PCSP 2026 · v1",
    page: 9,
  },
  {
    ...base,
    id: "REQ-129",
    title: "Review updated supervision requirement",
    person: "Jodie Williams",
    site: "Maple House",
    category: "PCSP acknowledgments",
    owner: "Sarah Mitchell",
    role: "House Manager",
    due: "2026-09-15",
    status: "Pending review",
    source: "Jodie Williams · PCSP 2026 · v3 draft",
    page: 12,
  },
  {
    ...base,
    id: "REQ-130",
    title: "Review revised behavior support training",
    person: "Maya Johnson",
    site: "Oakwood House",
    category: "Behavior plan training",
    owner: "James Wilson",
    role: "House Manager",
    due: "2026-09-16",
    status: "Pending review",
    source: "Maya Johnson · Behavior support plan · v2 draft",
    page: 5,
  },
];
/**
 * Curated demo requirements: every title is unique across the seed so lists,
 * exports, and the demo tour never show the same row repeated per person.
 * (The eight `open` items above carry the overdue/due-soon/review variety;
 * these are the completed backbone.)
 */
const completedSeed: Array<{
  id: string;
  title: string;
  person: string;
  site: string;
  category: Category;
  owner: string;
  due: string;
  source: string;
  page: number;
}> = [
  // Maple House — Jodie Williams
  { id: "REQ-001", title: "Acknowledge PCSP 2026 annual update", person: "Jodie Williams", site: "Maple House", category: "PCSP acknowledgments", owner: "Alex Morgan", due: "2026-09-08", source: "Jodie Williams · PCSP 2026 · v2", page: 4 },
  { id: "REQ-002", title: "Complete seizure protocol delegation", person: "Jodie Williams", site: "Maple House", category: "Nursing delegations", owner: "Taylor Reed", due: "2026-08-22", source: "Jodie Williams · PCSP 2026 · v2", page: 9 },
  { id: "REQ-003", title: "Verify wheelchair and adaptive equipment", person: "Jodie Williams", site: "Maple House", category: "Equipment checks", owner: "Alex Morgan", due: "2026-09-01", source: "Jodie Williams · PCSP 2026 · v2", page: 14 },
  { id: "REQ-004", title: "Record August emergency drill", person: "Jodie Williams", site: "Maple House", category: "Emergency drills", owner: "Taylor Reed", due: "2026-08-30", source: "Jodie Williams · PCSP 2026 · v2", page: 6 },
  // Maple House — Brandon Miller
  { id: "REQ-005", title: "Complete diabetes care delegation", person: "Brandon Miller", site: "Maple House", category: "Nursing delegations", owner: "Alex Morgan", due: "2026-08-15", source: "Brandon Miller · PCSP 2026 · v1", page: 7 },
  { id: "REQ-006", title: "File August blood sugar logs", person: "Brandon Miller", site: "Maple House", category: "Required forms", owner: "Taylor Reed", due: "2026-09-02", source: "Brandon Miller · PCSP 2026 · v1", page: 11 },
  { id: "REQ-007", title: "Record August fire drill", person: "Brandon Miller", site: "Maple House", category: "Emergency drills", owner: "Alex Morgan", due: "2026-08-30", source: "Brandon Miller · PCSP 2026 · v1", page: 6 },
  { id: "REQ-008", title: "Acknowledge medication schedule update", person: "Brandon Miller", site: "Maple House", category: "PCSP acknowledgments", owner: "Taylor Reed", due: "2026-09-05", source: "Brandon Miller · PCSP 2026 · v1", page: 5 },
  // Oakwood House — Sylvester Jones
  { id: "REQ-009", title: "Complete enteral feeding delegation", person: "Sylvester Jones", site: "Oakwood House", category: "Nursing delegations", owner: "Jordan Lee", due: "2026-08-18", source: "Sylvester Jones · PCSP 2026 · v1", page: 8 },
  { id: "REQ-010", title: "Verify feeding pump equipment", person: "Sylvester Jones", site: "Oakwood House", category: "Equipment checks", owner: "Casey Adams", due: "2026-09-03", source: "Sylvester Jones · PCSP 2026 · v1", page: 12 },
  { id: "REQ-011", title: "Acknowledge dietitian consult notes", person: "Sylvester Jones", site: "Oakwood House", category: "PCSP acknowledgments", owner: "Jordan Lee", due: "2026-08-27", source: "Sylvester Jones · PCSP 2026 · v1", page: 10 },
  { id: "REQ-012", title: "Record August tornado drill", person: "Sylvester Jones", site: "Oakwood House", category: "Emergency drills", owner: "Casey Adams", due: "2026-08-30", source: "Sylvester Jones · PCSP 2026 · v1", page: 6 },
  // Oakwood House — Maya Johnson
  { id: "REQ-013", title: "Complete behavior support training", person: "Maya Johnson", site: "Oakwood House", category: "Behavior plan training", owner: "Jordan Lee", due: "2026-08-25", source: "Maya Johnson · Behavior support plan · v2 draft", page: 5 },
  { id: "REQ-014", title: "Acknowledge community outing plan", person: "Maya Johnson", site: "Oakwood House", category: "PCSP acknowledgments", owner: "Casey Adams", due: "2026-09-06", source: "Maya Johnson · PCSP 2026 · v1", page: 7 },
  { id: "REQ-015", title: "Verify sensory room equipment", person: "Maya Johnson", site: "Oakwood House", category: "Equipment checks", owner: "Jordan Lee", due: "2026-09-04", source: "Maya Johnson · PCSP 2026 · v1", page: 13 },
  { id: "REQ-016", title: "File August daily service notes", person: "Maya Johnson", site: "Oakwood House", category: "Required forms", owner: "Casey Adams", due: "2026-09-02", source: "Maya Johnson · PCSP 2026 · v1", page: 15 },
];

export const seedRequirements: Requirement[] = [
  ...open,
  ...completedSeed.map((item, i) => ({
    ...base,
    id: item.id,
    title: item.title,
    person: item.person,
    site: item.site,
    category: item.category,
    owner: item.owner,
    due: item.due,
    status: "Compliant" as Status,
    source: item.source,
    page: item.page,
    evidence: `Sample signed completion record EV-${String(101 + i).padStart(3, "0")}`,
    completedAt: `${item.due}T14:30:00.000Z`,
  })),
];
export const seedPlans: Plan[] = [
  ...individuals.map((p, i) => ({
    id: `DOC-${i + 1}`,
    name: `${p.name} · PCSP 2026`,
    person: p.name,
    site: p.site,
    version: p.name === "Jodie Williams" ? "v2" : "v1",
    effective: "2026-07-01",
    status: "Active" as const,
    pages: 18 + (i % 10),
  })),
  {
    id: "DOC-25",
    name: "Jodie Williams · PCSP 2026",
    person: "Jodie Williams",
    site: "Maple House",
    version: "v3 draft",
    effective: "2026-09-15",
    status: "Pending review",
    pages: 24,
  },
  {
    id: "DOC-26",
    name: "Maya Johnson · Behavior support plan",
    person: "Maya Johnson",
    site: "Oakwood House",
    version: "v2 draft",
    effective: "2026-09-16",
    status: "Pending review",
    pages: 12,
  },
  {
    id: "DOC-27",
    name: "Jodie Williams · PCSP 2026",
    person: "Jodie Williams",
    site: "Maple House",
    version: "v1",
    effective: "2026-01-01",
    status: "Archived",
    pages: 22,
  },
];
export const seedActivity: Activity[] = [
  {
    id: "EV-1",
    text: "PCSP acknowledgment completed",
    detail: "Jordan Lee · Sylvester Jones · Oakwood House",
    time: "2026-09-11T14:42:00Z",
    kind: "complete",
  },
  {
    id: "EV-2",
    text: "Updated PCSP ready for review",
    detail: "Jodie Williams · Maple House · Version 3",
    time: "2026-09-11T14:15:00Z",
    kind: "document",
  },
  {
    id: "EV-3",
    text: "Equipment check completed",
    detail: "Casey Adams · Oakwood House",
    time: "2026-09-11T13:48:00Z",
    kind: "complete",
  },
  {
    id: "EV-4",
    text: "Delegation renewal overdue",
    detail: "Taylor Reed · Brandon Miller · Maple House",
    time: "2026-09-11T13:00:00Z",
    kind: "alert",
  },
];
export function metrics(items: Requirement[]) {
  const active = items.filter((r) => r.status !== "Pending review");
  const done = active.filter((r) => r.status === "Compliant").length;
  return {
    score: active.length ? Math.round((done / active.length) * 100) : 100,
    total: active.length,
    done,
    overdue: active.filter((r) => ["Overdue", "Expired"].includes(r.status))
      .length,
    dueSoon: active.filter((r) => r.status === "Due soon").length,
    review: items.filter((r) => r.status === "Pending review").length,
  };
}
export function completeRequirement(
  items: Requirement[],
  id: string,
  evidence: string,
): Requirement[] {
  if (!evidence.trim()) throw new Error("A completion record is required.");
  const item = items.find((r) => r.id === id);
  if (!item) throw new Error("Requirement not found.");
  if (item.status === "Pending review")
    throw new Error("Approve this requirement before recording completion.");
  return items.map((r) =>
    r.id === id
      ? {
          ...r,
          status: "Compliant",
          evidence: evidence.trim(),
          completedAt: new Date().toISOString(),
        }
      : r,
  );
}
export function approveRequirement(
  items: Requirement[],
  id: string,
): Requirement[] {
  const item = items.find((r) => r.id === id);
  if (!item || item.status !== "Pending review")
    throw new Error("Only draft requirements can be approved.");
  const days = (Date.parse(item.due) - Date.parse(DEMO_DATE)) / 86400000;
  const status: Status =
    days < 0 ? "Overdue" : days <= 7 ? "Due soon" : "Upcoming";
  return items.map((r) => (r.id === id ? { ...r, status } : r));
}
export function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function exportCsv(items: Requirement[]) {
  return [
    [
      "ID",
      "Requirement",
      "Individual",
      "Site",
      "Responsible person",
      "Status",
      "Due date",
      "Source",
      "Page",
      "Evidence",
    ],
    ...items.map((r) => [
      r.id,
      r.title,
      r.person,
      r.site,
      r.owner,
      r.status,
      r.due,
      r.source,
      String(r.page),
      r.evidence,
    ]),
  ]
    .map((row) => row.map(csvCell).join(","))
    .join("\r\n");
}
