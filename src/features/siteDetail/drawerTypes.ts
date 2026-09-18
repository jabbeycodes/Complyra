import type { QaAuditItemState } from "../../data/qaAudit";
import type { StaffTrainingProfile } from "../../data/types";

export type { DrillBucket, CertExpiryRow } from "./trackables";

export interface TrainingRowLike {
  userId: string;
  name: string;
  role: string;
  profile: Pick<StaffTrainingProfile, "clearedForInRatio" | "counts"> | null;
  failed: boolean;
}

export interface QaDisputeRowLike {
  auditId: string;
  auditLabel: string;
  /** Human label for the disputed item (qaItemLabel text from the API). */
  itemId: string;
  item: QaAuditItemState;
}
