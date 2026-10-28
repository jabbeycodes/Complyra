/**
 * Time-off ↔ scheduling integration.
 *
 * When a time-off request is APPROVED, the requester's scheduled shifts on
 * the approved days are released to the open-shift board as temporary
 * coverage postings (reason: time off), and the original shifts are
 * cancelled with the release recorded in their notes — the original
 * assignment stays visible in the shift record, never silently dropped.
 * When an approved request is CANCELLED before it starts, the release is
 * reversed: still-open postings are cancelled and the original shifts are
 * restored to published.
 *
 * Postings and shifts are tied to the request by a `[time-off:<id>]`
 * marker written into their notes, so the reversal can find exactly the
 * rows a release created. A shift that has already started cannot be
 * posted (open-shift postings must start in the future); it is left
 * assigned, annotated with the marker, and counted as flagged so the
 * approver sees it in the outcome.
 */
import type { HrShift, HrTimeOffRequest } from "./hr";
import type { HrStore } from "./hrStore";
import type { OpenShiftStore } from "./openShiftStore";

export function timeOffReleaseMarker(requestId: string): string {
  return `[time-off:${requestId}]`;
}

export interface TimeOffCoverageOutcome {
  /** Shifts released to the open-shift board. */
  released: number;
  /** Shifts that could not be posted (already started, or no site) — left assigned and annotated. */
  flagged: number;
  /** Original shifts restored when a cancellation reversed a release. */
  restored: number;
  /** Still-open coverage postings cancelled by a reversal. */
  postingsCancelled: number;
  /** Coverage postings that were already picked up when a reversal ran. */
  postingsFilled: number;
  failures: string[];
}

function emptyOutcome(): TimeOffCoverageOutcome {
  return {
    released: 0,
    flagged: 0,
    restored: 0,
    postingsCancelled: 0,
    postingsFilled: 0,
    failures: [],
  };
}

function appendNote(existing: string | null, addition: string): string {
  return existing?.trim() ? `${existing.trim()} ${addition}` : addition;
}

function todayStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The requester's still-active shifts that start on one of the request's days. */
export function shiftsForTimeOffRequest(
  shifts: readonly HrShift[],
  request: Pick<HrTimeOffRequest, "staffId" | "days">,
): HrShift[] {
  const days = new Set(request.days.map((d) => d.date));
  return shifts.filter(
    (s) =>
      s.staffId === request.staffId &&
      s.status !== "cancelled" &&
      days.has(s.startsAt.slice(0, 10)),
  );
}

function requestWindow(request: Pick<HrTimeOffRequest, "startsOn" | "endsOn">): {
  from: string;
  to: string;
} {
  return { from: `${request.startsOn}T00:00:00`, to: `${request.endsOn}T23:59:59.999` };
}

/**
 * Release the approved requester's shifts to the open-shift board.
 * Best-effort per shift: one bad shift never blocks the others, and every
 * outcome is counted for the approver's confirmation message.
 */
export async function releaseShiftsForApprovedTimeOff(args: {
  hrStore: HrStore;
  openShiftStore: OpenShiftStore;
  request: HrTimeOffRequest;
  staffName: string;
}): Promise<TimeOffCoverageOutcome> {
  const { hrStore, openShiftStore, request, staffName } = args;
  const outcome = emptyOutcome();
  const marker = timeOffReleaseMarker(request.id);
  const { from, to } = requestWindow(request);
  let scheduled: HrShift[] = [];
  try {
    scheduled = shiftsForTimeOffRequest(await hrStore.listShifts(from, to), request);
  } catch (err) {
    outcome.failures.push(
      `Could not load the schedule to release shifts: ${err instanceof Error ? err.message : String(err)}`,
    );
    return outcome;
  }
  for (const shift of scheduled) {
    if (!shift.siteId) {
      // A posting needs a program site; annotate instead of dropping.
      try {
        await hrStore.updateShift(shift.id, {
          notes: appendNote(
            shift.notes,
            `${marker} Approved time off overlaps this shift — it has no program site, so no board posting was created. Arrange coverage.`,
          ),
        });
        outcome.flagged += 1;
      } catch (err) {
        outcome.failures.push(
          `Shift ${shift.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      continue;
    }
    try {
      const postingId = await openShiftStore.postOpenShift({
        siteId: shift.siteId,
        kind: "temporary",
        audience: "site",
        title: shift.title?.trim() ? shift.title : "Coverage",
        startsAt: shift.startsAt,
        endsAt: shift.endsAt,
        pickupMode: "first_come",
        slots: 1,
        notes: `Time off coverage for ${staffName}. ${marker}`,
      });
      await hrStore.updateShift(shift.id, {
        status: "cancelled",
        notes: appendNote(
          shift.notes,
          `${marker} Released to the open-shift board on ${todayStamp()} — ${staffName} has approved time off. Coverage posting ${postingId}. Originally assigned to ${staffName}.`,
        ),
      });
      outcome.released += 1;
    } catch (err) {
      // Most likely the shift already started (postings must start in the
      // future). Keep it assigned and visibly annotated — no silent loss.
      const message = err instanceof Error ? err.message : String(err);
      try {
        await hrStore.updateShift(shift.id, {
          notes: appendNote(
            shift.notes,
            `${marker} Approved time off overlaps this shift, but it could not be posted to the board (${message}) Arrange coverage.`,
          ),
        });
        outcome.flagged += 1;
      } catch {
        outcome.failures.push(`Shift ${shift.id}: ${message}`);
      }
    }
  }
  return outcome;
}

/**
 * Reverse a release after a manager cancels the approved request: cancel
 * the still-open postings and restore the original shifts to published.
 * A posting someone already picked up is left in place and reported —
 * restoring on top of it would double-book the shift.
 */
export async function restoreShiftsForCancelledTimeOff(args: {
  hrStore: HrStore;
  openShiftStore: OpenShiftStore;
  request: HrTimeOffRequest;
}): Promise<TimeOffCoverageOutcome> {
  const { hrStore, openShiftStore, request } = args;
  const outcome = emptyOutcome();
  const marker = timeOffReleaseMarker(request.id);
  try {
    const postings = await openShiftStore.listOpenShifts();
    for (const posting of postings) {
      if (!posting.notes?.includes(marker)) continue;
      if (posting.status === "open") {
        try {
          await openShiftStore.cancelOpenShift(posting.id);
          outcome.postingsCancelled += 1;
        } catch (err) {
          outcome.failures.push(
            `Posting ${posting.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      } else if (posting.status === "filled") {
        outcome.postingsFilled += 1;
      }
    }
  } catch (err) {
    outcome.failures.push(
      `Could not load open shifts to reverse the release: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const { from, to } = requestWindow(request);
  try {
    const shifts = await hrStore.listShifts(from, to);
    for (const shift of shifts) {
      if (
        shift.staffId !== request.staffId ||
        shift.status !== "cancelled" ||
        !shift.notes?.includes(marker)
      ) {
        continue;
      }
      try {
        await hrStore.updateShift(shift.id, {
          status: "published",
          notes: appendNote(
            shift.notes,
            `Time off cancelled on ${todayStamp()} — shift restored.`,
          ),
        });
        outcome.restored += 1;
      } catch (err) {
        outcome.failures.push(
          `Shift ${shift.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    outcome.failures.push(
      `Could not load the schedule to restore shifts: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return outcome;
}
