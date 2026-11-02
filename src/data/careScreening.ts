import { assertCalendarDate } from './access';
import { centralTodayIso } from './menuRecords';
export interface CareItem {
  need: string;
  goal: string;
  interventions: string;
  roles: string[];
  review_on: string;
}
export interface CareDraft {
  title: string;
  items: CareItem[];
}
export interface CarePlan extends CareDraft {
  id: string;
  agency_id: string;
  individual_id: string;
  status: 'draft' | 'active' | 'revised' | 'retired';
  previous_id: string | null;
  created_by: string;
  created_at: string;
  approved_by: string | null;
  approved_at: string | null;
  retired_at: string | null;
}
export interface CareAck {
  plan_id: string;
  user_id: string;
  acknowledged_at: string;
}
export interface ScreeningType {
  id: string;
  agency_id: string;
  name: string;
  due_soon_days: number;
  enabled: boolean;
}
export interface ScreeningDraft {
  type_id: string;
  last_completed_on: string | null;
  due_on: string;
  completed_on: string | null;
  result_note: string;
  follow_up: string;
}
export interface Screening extends ScreeningDraft {
  id: string;
  agency_id: string;
  individual_id: string;
}
export interface CareScreeningData {
  plans: CarePlan[];
  acknowledgements: CareAck[];
  types: ScreeningType[];
  screenings: Screening[];
}
export type CareAction = {
  action: 'draft';
  individual_id: string;
  previous_id?: string;
  draft: CareDraft;
} | {
  action: 'approve' | 'retire' | 'acknowledge';
  id: string;
} | {
  action: 'type';
  id?: string;
  name: string;
  due_soon_days: number;
  enabled: boolean;
} | {
  action: 'screening';
  individual_id: string;
  id?: string;
  draft: ScreeningDraft;
};
export const emptyCareData = (): CareScreeningData => ({
  plans: [],
  acknowledgements: [],
  types: [],
  screenings: []
});
export const canManageCare = (role: string) => role === 'nurse';
export const canApproveCare = (role: string) => ['nurse', 'program_manager'].includes(role);
export const canViewCare = (role: string) => ['nurse', 'program_manager', 'house_manager', 'dsp', 'auditor', 'administrator', 'compliance_admin'].includes(role);
export const canViewScreening = (role: string) => canViewCare(role) && role !== 'dsp';
export const canAcknowledgeCare = (role: string) => ['nurse', 'program_manager', 'house_manager', 'dsp'].includes(role);
export function validateCareDraft(draft: CareDraft) {
  if (!draft.title.trim() || !draft.items.length) throw new Error('Add a plan title and at least one care item.');
  for (const item of draft.items) {
    if (![item.need, item.goal, item.interventions].every(v => v.trim()) || !item.roles.length || item.roles.some(r => !['nurse', 'program_manager', 'house_manager', 'dsp'].includes(r))) throw new Error('Each care item needs a health need or risk, goal, interventions, and responsible roles.');
    assertCalendarDate(item.review_on, 'Each care item needs a valid review date.');
  }
}
export function validateScreening(draft: ScreeningDraft, today = centralTodayIso()) {
  assertCalendarDate(draft.due_on);
  for (const date of [draft.last_completed_on, draft.completed_on]) {
    if (date) {
      assertCalendarDate(date);
      if (date > today) throw new Error('A completion date cannot be in the future.');
    }
  }
  if (draft.completed_on && !draft.result_note.trim()) throw new Error('Add a result note before completing a screening.');
}
export function screeningStatus(screening: ScreeningDraft, type: Pick<ScreeningType, 'due_soon_days'>, today = centralTodayIso()) {
  if (screening.completed_on) return 'completed';
  if (screening.due_on < today) return 'overdue';
  const boundary = new Date(`${today}T00:00:00Z`);
  boundary.setUTCDate(boundary.getUTCDate() + type.due_soon_days);
  return screening.due_on <= boundary.toISOString().slice(0, 10) ? 'due soon' : 'upcoming';
}
export function overdueCare(plan: CarePlan, today = centralTodayIso()) {
  return plan.status === 'active' && plan.items.some(item => item.review_on < today);
}
