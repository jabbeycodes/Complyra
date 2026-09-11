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
  {
    name: "Cedar House",
    address: "725 Cedar Avenue",
    manager: "Emily Chen",
    initials: "EC",
    color: "peach",
    program: "Residential services",
  },
  {
    name: "Willow House",
    address: "210 Willow Creek",
    manager: "Michael Davis",
    initials: "MD",
    color: "blue",
    program: "Residential services",
  },
  {
    name: "Birch House",
    address: "908 Birch Street",
    manager: "Lisa Thompson",
    initials: "LT",
    color: "pink",
    program: "Supported living",
  },
  {
    name: "Aspen House",
    address: "112 Aspen Court",
    manager: "David Garcia",
    initials: "DG",
    color: "green",
    program: "Supported living",
  },
];
const names = [
  "Jodie Williams",
  "Brandon Miller",
  "Sylvester Jones",
  "Maya Johnson",
  "Ethan Brooks",
  "Olivia Parker",
  "Noah Davis",
  "Ava Thompson",
  "Liam Wilson",
  "Sophia Martinez",
  "Lucas Anderson",
  "Isabella Thomas",
  "Mason Jackson",
  "Amelia White",
  "Logan Harris",
  "Charlotte Clark",
  "Elijah Lewis",
  "Harper Robinson",
  "James Walker",
  "Evelyn Young",
  "Benjamin Allen",
  "Abigail King",
  "Henry Wright",
  "Ella Scott",
];
export const individuals = names.map((name, i) => ({
  id: `IND-${String(i + 1).padStart(3, "0")}`,
  name,
  site: sites[Math.floor(i / 4)].name,
  initials: name
    .split(" ")
    .map((n) => n[0])
    .join(""),
  color: ["purple", "green", "peach", "blue"][i % 4],
  manager: sites[Math.floor(i / 4)].manager,
}));
export const staff = [
  ...sites.map((s) => ({
    name: s.manager,
    role: "House Manager",
    site: s.name,
  })),
  ...[
    "Alex Morgan",
    "Taylor Reed",
    "Jordan Lee",
    "Casey Adams",
    "Riley Carter",
    "Morgan Hayes",
    "Jamie Brooks",
    "Sam Rivera",
    "Drew Bennett",
    "Quinn Foster",
    "Cameron Price",
    "Avery Ellis",
  ].map((name, i) => ({
    name,
    role: i === 10 ? "Nurse" : "DSP",
    site: sites[Math.floor(i / 2)].name,
  })),
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
    site: "Oakwood House",
    category: "Emergency drills",
    owner: "James Wilson",
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
    person: "Liam Wilson",
    site: "Cedar House",
    category: "Equipment checks",
    owner: "Riley Carter",
    due: "2026-09-14",
    status: "Due soon",
    source: "Liam Wilson · PCSP 2026 · v1",
    page: 14,
    frequency: "Monthly",
  },
  {
    ...base,
    id: "REQ-125",
    title: "Renew enteral feeding delegation",
    person: "Mason Jackson",
    site: "Willow House",
    category: "Nursing delegations",
    owner: "Jamie Brooks",
    due: "2026-09-17",
    status: "Due soon",
    source: "Mason Jackson · Nursing plan · v1",
    page: 6,
    frequency: "Annually",
  },
  {
    ...base,
    id: "REQ-126",
    title: "Acknowledge specialized diet plan",
    person: "Sylvester Jones",
    site: "Maple House",
    category: "PCSP acknowledgments",
    owner: "Taylor Reed",
    due: "2026-09-16",
    status: "Due soon",
    source: "Sylvester Jones · PCSP 2026 · v1",
    page: 9,
  },
  {
    ...base,
    id: "REQ-127",
    title: "Complete monthly safety checklist",
    person: "Site-wide",
    site: "Birch House",
    category: "Required forms",
    owner: "Lisa Thompson",
    role: "House Manager",
    due: "2026-09-18",
    status: "Due soon",
    source: "Home safety policy · v2",
    page: 4,
    frequency: "Monthly",
  },
  {
    ...base,
    id: "REQ-128",
    title: "Record evacuation practice",
    person: "Site-wide",
    site: "Aspen House",
    category: "Emergency drills",
    owner: "David Garcia",
    role: "House Manager",
    due: "2026-09-18",
    status: "Due soon",
    source: "Emergency preparedness policy · v3",
    page: 8,
    frequency: "Monthly",
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
    person: "Liam Wilson",
    site: "Cedar House",
    category: "Behavior plan training",
    owner: "Emily Chen",
    role: "House Manager",
    due: "2026-09-16",
    status: "Pending review",
    source: "Liam Wilson · Behavior support plan · v2 draft",
    page: 5,
  },
];
export const seedRequirements: Requirement[] = [
  ...open,
  ...Array.from({ length: 120 }, (_, i) => {
    const person = individuals[i % 24];
    const category = categories[i % 6];
    return {
      ...base,
      id: `REQ-${String(i + 1).padStart(3, "0")}`,
      title: [
        "Acknowledge current PCSP",
        "Complete nursing delegation",
        "Verify adaptive equipment",
        "Complete behavior support training",
        "Record monthly emergency drill",
        "Complete required documentation",
      ][i % 6],
      person: person.name,
      site: person.site,
      category,
      owner: staff[6 + Math.floor((i % 24) / 4) * 2].name,
      due: "2026-09-08",
      status: "Compliant" as Status,
      source: `${person.name} · PCSP 2026 · v1`,
      page: 4 + (i % 12),
      evidence: `Sample signed completion record EV-${String(i + 1).padStart(3, "0")}`,
      completedAt: "2026-09-08T14:30:00.000Z",
    };
  }),
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
    name: "Liam Wilson · Behavior support plan",
    person: "Liam Wilson",
    site: "Cedar House",
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
    detail: "Jordan Lee · Ethan Brooks · Oakwood House",
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
    detail: "Sam Rivera · Willow House",
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
