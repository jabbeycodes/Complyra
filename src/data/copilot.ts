import type { Requirement } from "../domain";

/**
 * Ask Complyrer framing: suggested questions and disclosure/answer copy.
 *
 * Batch 13: the modal hard-coded the Evergreen demo's content — the
 * suggestion "Who needs to acknowledge Ellis's PCSP?" and the disclosure
 * "Grounded lookups in sample records" — and presented it to real
 * hosted agencies, naming a person who does not exist in their agency.
 * The assistant's answers were already computed from the current
 * workspace; only the framing leaked. Framing now derives from the
 * current (already scope-filtered) workspace and the session kind:
 *   * the PCSP suggestion names an Individual of THIS agency who
 *     actually has PCSP acknowledgment work in scope — never a person
 *     the caller cannot see, never a hard-coded demo name;
 *   * "sample" wording appears only inside the Evergreen demo session.
 */

export interface CopilotPerson {
  name: string;
}

function firstNameOf(name: string): string {
  return name.split(" ")[0] ?? name;
}

export function copilotSuggestions(input: {
  demoMode: boolean;
  individuals: CopilotPerson[];
  requirements: Requirement[];
}): string[] {
  const suggestions = [
    "What should we fix before an audit?",
    "Which delegations are expiring?",
  ];
  const pcspPerson = input.individuals.find((person) =>
    input.requirements.some(
      (r) => r.person === person.name && r.category === "PCSP acknowledgments",
    ),
  );
  suggestions.push(
    pcspPerson
      ? `Who needs to acknowledge ${firstNameOf(pcspPerson.name)}’s PCSP?`
      : "What’s overdue right now?",
  );
  return suggestions;
}

export function copilotDisclosure(demoMode: boolean, siteLabel: string): string {
  return demoMode
    ? `Preview · Grounded lookups in sample records · ${siteLabel}`
    : `Preview · Grounded lookups in your agency’s records · ${siteLabel}`;
}

export function copilotScopeLabel(demoMode: boolean, siteLabel: string): string {
  if (siteLabel !== "All sites") return siteLabel;
  return demoMode ? "the sample agency" : "your agency";
}

export function copilotEmptyText(demoMode: boolean): string {
  return demoMode
    ? "There are no matching requirements in the current sample data and site selection. This does not confirm that a care instruction is absent from a real plan."
    : "There are no matching requirements in your current records and site selection. This does not confirm that a care instruction is absent from a real plan.";
}

export function copilotFallbackText(demoMode: boolean): string {
  return demoMode
    ? "This preview can look up requirements, overdue work, delegations, equipment checks, and plan acknowledgments in the sample records. Try “What should we fix before an audit?”"
    : "This preview can look up requirements, overdue work, delegations, equipment checks, and plan acknowledgments in your agency’s records. Try “What should we fix before an audit?”";
}
