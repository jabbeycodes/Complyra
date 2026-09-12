import { proposeFromPcsp, type ObligationItem } from "./planStack";

/**
 * Recommended PCSP extractor: Anthropic Claude.
 *
 * PCSPs are long narrative PDFs, not fixed forms. Claude reads that structure
 * well and can return cover-page fields plus proposed required/checked items.
 * A DPM still edits before anything becomes a staff task.
 *
 * For real care records later, run Claude on Amazon Bedrock (or Azure OpenAI)
 * under a BAA. Do not send PHI from the browser. The key stays on a worker.
 */
export const EXTRACTION_PROVIDER = {
  id: "anthropic-claude",
  name: "Anthropic Claude",
  model: "claude-sonnet-4-6",
} as const;

export function extractPlanProposal(input: {
  agencyId: string;
  individualId: string;
  documentVersionId: string;
  expiresOn: string | null;
  personName: string;
  effectiveOn: string;
}): ObligationItem[] {
  // Live Claude calls belong in a hosted worker. Local/demo uses the same
  // proposed stack a DPM would review after extraction.
  return proposeFromPcsp(input);
}
