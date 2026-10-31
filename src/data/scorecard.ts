/** Requirement-only scorecard. Never turn a malformed/missing RPC result into 100%. */
export interface RequirementScorecard {
  score: number;
  total: number;
  done: number;
  overdue: number;
  dueSoon: number;
  review: number;
}

export function parseRequirementScorecard(value: unknown): RequirementScorecard {
  const row = value as Record<string, unknown> | null;
  const keys = ['score', 'total', 'done', 'overdue', 'dueSoon', 'review'] as const;
  if (!row || keys.some(key => typeof row[key] !== 'number' || !Number.isSafeInteger(row[key]) || (row[key] as number) < 0)) {
    throw new Error('Requirement score unavailable. Reload to try again.');
  }
  const result = row as unknown as RequirementScorecard;
  if (result.score > 100 || result.done + result.overdue + result.dueSoon > result.total ||
      result.score !== (result.total ? Math.round(100 * result.done / result.total) : 100)) {
    throw new Error('Requirement score unavailable. Reload to try again.');
  }
  return result;
}
