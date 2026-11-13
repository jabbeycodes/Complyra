import { metrics, type Requirement } from '../../domain';
import { CONSENT_ITEM_CATEGORY } from './consentCompliance';

/**
 * One scored population, described as what it actually holds. A
 * requirement register is not an agency readiness score, and no rows is
 * not a pass. Consent currency counts in compliance scores (founder
 * decision, 2026-11-02), so when scored consent items are in the pool
 * the population is a combined requirement-and-consent population and
 * says so — in its explanation, its scope name, its count noun, and its
 * clear status. A requirements-only pool keeps the register-only
 * wording. While the consent register is still loading
 * (`consentsPending`), a register-only explanation says the score is
 * not final instead of presenting a partial figure as the whole
 * picture — the same honesty the consentUnknown surfaces apply.
 */
export function requirementPopulation(items: Requirement[], available = true, consentsPending = false) {
  const counts = metrics(items);
  const assessed = available && counts.total > 0;
  const includesConsents = items.some((item) => item.category === CONSENT_ITEM_CATEGORY);
  return {
    ...counts,
    assessed,
    includesConsents,
    scopeName: includesConsents ? 'Requirements and consents' : 'Requirement register',
    itemNoun: includesConsents ? 'requirements and consents' : 'requirements',
    scoreText: assessed ? `${counts.score}%` : 'Not assessed',
    status: !available
      ? 'Unavailable'
      : !counts.total
        ? 'Not assessed'
        : counts.overdue
          ? 'Needs attention'
          : includesConsents
            ? 'No overdue requirements or consents'
            : 'No overdue requirements',
    explanation: !available
      ? 'Requirement records are unavailable in your current access. This is not a compliance result.'
      : !counts.total
        ? 'No active requirement records in this scope. This does not assess consents, monthly checks, staff binders, or DMH readiness.'
        : includesConsents
          ? 'Requirements and consents in this scope, scored together. Monthly checks, staff binders, and DMH readiness have separate populations.'
          : consentsPending
            ? 'Requirement register only — consent records are still loading, so this score is not final. Monthly checks, staff binders, and DMH readiness have separate populations.'
            : 'Requirement register only. Consents, monthly checks, staff binders, and DMH readiness have separate populations.',
  };
}
