import type { ComplyraApi } from "../../data/localApi";
import type { TrainingRequirementView } from "../../data/types";
import {
  trainingChecklistDocId,
  trainingLineFieldName,
  trainingLinePayload,
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
    trainerName: string;
    reinit?: boolean;
  },
): Promise<"initialed" | "saved_for_staff"> {
  const { sessionUserId, staffUserId, requirement, input, trainerName, reinit } =
    args;
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
  const fresh = await api.getStaffTrainingProfile(staffUserId);
  const freshLine = fresh.requirements.find((row) => row.id === requirement.id);
  if (!freshLine) throw new Error("Training line not found.");
  const nextVersion = (freshLine.signoff?.signoffVersion ?? 0) + 1;
  await api.initialRequirementLine(requirement.id, input);
  await api.applySignature({
    documentType: "training_checklist",
    documentId: trainingChecklistDocId(staffUserId, siteId),
    fieldName: trainingLineFieldName(requirement.id, nextVersion),
    kind: "initials",
    documentPayload: trainingLinePayload({
      topicId: requirement.topicId,
      topicTitle: requirement.topicTitle,
      // initialRequirementLine flips the line to complete.
      resolvedStatus: "complete",
      trainerName,
      hoursTotal: input.hoursTotal ?? 0,
      hoursWithHm: input.hoursWithHm ?? 0,
      signedOn: (input.signedOn ?? "").slice(0, 10),
      na: false,
      naReason: null,
      signoffVersion: nextVersion,
    }),
  });
  return "initialed";
}
