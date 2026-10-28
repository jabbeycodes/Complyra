/**
 * Today's tracking — one fetch pass over the existing APIs that feeds the
 * mobile home's donut card, greeting summary, and up-next med passes.
 *
 * Everything is scoped to the picked home and to Central today, and every
 * category is gated by the same helpers the tiles use: a category the
 * role cannot see is never fetched and never shown. A category whose API
 * read fails is omitted rather than guessed at — the donut only ever
 * pictures numbers that were actually read.
 *
 * Denominators (chosen for defensibility, documented in the PR body):
 * - Medications: doses with a recorded dose mark today (capped per
 *   person at that person's scheduled total) over total scheduled doses
 *   today, from the MAR getters the mobile MAR itself uses. Dose
 *   exceptions are deliberately excluded — they carry no dose-time/mark
 *   linkage, so a dose the MAR still shows "Not yet given" must not
 *   count as recorded here. They remain visible on the MAR's Other tab.
 * - ISP Data: Individuals with an entry recorded today over Individuals
 *   with an active (selectable) plan at this home — one entry per person
 *   per day is the collection expectation, so people are the unit. The
 *   entries counted here are the home's shift notes; there is no separate
 *   shift-notes category (a note has no expected daily count, so it could
 *   never carry a denominator anyway).
 * - Checklists: items answered on this week's checklist for the home
 *   over its total items, when a checklist covers the current week.
 */
import { useEffect, useState } from "react";
import type { ComplyraApi } from "../../data/localApi";
import type { SessionUser } from "../../data/types";
import { canSeeMeds } from "../../data/chart";
import { canSeeShiftNotes } from "../../data/permissions";
import { centralTodayIso, groupPasses, shiftIsoDate } from "./mar";
import { planStatus } from "./isp";
import {
  buildTrackingSummary,
  summarizeMedicationDay,
  type MedicationDayPerson,
  type TrackingCategory,
  type TrackingSummary,
} from "./today";
import type { WorkspaceIndividual } from "./types";

export interface TodayPass {
  personId: string;
  personName: string;
  doseTime: string;
  total: number;
  recorded: number;
  given: number;
}

export interface TodayTracking {
  loading: boolean;
  summary: TrackingSummary;
  passes: TodayPass[];
  /** Scheduled doses still unrecorded today; null when meds are not tracked. */
  medsLeft: number | null;
}

const EMPTY: TodayTracking = {
  loading: true,
  summary: buildTrackingSummary([]),
  passes: [],
  medsLeft: null,
};

const MEDICATIONS_COLOR = "#3f5c3b"; // --moss
const ISP_COLOR = "#8b5e3c"; // --clay
const CHECKLIST_COLOR = "#6f815c"; // --sage

export function useTodayTracking({
  api,
  session,
  siteId,
  people,
  canChecklist,
  refreshKey = 0,
}: {
  api: ComplyraApi;
  session: SessionUser;
  siteId: string | null;
  people: WorkspaceIndividual[];
  canChecklist: boolean;
  /**
   * Bumped by the shell each time the user returns to the home view, so
   * work recorded in the MAR/ISP flows shows up without a page reload.
   * One bump = one refetch; there is no polling.
   */
  refreshKey?: number;
}): TodayTracking {
  const [tracking, setTracking] = useState<TodayTracking>(EMPTY);
  const peopleKey = people.map((person) => person.id).join(",");
  const roleKey = session.roleKey;

  useEffect(() => {
    if (!siteId) {
      setTracking({ ...EMPTY, loading: false });
      return;
    }
    let cancelled = false;
    setTracking(EMPTY);
    const todayIso = centralTodayIso();
    const canMeds = canSeeMeds(roleKey);
    const canNotes = canSeeShiftNotes(roleKey);

    void (async () => {
      const categories: TrackingCategory[] = [];
      let passes: TodayPass[] = [];
      let medsLeft: number | null = null;

      // Site notes feed the ISP fraction (entries are shift notes).
      let siteNotes: Awaited<ReturnType<ComplyraApi["getSiteShiftNotes"]>> = [];
      if (canNotes) {
        siteNotes = await api.getSiteShiftNotes(siteId).catch(() => []);
      }
      const notesToday = siteNotes.filter(
        (note) => note.noteDate.slice(0, 10) === todayIso,
      );

      if (canMeds && people.length > 0) {
        const personDays: MedicationDayPerson[] = [];
        const allPasses: TodayPass[] = [];
        await Promise.all(
          people.map(async (person) => {
            try {
              const [inventory, marks] = await Promise.all([
                api.getMedInventory(person.id),
                api.getMedDoseMarks(person.id, todayIso),
              ]);
              const personPasses = groupPasses(inventory, marks);
              // Marks only: pass.recorded counts doses carrying a dose
              // mark. Dose exceptions on the inventory are not read here
              // at all — they never complete a scheduled dose.
              personDays.push({
                scheduledTotal: personPasses.reduce(
                  (sum, pass) => sum + pass.total,
                  0,
                ),
                markedTotal: personPasses.reduce(
                  (sum, pass) => sum + pass.recorded,
                  0,
                ),
              });
              for (const pass of personPasses) {
                allPasses.push({
                  personId: person.id,
                  personName: person.name,
                  doseTime: pass.doseTime,
                  total: pass.total,
                  recorded: pass.recorded,
                  given: pass.given,
                });
              }
            } catch {
              // One person's unreadable MAR never sinks the whole card.
            }
          }),
        );
        const medDay = summarizeMedicationDay(personDays);
        if (medDay.total > 0) {
          categories.push({
            id: "medications",
            label: "Medications",
            color: MEDICATIONS_COLOR,
            completed: medDay.completed,
            total: medDay.total,
          });
          medsLeft = medDay.left;
        }
        passes = allPasses.sort((a, b) => a.doseTime.localeCompare(b.doseTime));
      }

      if (canNotes && people.length > 0) {
        const withEntryToday = new Set(
          notesToday.map((note) => note.individualId),
        );
        let withActivePlan = 0;
        let entered = 0;
        await Promise.all(
          people.map(async (person) => {
            try {
              const data = await api.getIspData(person.id);
              const hasActivePlan = data.programs.some(
                (program) => planStatus(program, todayIso).selectable,
              );
              if (hasActivePlan) {
                withActivePlan += 1;
                if (withEntryToday.has(person.id)) entered += 1;
              }
            } catch {
              // Unreadable plan data excludes the person from the fraction.
            }
          }),
        );
        if (withActivePlan > 0) {
          categories.push({
            id: "ispData",
            label: "ISP Data",
            color: ISP_COLOR,
            completed: entered,
            total: withActivePlan,
          });
        }
      }

      if (canChecklist) {
        try {
          const checklists = await api.listWeeklyChecklists({ siteId });
          const covering = checklists
            .map((checklist) => ({
              checklist,
              anchor: (checklist.weekStart ?? checklist.weekOf).slice(0, 10),
            }))
            .filter(
              ({ anchor }) =>
                anchor <= todayIso && todayIso <= shiftIsoDate(anchor, 6),
            )
            .sort((a, b) => b.anchor.localeCompare(a.anchor));
          const current = covering[0]?.checklist;
          if (current && current.items.length > 0) {
            categories.push({
              id: "checklists",
              label: "Checklists",
              color: CHECKLIST_COLOR,
              completed: current.items.filter((item) => item.answer !== null)
                .length,
              total: current.items.length,
            });
          }
        } catch {
          // No readable checklist this week — the category stays out.
        }
      }

      if (!cancelled) {
        setTracking({
          loading: false,
          summary: buildTrackingSummary(categories),
          passes,
          medsLeft,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, siteId, peopleKey, roleKey, canChecklist, refreshKey]);

  return tracking;
}
