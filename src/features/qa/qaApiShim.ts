import type { ComplyraApi } from "../../data/localApi";
/** Compatibility alias; QA is part of the shared API now. */
export type QaApi = ComplyraApi;

/** Recognize a structured evidence conflict from either data adapter. */
export function asQaBlockedError(err: unknown): { evidence: string } | null {
  if (!(err instanceof Error)) return null;
  const named = err as Error & { name?: unknown; evidence?: unknown };
  if (named.name !== "QaBlockedError") return null;
  if (typeof named.evidence !== "string" || named.evidence.length === 0)
    return null;
  return { evidence: named.evidence };
}
