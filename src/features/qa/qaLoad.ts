import type {
  QaAudit,
  QaAuditSchedule,
  QaRankedSite,
} from "../../data/qaAudit";

/**
 * QA Review page data loading (simulation batch 16). The Reviews list
 * is the page's primary content; schedules and site ranking are heavier
 * secondary reads. The page used to Promise.all all three, so a slow or
 * failed ranking call left Reviews blank behind a single error. Here
 * the audits read stands alone — its rejection propagates to the page's
 * error state — while schedules/ranking degrade to null (their tabs
 * show a side notice) without touching the reviews.
 */
export interface QaPageDataSources {
  listAudits(): Promise<QaAudit[]>;
  listSchedules(): Promise<QaAuditSchedule[]>;
  getRanking(): Promise<QaRankedSite[]>;
}

export interface QaPageData {
  audits: QaAudit[];
  schedules: QaAuditSchedule[] | null;
  ranking: QaRankedSite[] | null;
}

export async function loadQaPageData(
  sources: QaPageDataSources,
): Promise<QaPageData> {
  const audits = await sources.listAudits();
  const [schedules, ranking] = await Promise.all([
    sources.listSchedules().catch(() => null),
    sources.getRanking().catch(() => null),
  ]);
  return { audits, schedules, ranking };
}
