import type { ComplyraApi } from "../../data/localApi";
import type { TrainingRequirementView } from "../../data/types";
import {
  trainingChecklistDocId,
  trainingLineFieldName,
  trainingLinePayloadFromView,
} from "../signatures/documentPayloads";

type TrainingLineSignoffInput = Parameters<
  ComplyraApi["initialRequirementLine"]
>[1];

/**
 * Save a training line and stamp the signer's e-initials.
 *
 * The stamp needs the saved sign-off version, so the save has to come first.
 * That made a rejected signature expensive: the line had already taken the new
 * "Recorded by" and version when the stamp was refused. So the owner's signing
 * ceremony is checked before anything is written; a refusal, including the
 * password re-entry prompt, leaves the record exactly as it was.
 *
 * The stamped payload is rebuilt from the SAVED line, exactly as the seal
 * rebuilds it later (trainingLinePayloadFromView). Building it from the form
 * input sealed values the save does not keep verbatim — the trainer name is
 * re-resolved from the roster server-side, a missing date becomes today, and
 * on hosted the line status stayed "pending" under RLS — so every correct
 * initialing read "Signature invalid" on the next load (batches 307-310).
 *
 * Only the assigned staff member can initial their own lines. A manager may
 * still save a line for them, with no stamp attempted, and the line then reads
 * "Needs re-initialing" until they do. Re-initialing is nothing but a stamp, so
 * a manager asking for one is refused before any write.
 */
export async function saveAndInitialTrainingLine(
  api: ComplyraApi,
  args: {
    sessionUserId: string;
    staffUserId: string;
    requirement: TrainingRequirementView;
    input: TrainingLineSignoffInput;
    reinit?: boolean;
  },
): Promise<"initialed" | "saved_for_staff"> {
  const { sessionUserId, staffUserId, requirement, input, reinit } = args;
  const siteId = requirement.siteId ?? "";
  if (sessionUserId !== staffUserId) {
    if (reinit) {
      throw new Error(
        "Only the assigned staff member can initial their own training lines.",
      );
    }
    await api.initialRequirementLine(requirement.id, input);
    return "saved_for_staff";
  }
  await api.checkTrainingLineSignable({
    staffUserId,
    siteId,
    requirementId: requirement.id,
  });
  // Re-read the line so the versioned field name is authoritative even if an
  // earlier attempt saved the line but failed to stamp.
  const before = await readLine(api, staffUserId, requirement.id);
  const nextVersion = (before.signoff?.signoffVersion ?? 0) + 1;
  await api.initialRequirementLine(requirement.id, input);
  const saved = await readLine(api, staffUserId, requirement.id);
  const savedVersion = saved.signoff?.signoffVersion ?? 0;
  if (!saved.signoff || saved.signoff.na || savedVersion !== nextVersion) {
    throw new Error(
      "This line changed while it was being saved. Reload and initial it again.",
    );
  }
  if (saved.resolvedStatus !== "complete") {
    // Never seal a line that does not read complete: the seal would break
    // the moment the status caught up. The line stays "Needs re-initialing".
    throw new Error(
      "The sign-off was saved, but the line could not be marked complete. Reload and re-initial it.",
    );
  }
  await api.applySignature({
    documentType: "training_checklist",
    documentId: trainingChecklistDocId(staffUserId, siteId),
    fieldName: trainingLineFieldName(requirement.id, savedVersion),
    kind: "initials",
    documentPayload: trainingLinePayloadFromView(saved),
  });
  return "initialed";
}

async function readLine(
  api: ComplyraApi,
  staffUserId: string,
  requirementId: string,
): Promise<TrainingRequirementView> {
  const profile = await api.getStaffTrainingProfile(staffUserId);
  const line = profile.requirements.find((row) => row.id === requirementId);
  if (!line) throw new Error("Training line not found.");
  return line;
}
