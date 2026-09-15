/**
 * Missing-requirements aggregation — per site, per staff, per individual,
 * which required documents/certificates/checklists/trainings are missing.
 *
 * "Required" is defined by data, not hardcoded: the missing views fold
 * together
 *   - certificate kinds the agency requires (e.g. CPR, CPI, L1MA),
 *   - training topics the role requires,
 *   - documents the DMH readiness checklist expects per person,
 * and report who is missing what.
 *
 * Conservative: a missing record is "missing", never assumed present.
 */

export type MissingScope = "site" | "staff" | "individual";

export interface MissingRequirement {
  id: string;
  scope: MissingScope;
  /** e.g. "certificate", "training", "document", "checklist". */
  kind: string;
  what: string;
  ownerName: string;
  /** Who owns the site / who the staff or individual belongs to. */
  contextName?: string;
  dueOn?: string;
  expired: boolean;
  deepLink: string;
}

export interface MissingInput {
  now: Date;
  /** Certificate kinds every in-scope staffer must hold. */
  requiredCertificateKinds: string[];
  certificates: Array<{
    userId: string;
    staffName: string;
    siteName?: string;
    kind: string;
    expiresOn: string;
  }>;
  /** Training topics every in-scope staffer must have current. */
  requiredTrainingTopics: string[];
  trainings: Array<{
    userId: string;
    staffName: string;
    siteName?: string;
    topic: string;
    completedOn: string | null;
    /** Days a completion stays current (default 365). */
    validDays?: number;
  }>;
  staff: Array<{ userId: string; name: string; siteName?: string }>;
  individuals: Array<{ id: string; name: string; siteName: string }>;
  /** Required documents per individual (e.g. plan, ISP, emergency contacts). */
  requiredIndividualDocuments: string[];
  individualDocuments: Array<{
    individualId: string;
    individualName: string;
    siteName: string;
    documentType: string;
  }>;
  checklists: Array<{
    siteName: string;
    checklistTitle: string;
    dueOn: string;
    submitted: boolean;
  }>;
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function expiredOn(expiresOn: string, nowIso: string): boolean {
  return expiresOn < nowIso;
}

export function findMissing(input: MissingInput): MissingRequirement[] {
  const nowIso = iso(input.now);
  const missing: MissingRequirement[] = [];

  const certByUser = new Map<string, Map<string, string>>();
  for (const cert of input.certificates) {
    if (!certByUser.has(cert.userId)) certByUser.set(cert.userId, new Map());
    certByUser.get(cert.userId)!.set(cert.kind.toLowerCase(), cert.expiresOn);
  }

  const trainingByUser = new Map<string, Map<string, string | null>>();
  for (const training of input.trainings) {
    if (!trainingByUser.has(training.userId)) trainingByUser.set(training.userId, new Map());
    trainingByUser.get(training.userId)!.set(training.topic.toLowerCase(), training.completedOn);
  }
  const validDaysByTopic = new Map<string, number>();
  for (const training of input.trainings) {
    validDaysByTopic.set(training.topic.toLowerCase(), training.validDays ?? 365);
  }

  for (const person of input.staff) {
    const certs = certByUser.get(person.userId) ?? new Map();
    for (const kind of input.requiredCertificateKinds) {
      const expiresOn = certs.get(kind.toLowerCase());
      if (expiresOn && !expiredOn(expiresOn, nowIso)) continue;
      missing.push({
        id: `missing:cert:${person.userId}:${kind.toLowerCase()}`,
        scope: "staff",
        kind: "certificate",
        what: expiresOn ? `${kind} certificate (expired ${expiresOn})` : `${kind} certificate`,
        ownerName: person.name,
        contextName: person.siteName,
        dueOn: expiresOn && expiredOn(expiresOn, nowIso) ? expiresOn : undefined,
        expired: !!expiresOn && expiredOn(expiresOn, nowIso),
        deepLink: "/certificates",
      });
    }

    const completed = trainingByUser.get(person.userId) ?? new Map();
    for (const topic of input.requiredTrainingTopics) {
      const completedOn = completed.get(topic.toLowerCase());
      const validDays = validDaysByTopic.get(topic.toLowerCase()) ?? 365;
      const current =
        completedOn != null &&
        !expiredOn(
          new Date(Date.parse(`${completedOn}T00:00:00`) + validDays * 86400000)
            .toISOString()
            .slice(0, 10),
          nowIso,
        );
      if (current) continue;
      missing.push({
        id: `missing:training:${person.userId}:${topic.toLowerCase()}`,
        scope: "staff",
        kind: "training",
        what: `${topic} training`,
        ownerName: person.name,
        contextName: person.siteName,
        expired: completedOn != null,
        deepLink: "/training",
      });
    }
  }

  const docsByIndividual = new Map<string, Set<string>>();
  for (const doc of input.individualDocuments) {
    if (!docsByIndividual.has(doc.individualId)) docsByIndividual.set(doc.individualId, new Set());
    docsByIndividual.get(doc.individualId)!.add(doc.documentType.toLowerCase());
  }
  for (const individual of input.individuals) {
    const docs = docsByIndividual.get(individual.id) ?? new Set();
    for (const required of input.requiredIndividualDocuments) {
      if (docs.has(required.toLowerCase())) continue;
      missing.push({
        id: `missing:document:${individual.id}:${required.toLowerCase()}`,
        scope: "individual",
        kind: "document",
        what: required,
        ownerName: individual.name,
        contextName: individual.siteName,
        expired: false,
        deepLink: "/documents",
      });
    }
  }

  for (const checklist of input.checklists) {
    if (checklist.submitted) continue;
    if (!expiredOn(checklist.dueOn, nowIso)) continue; // not missing yet, just upcoming
    missing.push({
      id: `missing:checklist:${checklist.siteName}:${checklist.dueOn}:${checklist.checklistTitle.toLowerCase()}`,
      scope: "site",
      kind: "checklist",
      what: `${checklist.checklistTitle} (due ${checklist.dueOn})`,
      ownerName: checklist.siteName,
      expired: true,
      deepLink: "/checklists",
    });
  }

  return missing;
}

export function missingByScope(
  items: MissingRequirement[],
): Record<MissingScope, MissingRequirement[]> {
  const grouped: Record<MissingScope, MissingRequirement[]> = {
    site: [],
    staff: [],
    individual: [],
  };
  for (const item of items) grouped[item.scope].push(item);
  return grouped;
}

/** Per-site rollup for the command center: site -> count of missing items. */
export function missingBySite(
  items: MissingRequirement[],
): Array<{ siteName: string; count: number; items: MissingRequirement[] }> {
  const bySite = new Map<string, MissingRequirement[]>();
  for (const item of items) {
    const site = item.contextName ?? item.ownerName;
    if (!bySite.has(site)) bySite.set(site, []);
    bySite.get(site)!.push(item);
  }
  return [...bySite.entries()]
    .map(([siteName, siteItems]) => ({ siteName, count: siteItems.length, items: siteItems }))
    .sort((a, b) => b.count - a.count || a.siteName.localeCompare(b.siteName));
}
