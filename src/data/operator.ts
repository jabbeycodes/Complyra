import type { AgencyStatus, PendingAgency } from "./types";
export interface OperatorAgency extends PendingAgency {
  createdAt: string | null; active: boolean; reportingCategory: "customer" | "demo" | "internal";
}
export function filterOperatorAgencies(rows: OperatorAgency[], query: string, status: string, category: string) {
  const q = query.trim().toLowerCase();
  return rows.filter((a) => (!q || `${a.name} ${a.agencyCode} ${a.stateCode}`.toLowerCase().includes(q))
    && (status === "all" || (status === "disabled" ? !a.active : a.status === status))
    && (category === "all" || a.reportingCategory === category));
}
export const OPERATOR_PAGES = ["Operator agencies"] as const;
export type OperatorStatus = AgencyStatus;
