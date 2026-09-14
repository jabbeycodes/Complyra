/**
 * Assign training modal (LIFEPATH-P2 training engine).
 *
 * Generates the full in-home training checklist for one staff member at one
 * site: sections 1–5 once for the site, section 6 once per individual.
 *
 * QA hardening:
 * - The "Generate checklist" button is enabled exactly when a staff member
 *   AND a site are selected and no submission is in flight
 *   (see `canGenerateChecklist`).
 * - A single-flight guard (`createSubmitGuard`) guarantees one click starts
 *   exactly one `assignTraining` call, so a double-click can never create
 *   duplicate assignments or duplicate activity-log entries.
 * - Selections start empty behind explicit "Select…" placeholders and are
 *   re-validated if the roster data changes under the open modal, so the
 *   button can never submit a stale or missing id.
 */
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Modal } from "../../components";

export interface AssignTrainingSelection {
  userId: string;
  siteId: string;
  busy: boolean;
}

export interface AssignTrainingInput {
  userId: string;
  siteId: string;
  individualId?: string | null;
  source: "checklist";
}

/**
 * Button enablement rule, kept pure so it can be unit-tested: the button is
 * enabled exactly when a staff member and a site are both selected and no
 * submission is currently in flight. The individual picker is optional and
 * never gates the button.
 */
export function canGenerateChecklist({
  userId,
  siteId,
  busy,
}: AssignTrainingSelection): boolean {
  return userId.trim() !== "" && siteId.trim() !== "" && !busy;
}

/**
 * Single-flight submit guard. `tryStart()` returns false when a submission
 * is already in flight (e.g. a rapid double-click before React re-renders
 * the disabled button); `reset()` re-arms the guard. The modal re-arms when
 * the parent's `busy` flag clears so a failed attempt can be retried.
 */
export function createSubmitGuard() {
  let inFlight = false;
  return {
    tryStart(): boolean {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    reset(): void {
      inFlight = false;
    },
  };
}

export default function AssignTrainingModal({
  staff,
  sites,
  individuals,
  busy,
  onClose,
  onSubmit,
}: {
  staff: { id: string; name: string }[];
  sites: { id: string; name: string }[];
  individuals: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: AssignTrainingInput) => void;
}) {
  const [userId, setUserId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [individualId, setIndividualId] = useState("");
  const guardRef = useRef<ReturnType<typeof createSubmitGuard> | null>(null);
  if (guardRef.current === null) guardRef.current = createSubmitGuard();
  const guard = guardRef.current;

  // If the roster data refreshes under the open modal, drop selections that
  // no longer exist so the button can never submit a stale id.
  useEffect(() => {
    if (userId && !staff.some((person) => person.id === userId)) setUserId("");
  }, [staff, userId]);
  useEffect(() => {
    if (siteId && !sites.some((site) => site.id === siteId)) setSiteId("");
  }, [sites, siteId]);
  // Re-arm the guard once the submission settles so a failed attempt can be
  // retried; while busy the guard blocks any repeat submit.
  useEffect(() => {
    if (!busy) guard.reset();
  }, [busy]);

  const enabled = canGenerateChecklist({ userId, siteId, busy });
  const nothingToAssign = staff.length === 0 || sites.length === 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!enabled) return;
    if (!guard.tryStart()) return;
    onSubmit({
      userId,
      siteId,
      individualId: individualId || null,
      source: "checklist",
    });
  }

  return (
    <Modal title="Assign training" onClose={onClose}>
      <p className="muted">
        Generates the full in-home checklist: sections 1–5 once for the site,
        section 6 once per individual. Lines already assigned are skipped.
      </p>
      {nothingToAssign ? (
        <p className="form-error" role="alert">
          {staff.length === 0
            ? "There are no staff members to assign training to yet."
            : "There are no program sites to assign training at yet."}
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          <label>
            Staff member
            <select
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
            >
              <option value="">Select a staff member…</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Site
            <select
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              required
            >
              <option value="">Select a site…</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Individual (adds section 6 for this person)
            <select
              value={individualId}
              onChange={(e) => setIndividualId(e.target.value)}
            >
              <option value="">— none —</option>
              {individuals.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary touch"
            type="submit"
            disabled={!enabled}
          >
            Generate checklist
          </button>
        </form>
      )}
    </Modal>
  );
}
