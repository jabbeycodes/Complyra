import type { SignatureEvent, TrainingRequirementView } from "../../data/types";
import {
  latestLineEvent,
  lineNeedsReinitial,
  trainingLinePayloadFromView,
} from "../signatures/documentPayloads";
import { signatureDocumentHash } from "../signatures/signatureUtils";

/**
 * Where one training line's e-initials stand:
 * - "unsigned": no sign-off yet (the line offers Initial).
 * - "na": waived, nothing to stamp.
 * - "missing": the current sign-off version has no stamp (a manager saved
 *   it, or a save landed but its stamp failed).
 * - "invalid": a stamp exists for the current version but the line no longer
 *   hashes to what was sealed.
 * - "valid": stamped and unchanged since.
 *
 * "missing" and "invalid" both leave the line unusable for the checklist, so
 * the line's OWNER is offered Re-initial for either.
 */
export type TrainingLineSealState = "unsigned" | "na" | "missing" | "invalid" | "valid";

export async function trainingLineSealState(
  line: TrainingRequirementView,
  events: SignatureEvent[],
): Promise<TrainingLineSealState> {
  const signoff = line.signoff;
  if (!signoff) return "unsigned";
  if (signoff.na) return "na";
  const latest = latestLineEvent(events, line.id);
  if (!latest || lineNeedsReinitial(signoff, events, line.id)) return "missing";
  try {
    const recomputed = await signatureDocumentHash(
      "training_checklist",
      latest.documentId,
      latest.fieldName,
      trainingLinePayloadFromView(line),
    );
    return recomputed === latest.documentHash ? "valid" : "invalid";
  } catch {
    return "invalid";
  }
}

/** True when the line's owner must re-initial it (stamp missing or invalid). */
export function sealNeedsReinitial(state: TrainingLineSealState | undefined): boolean {
  return state === "missing" || state === "invalid";
}
