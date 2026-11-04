import { metrics, type Requirement } from '../../domain';

/** A requirement register is not an agency readiness score. No rows is not a pass. */
export function requirementPopulation(items: Requirement[], available = true) {
  const counts = metrics(items);
  const assessed = available && counts.total > 0;
  return {
    ...counts,
    assessed,
    scoreText: assessed ? `${counts.score}%` : 'Not assessed',
    status: !available ? 'Unavailable' : !counts.total ? 'Not assessed' : counts.overdue ? 'Needs attention' : 'No overdue requirements',
    explanation: !available
      ? 'Requirement records are unavailable in your current access. This is not a compliance result.'
      : !counts.total
        ? 'No active requirement records in this scope. This does not assess consents, monthly checks, staff binders, or DMH readiness.'
        : 'Requirement register only. Consents, monthly checks, staff binders, and DMH readiness have separate populations.',
  };
}
