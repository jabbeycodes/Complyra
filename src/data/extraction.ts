import { proposeFromPcsp, type ObligationItem } from "./planStack";

/**
 * Recommended PCSP extractor: Gemini through the document-extraction
 * pipeline (supabase/functions/extract-pcsp).
 *
 * PCSPs are long narrative PDFs, not fixed forms. The pipeline sends the
 * document text to Gemini with a strict JSON responseSchema (v1), validates
 * the output, and proposes typed trackable items — deadlines, training
 * requirements, protocols needing delegation, physician orders, and missing
 * signatures. A DPM/RN then reviews, edits, approves (nothing becomes
 * tracked before approval), and activates each item; protocol items hand
 * off into the delegation system.
 *
 * Keys and AI settings live server-side: a Vertex AI service-account JSON
 * (VERTEX_SERVICE_ACCOUNT_JSON), project id (VERTEX_PROJECT_ID), and
 * location (VERTEX_LOCATION) are Supabase function secrets (never stored in
 * agency_ai_settings — only the verification timestamp and project id are),
 * and AI processing stays OFF until an administrator enables it after a
 * Google Cloud BAA is in place. See docs/ai-model-settings.md and
 * docs/vertex-ai-setup.md. The edge function truncates document text
 * server-side (~120k chars) for PHI minimization.
 *
 * This module's LOCAL path stays a pure demo: extractPlanProposal() calls
 * proposeFromPcsp() — the same proposed stack a DPM would review — never a
 * real model. Live calls belong in the extract-pcsp edge function.
 */
export const EXTRACTION_PROVIDER = {
  id: "gemini-extraction-pipeline",
  name: "Gemini document extraction pipeline",
  model: "gemini-2.5-flash",
} as const;

export function extractPlanProposal(input: {
  agencyId: string;
  individualId: string;
  documentVersionId: string;
  expiresOn: string | null;
  personName: string;
  effectiveOn: string;
}): ObligationItem[] {
  // Live Gemini calls belong in the extract-pcsp edge function. Local/demo
  // uses the same proposed stack a DPM would review after extraction.
  return proposeFromPcsp(input);
}
