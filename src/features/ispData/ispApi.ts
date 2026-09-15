/**
 * ISP data API surface for the UI stream (contract §7).
 *
 * The §6 methods live on `ComplyraApi` and are implemented by the API
 * stream (branch `lifepath/isp-data-api`, files `src/data/localApi.ts` /
 * `src/data/hostedApi.ts`), which is being built in parallel against the
 * same contract signatures. This base (stream A's tip) does not have those
 * methods yet, so the UI codes against this interface — every signature here
 * matches contract §6 exactly — and casts the data-provider API to it via
 * `useIspApi()`. When the parent merges the API branch, the cast resolves
 * to the real implementations with no UI changes.
 */
import { useData } from "../../data/DataProvider";
import type {
  AmendIspNoteInput,
  HouseShiftBoard,
  IspEscalation,
  IspEscalationInput,
  IspExpectationFilter,
  IspExpectationView,
  IspGoal,
  IspGoalInput,
  IspMonthlyReport,
  IspMonthlySections,
  IspMonthlySignature,
  IspMonthlySignerRole,
  IspMonthlyStatus,
  IspNote,
  IspNoteAmendment,
  IspNoteDetail,
  IspNoteFilter,
  IspNoteSettings,
  IspObjective,
  IspObjectiveInput,
  IspRepeatOffender,
  IspShiftAssignment,
  IspShiftAssignmentInput,
  IspShiftPattern,
  IspShiftPatternInput,
  IspTrackable,
  IspTrackableInput,
  SubmitIspNoteInput,
} from "../../data/types";
import type { IspEscalationDecision } from "../../data/ispData";

/** Contract §6 method signatures — mirror of the ComplyraApi ISP additions. */
export interface IspDataApi {
  ispListShiftPatterns(siteId: string): Promise<IspShiftPattern[]>;
  ispSaveShiftPattern(input: IspShiftPatternInput): Promise<IspShiftPattern>;
  ispDeleteShiftPattern(id: string): Promise<void>;
  ispListShiftAssignments(
    siteId: string,
    fromDate: string,
    toDate: string,
  ): Promise<IspShiftAssignment[]>;
  ispSaveShiftAssignment(
    input: IspShiftAssignmentInput,
  ): Promise<IspShiftAssignment>;
  ispDeleteShiftAssignment(id: string): Promise<void>;
  ispListExpectations(
    filter: IspExpectationFilter,
  ): Promise<IspExpectationView[]>;
  ispExcuseExpectation(id: string, reason: string): Promise<void>;
  ispListGoals(individualId: string): Promise<IspGoal[]>;
  ispSaveGoal(input: IspGoalInput): Promise<IspGoal>;
  ispListObjectives(goalId: string): Promise<IspObjective[]>;
  ispSaveObjective(input: IspObjectiveInput): Promise<IspObjective>;
  ispListTrackables(objectiveId: string): Promise<IspTrackable[]>;
  ispListIndividualTrackables(individualId: string): Promise<IspTrackable[]>;
  ispSaveTrackable(input: IspTrackableInput): Promise<IspTrackable>;
  ispAssignTrackable(trackableId: string, userId: string): Promise<void>;
  ispListMyTrackables(individualId: string): Promise<IspTrackable[]>;
  ispSubmitNote(input: SubmitIspNoteInput): Promise<IspNote>;
  ispListNotes(filter: IspNoteFilter): Promise<IspNote[]>;
  ispGetNote(id: string): Promise<IspNoteDetail>;
  ispAmendNote(input: AmendIspNoteInput): Promise<IspNoteAmendment>;
  ispGenerateMonthlyReport(
    individualId: string,
    serviceMonth: string,
  ): Promise<IspMonthlyReport>;
  ispGetMonthlyReport(
    individualId: string,
    serviceMonth: string,
  ): Promise<IspMonthlyReport | null>;
  ispUpdateMonthlySections(
    reportId: string,
    sections: IspMonthlySections,
  ): Promise<void>;
  ispSubmitMonthlyForReview(
    reportId: string,
    next: IspMonthlyStatus,
  ): Promise<void>;
  ispSignMonthlyReport(
    reportId: string,
    role: IspMonthlySignerRole,
  ): Promise<IspMonthlySignature>;
  ispListMonthlySignatures(
    reportId: string,
  ): Promise<IspMonthlySignature[]>;
  ispOverdueNotes(siteId?: string): Promise<IspExpectationView[]>;
  ispHouseShiftBoard(
    siteId: string,
    date: string,
  ): Promise<HouseShiftBoard>;
  ispSendEscalation(input: IspEscalationInput): Promise<IspEscalation>;
  ispRunEscalationSweep(): Promise<IspEscalationDecision[]>;
  ispRepeatOffenders(days?: number): Promise<IspRepeatOffender[]>;
  ispGetNoteSettings(): Promise<IspNoteSettings>;
  ispSaveNoteSettings(
    input: Partial<IspNoteSettings>,
  ): Promise<IspNoteSettings>;
}

/**
 * Returns the §6 ISP API. On the UI branch this is a cast against the
 * contract signatures; after the parent merges `lifepath/isp-data-api`,
 * these are the real ComplyraApi methods.
 */
export function useIspApi(): IspDataApi {
  const { api } = useData();
  return api as unknown as IspDataApi;
}
