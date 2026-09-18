import { useEffect, useRef, useState } from "react";
import { can, pageVisible } from "../../data/status";
import type {
  HmWeeklyChecklist,
  MedSupplyStatus,
  SessionUser,
  StaffCertificate,
  StaffTrainingProfile,
} from "../../data/types";
import type { QaAudit, QaAuditItemState } from "../../data/qaAudit";
import type { SiteShiftNoteView } from "../../data/shiftNotes";
import type { SiteDelegationActivation } from "../../delegation/delegation";
import type { ComplyraApi } from "../../data/localApi";

export interface TrainingRow {
  userId: string;
  name: string;
  role: string;
  profile: StaffTrainingProfile | null;
  expiringCerts: StaffCertificate[];
  failed: boolean;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
}

export interface QaDisputeRow {
  auditId: string;
  auditLabel: string;
  item: QaAuditItemState;
}

export interface TrackablesState {
  qaHistory: QaAudit[] | null;
  qaDisputes: QaDisputeRow[] | null;
  checklists: HmWeeklyChecklist[] | null;
  delegations: SiteDelegationActivation[] | null;
  trainingRows: TrainingRow[] | null;
  medStatus: MedSupplyStatus | null;
  siteNotes: SiteShiftNoteView[] | null;
  loading: boolean;
  error: string | null;
}

export const EMPTY_TRACKABLES: TrackablesState = {
  qaHistory: null,
  qaDisputes: null,
  checklists: null,
  delegations: null,
  trainingRows: null,
  medStatus: null,
  siteNotes: null,
  loading: false,
  error: null,
};

interface HookArgs {
  api: ComplyraApi;
  session: SessionUser | null;
  siteId: string;
  siteStaff: StaffMember[];
  hasAccess: boolean;
}

/**
 * Eagerly loads the per-tab data the site-dashboard tiles need, so tiles
 * render without waiting for tab clicks. Every fetch mirrors the gate its
 * source tab uses: a role that cannot see the tab never triggers the fetch
 * and the tile stays hidden.
 */
export function useSiteTrackables({
  api,
  session,
  siteId,
  siteStaff,
  hasAccess,
}: HookArgs): TrackablesState {
  const [state, setState] = useState<TrackablesState>({
    ...EMPTY_TRACKABLES,
    loading: true,
  });
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!hasAccess || !session) {
      setState({ ...EMPTY_TRACKABLES, loading: false });
      return;
    }

    const canSeeQa =
      can(session, "audit.read") || can(session, "qa.audit") || can(session, "audit.export");
    const canSeeChecklists =
      pageVisible(session, "Weekly checklist") ||
      pageVisible(session, "Checklist assignments");
    const canSeeTraining =
      pageVisible(session, "Training") || pageVisible(session, "Delegations");
    const canSeeMeds = pageVisible(session, "Supply forecast");
    const canSeeShiftNotes = pageVisible(session, "ShiftNotes");

    async function loadTraining(): Promise<TrainingRow[]> {
      const rows: TrainingRow[] = await Promise.all(
        siteStaff.map(async (member) => {
          try {
            const [profile, certs] = await Promise.all([
              api.getStaffTrainingProfile(member.id),
              api.listCertificates(member.id),
            ]);
            const expiring = certs
              .filter((c) => {
                const days = Math.round(
                  (new Date(c.expiresOn).getTime() - Date.now()) / 86400000,
                );
                return days <= 60;
              })
              .sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
            return {
              userId: member.id,
              name: member.name,
              role: member.role,
              profile,
              expiringCerts: expiring,
              failed: false,
            };
          } catch {
            return {
              userId: member.id,
              name: member.name,
              role: member.role,
              profile: null,
              expiringCerts: [],
              failed: true,
            };
          }
        }),
      );
      return rows;
    }

    async function loadDisputes(audits: QaAudit[]): Promise<QaDisputeRow[]> {
      const rows: QaDisputeRow[] = [];
      // Bound the fan-out: disputes live on the most recent audits.
      for (const audit of audits.slice(0, 4)) {
        try {
          const items = await api.getQaAuditItems(audit.id);
          for (const item of items) {
            if (item.disputeRaisedBy != null && item.disputeResolution == null) {
              rows.push({
                auditId: audit.id,
                auditLabel: `Q${audit.quarter} ${audit.year}`,
                item,
              });
            }
          }
        } catch {
          // A failed audit fetch must not sink the other tiles.
        }
      }
      return rows;
    }

    (async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const [qaHistory, checklists, delegations, trainingRows, medStatus, siteNotes] =
          await Promise.all([
            canSeeQa
              ? api.getQaSiteHistory(siteId).catch(() => [] as QaAudit[])
              : Promise.resolve(null as QaAudit[] | null),
            canSeeChecklists
              ? api.listWeeklyChecklists({ siteId }).catch(() => [] as HmWeeklyChecklist[])
              : Promise.resolve(null as HmWeeklyChecklist[] | null),
            canSeeTraining
              ? api.listSiteDelegationActivations({ siteId }).catch(() => [] as SiteDelegationActivation[])
              : Promise.resolve(null as SiteDelegationActivation[] | null),
            canSeeTraining ? loadTraining().catch(() => [] as TrainingRow[]) : Promise.resolve(null as TrainingRow[] | null),
            canSeeMeds
              ? api.getMedicationSupplyStatus(siteId).catch(() => null as MedSupplyStatus | null)
              : Promise.resolve(null as MedSupplyStatus | null),
            canSeeShiftNotes
              ? api.getSiteShiftNotes(siteId).catch(() => [] as SiteShiftNoteView[])
              : Promise.resolve(null as SiteShiftNoteView[] | null),
          ]);
        const qaDisputes =
          qaHistory && qaHistory.length > 0
            ? await loadDisputes(qaHistory)
            : qaHistory
              ? []
              : null;
        if (!cancelled.current) {
          setState({
            qaHistory,
            qaDisputes,
            checklists,
            delegations,
            trainingRows,
            medStatus,
            siteNotes,
            loading: false,
            error: null,
          });
        }
      } catch (err) {
        if (!cancelled.current) {
          setState((s) => ({
            ...s,
            loading: false,
            error: err instanceof Error ? err.message : "Could not load site data.",
          }));
        }
      }
    })();

    return () => {
      cancelled.current = true;
    };
    // siteStaff is memoized upstream; refetch when the roster changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, hasAccess, siteId, session, siteStaff]);

  return state;
}
