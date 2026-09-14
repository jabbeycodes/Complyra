/**
 * LIFEPATH-P2: Staff compliance profile + training engine UI.
 *
 * - Manager view: "Not cleared to work alone" list across the agency/site.
 * - Per-staff profile: assigned sites & individuals, required vs complete vs
 *   overdue vs N/A lines, hours vs the 20h/8h-HM in-ratio gate, whole-checklist
 *   countersignatures, and the prominent NOT CLEARED banner when the gate fails.
 * - Certificate tracking hook: a marked extension point below (Phase 4 fills it).
 */
import { useEffect, useState } from "react";
import { Badge, Empty, Modal, PageHeading, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { SignatureField } from "../signatures/SignatureField";
import ComplyrerRecordMark from "../../components/ComplyrerRecordMark";
import SignatureAdoption from "../signatures/SignatureAdoption";
import SignatureSeal from "../signatures/SignatureSeal";
import {
  formatSignatureDate,
  suggestInitials,
} from "../signatures/signatureUtils";
import {
  latestLineEvent,
  lineNeedsReinitial,
  trainingChecklistDocId,
  trainingCountersignPayload,
  trainingLineFieldName,
  trainingLinePayload,
  trainingLinePayloadFromView,
} from "../signatures/documentPayloads";
import { can } from "../../data/status";
import {
  canEditTrainingLine,
  canRequestTrainingCorrection,
  canSignTrainingAsHm,
} from "../../data/chart";
import { TRAINING_LINE_MAX_HOURS } from "./gate";
import type {
  AdoptedSignature,
  SignatureEvent,
  StaffClearanceRow,
  StaffTrainingProfile,
  TrainingMethod,
  TrainingRequirementView,
  TrainingSignoff,
} from "../../data/types";

/** Paper rule: "Staff must initial each item below... Do not leave blanks." */
const LINES_GATE_MESSAGE =
  "Initial every training line (or mark N/A) before signing.";

const SECTION_NAMES: Record<number, string> = {
  1: "Agency basics",
  2: "Around the home",
  3: "Vehicle use",
  4: "Emergencies",
  5: "Daily duties",
  6: "Individual-specific training",
};

const METHODS: TrainingMethod[] = ["shadowing", "classroom", "video", "hands-on", "reading"];

function statusBadge(status: TrainingRequirementView["resolvedStatus"]) {
  if (status === "complete") return <Badge status="Complete" />;
  if (status === "waived_na") return <Badge status="N/A" />;
  if (status === "overdue") return <Badge status="Overdue" />;
  if (status === "in_progress") return <Badge status="In progress" />;
  return <Badge status="Pending" />;
}

export default function StaffCompliancePage({ onSaved }: { onSaved: (message: string) => void }) {
  const { api, session, workspace, refresh } = useData();
  const [rows, setRows] = useState<StaffClearanceRow[] | null>(null);
  const [rowsFailed, setRowsFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [profile, setProfile] = useState<StaffTrainingProfile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<
    | null
    | { kind: "initial"; requirement: TrainingRequirementView; existing?: TrainingSignoff; reinit?: boolean }
    | { kind: "waive"; requirement: TrainingRequirementView }
    | { kind: "correct"; countersignatureId: string }
    | { kind: "assign" }
  >(null);
  // Bumped after every successful save so per-line e-initials stamps reload.
  const [signatureTick, setSignatureTick] = useState(0);
  const staffNames = Object.fromEntries(
    (workspace?.staff ?? []).map((s) => [s.id, s.name]),
  );

  const canManage = session ? can(session, "hr.view_staff") : false;
  const isHm = session ? canSignTrainingAsHm(session.roleKey) : false;

  async function loadRows() {
    try {
      setRows(await api.listStaffNeedingClearance());
    } catch {
      setRowsFailed(true);
    }
  }

  async function loadProfile(userId: string) {
    setError("");
    try {
      setProfile(await api.getStaffTrainingProfile(userId));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    if (!session) return;
    if (can(session, "hr.view_staff")) {
      loadRows();
    } else {
      setRowsFailed(true);
      setSelected(session.userId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.userId]);

  useEffect(() => {
    if (selected) loadProfile(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (!session) return null;

  async function run(action: () => Promise<unknown>, savedMessage: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
      if (selected) await loadProfile(selected);
      if (canManage) await loadRows();
      setModal(null);
      setSignatureTick((tick) => tick + 1);
      onSaved(savedMessage);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const notCleared = (rows ?? []).filter((row) => !row.clearedForInRatio);

  return (
    <div>
      <PageHeading
        eyebrow="LifePath"
        title="Training & staff compliance"
        description="In-home training checklists, sign-offs, and the in-ratio gate: 20 hours of training with 8 hours alongside the house manager before working alone."
      >
        {canManage && (
          <button className="button" onClick={() => setModal({ kind: "assign" })}>
            Assign training
          </button>
        )}
      </PageHeading>
      {error && <p className="form-error">{error}</p>}

      {canManage && rows && (
        <section className="panel" aria-label="Not cleared to work alone">
          <h2>Not cleared to work alone</h2>
          {notCleared.length === 0 ? (
            <Empty
              title="Everyone is cleared"
              text="Every staff member with training assigned meets the in-ratio gate."
            />
          ) : (
            <ul className="clearance-list">
              {notCleared.map((row) => (
                <li key={row.userId}>
                  <div>
                    <strong>{row.fullName}</strong>
                    <span className="muted"> · {row.siteName}</span>
                    <ul className="gate-reasons">
                      {row.gateReasons.slice(0, 4).map((reason, i) => (
                        <li key={i}>{reason}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="clearance-meta">
                    <span className="muted">
                      {row.hoursTotal.toFixed(1)}h ({row.hoursWithHm.toFixed(1)}h HM)
                    </span>
                    <button className="button" onClick={() => setSelected(row.userId)}>
                      Open profile
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {canManage && rows && (
        <section className="panel" aria-label="All staff training status">
          <h2>All staff</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Site</th>
                <th>Status</th>
                <th>Lines</th>
                <th>Hours</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <td>{row.fullName}</td>
                  <td>{row.siteName}</td>
                  <td>
                    {row.clearedForInRatio ? <Badge status="Cleared" /> : <Badge status="Not cleared" />}
                  </td>
                  <td>
                    {row.pendingCount + row.overdueCount} open
                    {row.overdueCount > 0 ? ` (${row.overdueCount} overdue)` : ""}
                  </td>
                  <td>
                    {row.hoursTotal.toFixed(1)}h · {row.hoursWithHm.toFixed(1)}h HM
                  </td>
                  <td>
                    <button className="button" onClick={() => setSelected(row.userId)}>
                      Open profile
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {profile && (
        <ProfilePanel
          profile={profile}
          sessionUserId={session.userId}
          sessionRoleKey={session.roleKey}
          canManage={canManage}
          isHm={isHm}
          busy={busy}
          signatureTick={signatureTick}
          staffNames={staffNames}
          onInitial={(requirement) => setModal({ kind: "initial", requirement })}
          onReinitial={(requirement, existing) =>
            setModal({ kind: "initial", requirement, existing, reinit: true })
          }
          onEdit={(requirement, existing) =>
            setModal({ kind: "initial", requirement, existing })
          }
          onWaive={(requirement) => setModal({ kind: "waive", requirement })}
          onCorrect={(countersignatureId) => setModal({ kind: "correct", countersignatureId })}
          onClose={() => {
            setSelected(null);
            setProfile(null);
          }}
        />
      )}

      {modal?.kind === "initial" && (
        <InitialLineModal
          requirement={modal.requirement}
          existing={modal.existing}
          reinit={modal.reinit}
          staffUserId={profile?.userId ?? ""}
          roster={workspace?.staff ?? []}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(input) =>
            run(async () => {
              const requirement = modal.requirement;
              // Re-read the line so the versioned field name is authoritative
              // even if an earlier attempt saved the line but failed to stamp.
              const fresh = await api.getStaffTrainingProfile(
                profile?.userId ?? "",
              );
              const freshLine = fresh.requirements.find(
                (row) => row.id === requirement.id,
              );
              if (!freshLine) throw new Error("Training line not found.");
              const nextVersion = (freshLine.signoff?.signoffVersion ?? 0) + 1;
              const adoptedInitialsText = input.initials;
              await api.initialRequirementLine(requirement.id, {
                ...input,
                initials: adoptedInitialsText,
              });
              await api.applySignature({
                documentType: "training_checklist",
                documentId: trainingChecklistDocId(
                  profile?.userId ?? "",
                  requirement.siteId ?? "",
                ),
                fieldName: trainingLineFieldName(requirement.id, nextVersion),
                kind: "initials",
                documentPayload: trainingLinePayload({
                  topicId: requirement.topicId,
                  topicTitle: requirement.topicTitle,
                  // initialRequirementLine flips the line to complete.
                  resolvedStatus: "complete",
                  trainerName: staffNames[input.trainerUserId] ?? "",
                  hoursTotal: input.hoursTotal ?? 0,
                  hoursWithHm: input.hoursWithHm ?? 0,
                  signedOn: (input.signedOn ?? "").slice(0, 10),
                  na: false,
                  naReason: null,
                  signoffVersion: nextVersion,
                }),
              });
            }, modal.existing ? "Training line updated and re-initialed." : "Training line initialed.")
          }
        />
      )}
      {modal?.kind === "waive" && (
        <WaiveLineModal
          requirement={modal.requirement}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(reason) =>
            run(() => api.waiveRequirementLine(modal.requirement.id, reason), "Line marked N/A.")
          }
        />
      )}
      {modal?.kind === "correct" && (
        <RequestCorrectionModal
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(reason) =>
            run(
              () =>
                api.requestTrainingCorrection({
                  countersignatureId: modal.countersignatureId,
                  reason,
                }),
              "Correction requested — the sheet is unlocked.",
            )
          }
        />
      )}
      {modal?.kind === "assign" && workspace && (
        <AssignTrainingModal
          staff={workspace.staff}
          sites={workspace.sites}
          individuals={workspace.individuals}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(input) =>
            run(() => api.assignTraining(input), "Training assigned.")
          }
        />
      )}
      {rowsFailed && !canManage && !profile && (
        <Empty
          title="No training profile"
          text="Your training profile could not be loaded. Ask your house manager to assign your in-home checklist."
        />
      )}
    </div>
  );
}

function ProfilePanel({
  profile,
  sessionUserId,
  sessionRoleKey,
  canManage,
  isHm,
  busy,
  signatureTick,
  staffNames,
  onInitial,
  onReinitial,
  onEdit,
  onWaive,
  onCorrect,
  onClose,
}: {
  profile: StaffTrainingProfile;
  sessionUserId: string;
  sessionRoleKey: string;
  canManage: boolean;
  isHm: boolean;
  busy: boolean;
  /** Bumped after every successful save so per-line stamps reload. */
  signatureTick: number;
  staffNames: Record<string, string>;
  onInitial: (requirement: TrainingRequirementView) => void;
  onReinitial: (requirement: TrainingRequirementView, existing: TrainingSignoff) => void;
  onEdit: (requirement: TrainingRequirementView, existing: TrainingSignoff) => void;
  onWaive: (requirement: TrainingRequirementView) => void;
  onCorrect: (countersignatureId: string) => void;
  onClose: () => void;
}) {
  const { api } = useData();
  const sections = [1, 2, 3, 4, 5, 6].map((section) => ({
    section,
    lines: profile.requirements.filter((row) => row.section === section),
  }));
  const canInitialOwn = profile.userId === sessionUserId;
  const canEditLines = canEditTrainingLine(sessionRoleKey);
  const canCorrect = canRequestTrainingCorrection(sessionRoleKey);
  const lockedSiteIds = new Set(
    profile.countersignatures
      .filter((counter) => counter.hmSignedAt)
      .map((counter) => counter.siteId),
  );
  const firstSiteId = profile.requirements.find((row) => row.siteId)?.siteId ?? null;

  // Per-line e-initials events, loaded ONCE per site checklist (not one
  // SignatureField per row — 60 rows × 2 API calls would hammer mobile).
  const [siteEvents, setSiteEvents] = useState<Record<string, SignatureEvent[]>>(
    {},
  );
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const siteIds = [
        ...new Set(
          [
            ...profile.requirements.map((row) => row.siteId),
            ...profile.countersignatures.map((counter) => counter.siteId),
          ].filter((id): id is string => id != null),
        ),
      ];
      const loaded: Record<string, SignatureEvent[]> = {};
      for (const siteId of siteIds) {
        try {
          loaded[siteId] = await api.getSignatureEvents(
            "training_checklist",
            trainingChecklistDocId(profile.userId, siteId),
          );
        } catch {
          loaded[siteId] = [];
        }
      }
      if (!cancelled) setSiteEvents(loaded);
    })();
    return () => {
      cancelled = true;
    };
  }, [api, profile.userId, signatureTick]);

  // All per-line initials events across the profile's site checklists.
  const allLineEvents = Object.values(siteEvents).flat();

  /** Paper rule: every line initialed or N/A — no blanks. */
  function linesGate(siteId: string): { allResolved: boolean; openCount: number } {
    const open = profile.requirements.filter(
      (row) =>
        row.siteId === siteId &&
        row.resolvedStatus !== "complete" &&
        row.resolvedStatus !== "waived_na",
    );
    return { allResolved: open.length === 0, openCount: open.length };
  }

  function staffSignedForSite(
    siteId: string,
    counter: { staffSignedAt: string | null },
  ): boolean {
    if (counter.staffSignedAt) return true;
    return (siteEvents[siteId] ?? []).some(
      (event) => event.fieldName === "staff_sign",
    );
  }

  /** A stamped line whose sign-off was edited after stamping. */
  function needsReinitial(line: TrainingRequirementView): boolean {
    return lineNeedsReinitial(line.signoff, allLineEvents, line.id);
  }
  return (
    <section className="panel" aria-label={`${profile.fullName} training profile`}>
      <div className="panel-head">
        <h2>{profile.fullName}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close profile">
          ✕
        </button>
      </div>

      {!profile.clearedForInRatio ? (
        <div
          className="clearance-banner"
          role="alert"
          style={{
            background: "#fbe9e4",
            border: "1px solid #eec5b8",
            borderRadius: 8,
            padding: "14px 16px",
            marginBottom: 16,
          }}
        >
          <strong style={{ color: "#8f3b26" }}>NOT CLEARED TO WORK ALONE / IN-RATIO</strong>
          <ul className="gate-reasons">
            {profile.gateReasons.map((reason, i) => (
              <li key={i}>{reason}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="readiness-banner">
          <strong>Cleared for in-ratio work</strong>
          <p>
            {profile.hoursTotal.toFixed(1)} training hours · {profile.hoursWithHm.toFixed(1)} with the
            house manager · all lines complete · checklist countersigned.
          </p>
        </div>
      )}

      <dl className="stat-row">
        <div>
          <dt>Training hours</dt>
          <dd>
            {profile.hoursTotal.toFixed(1)} / 20
          </dd>
        </div>
        <div>
          <dt>Hours with HM</dt>
          <dd>
            {profile.hoursWithHm.toFixed(1)} / 8
          </dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>
            {profile.counts.complete} complete · {profile.counts.pending} pending ·{" "}
            {profile.counts.overdue} overdue · {profile.counts.waived} N/A
          </dd>
        </div>
      </dl>
      <p className="muted">
        Sites: {profile.siteNames.join(", ") || "—"}
        {profile.individualNames.length > 0 &&
          ` · Individuals: ${profile.individualNames.map((p) => p.fullName).join(", ")}`}
      </p>

      {sections.map(
        ({ section, lines }) =>
          lines.length > 0 && (
            <div key={section}>
              <h3>
                Section {section} — {SECTION_NAMES[section]}
              </h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Training item</th>
                    <th>For</th>
                    <th>Status</th>
                    <th>Initials</th>
                    <th>Hours</th>
                    {(canInitialOwn || canManage) && <th></th>}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const locked = line.siteId != null && lockedSiteIds.has(line.siteId);
                    const signoff = line.signoff;
                    const needsReinitialStamp = needsReinitial(line);
                    const latestEvent = latestLineEvent(allLineEvents, line.id);
                    const signerName =
                      (signoff?.signedByUserId && staffNames[signoff.signedByUserId]) ??
                      "—";
                    return (
                      <tr key={line.id}>
                        <td>{line.topicTitle}</td>
                        <td>{line.individualName ?? "—"}</td>
                        <td>{statusBadge(line.resolvedStatus)}</td>
                        <td>
                          {signoff ? (
                            <>
                              {signoff.na ? (
                                <>
                                  N/A · {formatDate(signoff.signedOn)}
                                  <br />
                                  <small className="muted">{signoff.naReason}</small>
                                </>
                              ) : needsReinitialStamp || !latestEvent ? (
                                <span className="reinitial-hint">
                                  Needs re-initialing
                                </span>
                              ) : (
                                <LineInitialsStamp
                                  event={latestEvent}
                                  documentId={trainingChecklistDocId(
                                    profile.userId,
                                    line.siteId ?? "",
                                  )}
                                  getDocumentPayload={() =>
                                    trainingLinePayloadFromView(line)
                                  }
                                />
                              )}
                              <br />
                              <small className="muted">
                                Trainer: {signoff.trainerName}
                                {signoff.selfTraining ? " (self-training — flagged for review)" : ""}{" "}
                                · Recorded by: {signerName}
                              </small>
                            </>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {signoff && !signoff.na
                            ? `${signoff.hoursTotal}h${signoff.hoursWithHm > 0 ? ` (${signoff.hoursWithHm}h HM)` : ""}`
                            : "—"}
                        </td>
                        {(canInitialOwn || canManage) && (
                          <td>
                            {(!signoff || needsReinitialStamp) && !locked && (
                              <button
                                className="button touch"
                                disabled={busy}
                                onClick={() =>
                                  signoff
                                    ? onReinitial(line, signoff)
                                    : onInitial(line)
                                }
                              >
                                {needsReinitialStamp ? "Re-initial" : "Initial"}
                              </button>
                            )}
                            {!signoff && !locked && canManage && (
                              <>
                                {" "}
                                <button
                                  className="button touch"
                                  disabled={busy}
                                  onClick={() => onWaive(line)}
                                >
                                  N/A
                                </button>
                              </>
                            )}
                            {signoff && !locked && canEditLines && (
                              <>
                                {" "}
                                <button
                                  className="button touch"
                                  disabled={busy}
                                  onClick={() => onEdit(line, signoff)}
                                >
                                  Edit
                                </button>
                              </>
                            )}
                            {locked && <small className="muted">Locked</small>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ),
      )}

      <h3>Checklist signatures</h3>
      <ComplyrerRecordMark
        documentId={`training-checklist:${profile.userId}`}
        generatedAt={new Date().toISOString()}
      />
      {profile.countersignatures.length === 0 && (
        <>
          <p className="muted">No signatures yet for this staff member.</p>
          {canInitialOwn && firstSiteId && (
            <TrainingSignField
              profile={profile}
              siteId={firstSiteId}
              fieldName="staff_sign"
              label="Staff signature"
              actionLabel="Sign as {name}"
              canAct={linesGate(firstSiteId).allResolved}
              cantActReason={
                linesGate(firstSiteId).allResolved ? undefined : LINES_GATE_MESSAGE
              }
            />
          )}
        </>
      )}
      <ul className="signature-list">
        {profile.countersignatures.map((counter) => {
          const locked = Boolean(counter.hmSignedAt);
          const gate = linesGate(counter.siteId);
          const staffSigned = staffSignedForSite(counter.siteId, counter);
          const staffCanAct = canInitialOwn && gate.allResolved;
          // Paper order: staff signs first, then the HM countersigns — ANDed
          // with the paper rule that every line is initialed or N/A.
          const hmCanAct = isHm && staffSigned && gate.allResolved;
          return (
            <li key={counter.id}>
              <strong>{profile.siteNames[0] ?? counter.siteId}</strong>
              <TrainingSignField
                profile={profile}
                siteId={counter.siteId}
                fieldName="staff_sign"
                label="Staff signature"
                actionLabel="Sign as {name}"
                canAct={staffCanAct}
                cantActReason={!gate.allResolved ? LINES_GATE_MESSAGE : "Not signed yet."}
                legacySigned={
                  counter.staffSignedAt
                    ? {
                        signerName: counter.staffSignatureName ?? "Signed",
                        signedAt: counter.staffSignedAt,
                      }
                    : null
                }
              />
              <TrainingSignField
                profile={profile}
                siteId={counter.siteId}
                fieldName="hm_countersign"
                label="House manager countersignature"
                actionLabel="Countersign as {name}"
                canAct={hmCanAct}
                cantActReason={
                  !staffSigned
                    ? "The staffer must sign before the house manager countersigns."
                    : !gate.allResolved
                      ? LINES_GATE_MESSAGE
                      : "Not countersigned yet."
                }
                legacySigned={
                  counter.hmSignedAt
                    ? {
                        signerName: counter.hmSignatureName ?? "Signed",
                        signedAt: counter.hmSignedAt,
                      }
                    : null
                }
              />
              <span className="signature-actions">
                {locked && canCorrect && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => onCorrect(counter.id)}
                  >
                    Request correction
                  </button>
                )}
              </span>
              {locked && !canCorrect && (canInitialOwn || isHm) && (
                <small className="muted">
                  Locked sheets can only be corrected by an administrator, compliance
                  admin, or DPM — ask one of them to unlock this sheet so lines can be
                  edited and re-signed.
                </small>
              )}
            </li>
          );
        })}
      </ul>

      {/* LIFEPATH-P4 extension point: certificate tracking UI plugs in here. */}
      <section aria-label="Certificates (coming soon)">
        <h3>Certificates</h3>
        <p className="muted">
          Certificate tracking (CPR, CPI, PBS, L1MA and others) arrives with the next build phase.
        </p>
      </section>
    </section>
  );
}

/**
 * Lightweight per-line e-initials stamp: the adopted initials image, the
 * signer name, the timestamp, and the tamper-evidence seal. Deliberately NOT
 * a full <InitialsField> — the events are loaded once per site checklist by
 * the parent, so each row costs at most one image fetch.
 */
function LineInitialsStamp({
  event,
  documentId,
  getDocumentPayload,
}: {
  event: SignatureEvent;
  documentId: string;
  getDocumentPayload: () => object;
}) {
  const { api } = useData();
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = await api.getSignatureImageUrl(`${event.userId}/initials.png`);
        if (!cancelled) setImgUrl(url);
      } catch {
        if (!cancelled) setImgUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api, event.userId]);

  return (
    <span className="line-initials-stamp">
      {imgUrl ? (
        <img
          src={imgUrl}
          alt={`Initials of ${event.signerName}`}
          className="line-initials-img"
        />
      ) : (
        <strong className="line-initials-fallback">{event.signerName}</strong>
      )}
      <span className="muted">{formatSignatureDate(event.signedAt)}</span>
      <SignatureSeal
        event={event}
        documentType="training_checklist"
        documentId={documentId}
        fieldName={event.fieldName}
        getDocumentPayload={getDocumentPayload}
      />
    </span>
  );
}

function TrainingSignField({
  profile,
  siteId,
  fieldName,
  label,
  actionLabel,
  canAct,
  cantActReason,
  legacySigned,
}: {
  profile: StaffTrainingProfile;
  siteId: string;
  fieldName: "staff_sign" | "hm_countersign";
  label: string;
  actionLabel: string;
  canAct: boolean;
  cantActReason?: string;
  legacySigned?: { signerName: string; signedAt: string } | null;
}) {
  return (
    <SignatureField
      documentType="training_checklist"
      documentId={trainingChecklistDocId(profile.userId, siteId)}
      fieldName={fieldName}
      label={label}
      actionLabel={actionLabel}
      getDocumentPayload={() =>
        trainingCountersignPayload({
          userId: profile.userId,
          siteId,
          lines: profile.requirements
            .filter((row) => row.siteId === siteId)
            .map((row) => ({
              topicId: row.topicId,
              topicTitle: row.topicTitle,
              resolvedStatus: row.resolvedStatus,
            })),
        })
      }
      canAct={canAct}
      cantActReason={cantActReason}
      legacySigned={legacySigned ?? null}
    />
  );
}

function InitialLineModal({
  requirement,
  existing,
  reinit,
  staffUserId,
  roster,
  busy,
  onClose,
  onSubmit,
}: {
  requirement: TrainingRequirementView;
  existing?: TrainingSignoff;
  /** True when re-stamping a line whose sign-off was edited after stamping. */
  reinit?: boolean;
  staffUserId: string;
  roster: { id: string; name: string }[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (input: {
    initials: string;
    signedOn: string;
    trainerUserId: string;
    method: TrainingMethod | undefined;
    hoursTotal: number;
    hoursWithHm: number;
    competencyText?: string;
    observerName?: string;
    evidenceRef?: string;
    renewalRule?: string;
  }) => void;
}) {
  const { api, session } = useData();
  const today = new Date().toISOString().slice(0, 10);
  const [signedOn, setSignedOn] = useState(existing?.signedOn ?? today);
  const [trainerUserId, setTrainerUserId] = useState(existing?.trainerUserId ?? "");
  const [method, setMethod] = useState<TrainingMethod | "">(existing?.method ?? "");
  const [hoursTotal, setHoursTotal] = useState(existing?.hoursTotal ?? 1);
  const [hoursWithHm, setHoursWithHm] = useState(existing?.hoursWithHm ?? 0);
  const [competencyText, setCompetencyText] = useState(existing?.competencyText ?? "");
  const [observerName, setObserverName] = useState(existing?.observerName ?? "");
  const [evidenceRef, setEvidenceRef] = useState(existing?.evidenceRef ?? "");
  const [renewalRule, setRenewalRule] = useState(existing?.renewalRule ?? "");
  const [adopted, setAdopted] = useState<AdoptedSignature | null>(null);
  const [adoptedLoaded, setAdoptedLoaded] = useState(false);
  const [initialsImg, setInitialsImg] = useState<string | null>(null);
  const [sigError, setSigError] = useState("");

  const reloadAdopted = async () => {
    setSigError("");
    try {
      const sig = await api.getMySignature();
      setAdopted(sig);
      if (sig) {
        try {
          setInitialsImg(await api.getSignatureImageUrl(sig.initialsPath));
        } catch {
          setInitialsImg(null);
        }
      }
    } catch (err) {
      setSigError((err as Error).message);
    } finally {
      setAdoptedLoaded(true);
    }
  };

  useEffect(() => {
    void reloadAdopted();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!session) return null;

  // Adopted e-initials — the stamp comes from the adoption, never typed.
  const adoptedInitialsText = suggestInitials(session.fullName);
  const mode = !existing ? "fresh" : reinit ? "reinit" : "edit";
  const nextVersion = (existing?.signoffVersion ?? 0) + 1;

  if (!adoptedLoaded) {
    return (
      <Modal title="Initial training line" onClose={onClose}>
        <p className="muted">Loading your electronic signature…</p>
      </Modal>
    );
  }

  if (!adopted) {
    // Adoption is required before initialing — one flow, then back here.
    return (
      <SignatureAdoption onClose={onClose} onAdopted={() => void reloadAdopted()} />
    );
  }

  const selfTraining = trainerUserId !== "" && trainerUserId === staffUserId;
  const title =
    mode === "fresh"
      ? "Initial training line"
      : mode === "reinit"
        ? "Re-initial training line"
        : "Edit training line";
  return (
    <Modal title={title} onClose={onClose}>
      <p className="muted">{requirement.topicTitle}</p>
      {mode === "edit" && (
        <p className="muted">
          You are editing an existing signoff. Saving voids the previous
          initialing (version {existing?.signoffVersion ?? 1} → {nextVersion}) and
          re-initials the line with your adopted e-initials below. The old
          version's stamp stays in the audit history.
        </p>
      )}
      {mode === "reinit" && (
        <p className="muted">
          This line was changed after it was initialed. Your adopted e-initials
          below will stamp the new version (v{nextVersion}); the previous stamp
          stays in history.
        </p>
      )}
      {sigError && <p className="form-error">{sigError}</p>}
      <div className="adopted-initials-preview" aria-live="polite">
        <span className="muted">Your adopted initials — one tap, no typing:</span>
        {initialsImg ? (
          <img
            src={initialsImg}
            alt={`Adopted initials of ${session.fullName}`}
            className="line-initials-img"
          />
        ) : (
          <strong className="line-initials-fallback">{adoptedInitialsText}</strong>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            initials: adoptedInitialsText,
            signedOn,
            trainerUserId,
            method: method || undefined,
            hoursTotal,
            hoursWithHm,
            competencyText: competencyText || undefined,
            observerName: observerName || undefined,
            evidenceRef: evidenceRef || undefined,
            renewalRule: renewalRule || undefined,
          });
        }}
      >
        <label>
          Date trained
          <input
            type="date"
            value={signedOn}
            max={today}
            onChange={(e) => setSignedOn(e.target.value)}
            required
          />
        </label>
        <label>
          Trainer (from staff roster — free-text names are not accepted)
          <select
            value={trainerUserId}
            onChange={(e) => setTrainerUserId(e.target.value)}
            required
          >
            <option value="">Select a trainer…</option>
            {roster.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        {selfTraining && (
          <p className="form-error">
            You selected the staffer as their own trainer. This line will be flagged as
            self-training and may be reviewed.
          </p>
        )}
        <label>
          Training method
          <select value={method} onChange={(e) => setMethod(e.target.value as TrainingMethod | "")}>
            <option value="">—</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          Hours of training
          <input
            type="number"
            min={0}
            max={TRAINING_LINE_MAX_HOURS}
            step={0.5}
            value={hoursTotal}
            onChange={(e) => setHoursTotal(Number(e.target.value))}
          />
        </label>
        <p className="muted">
          One training line covers up to {TRAINING_LINE_MAX_HOURS} hours — a full training day.
          Longer training goes on separately dated lines.
        </p>
        <label>
          Hours with the house manager
          <input
            type="number"
            min={0}
            step={0.5}
            value={hoursWithHm}
            onChange={(e) => setHoursWithHm(Number(e.target.value))}
          />
        </label>
        <label>
          Competency demonstrated (optional)
          <textarea value={competencyText} onChange={(e) => setCompetencyText(e.target.value)} />
        </label>
        <label>
          Observer / validator (optional)
          <input value={observerName} onChange={(e) => setObserverName(e.target.value)} />
        </label>
        <label>
          Evidence reference (optional)
          <input value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} />
        </label>
        <label>
          Renewal rule, e.g. “annual” (optional)
          <input value={renewalRule} onChange={(e) => setRenewalRule(e.target.value)} />
        </label>
        <button className="button primary touch" type="submit" disabled={busy}>
          {mode === "fresh"
            ? `Initial as ${session.fullName}`
            : mode === "reinit"
              ? `Re-initial as ${session.fullName}`
              : `Save changes & re-initial as ${session.fullName}`}
        </button>
      </form>
    </Modal>
  );
}

function WaiveLineModal({
  requirement,
  busy,
  onClose,
  onSubmit,
}: {
  requirement: TrainingRequirementView;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Mark line N/A" onClose={onClose}>
      <p className="muted">{requirement.topicTitle}</p>
      <p>No blanks are allowed — write the reason this item does not apply.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason);
        }}
      >
        <label>
          N/A reason
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <button className="button" type="submit" disabled={busy}>
          Mark N/A
        </button>
      </form>
    </Modal>
  );
}

function RequestCorrectionModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Request training correction" onClose={onClose}>
      <p className="muted">
        This unlocks the training sheet so lines can be edited. The sheet must then be
        re-signed by the staffer and re-countersigned by the house manager. The reason
        below is written to the audit trail.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(reason);
        }}
      >
        <label>
          Correction reason (required)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
        </label>
        <button className="button" type="submit" disabled={busy}>
          Unlock sheet
        </button>
      </form>
    </Modal>
  );
}

function AssignTrainingModal({
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
  onSubmit: (input: {
    userId: string;
    siteId: string;
    individualId?: string | null;
    source: "checklist";
  }) => void;
}) {
  const [userId, setUserId] = useState(staff[0]?.id ?? "");
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [individualId, setIndividualId] = useState("");
  return (
    <Modal title="Assign training" onClose={onClose}>
      <p className="muted">
        Generates the full in-home checklist: sections 1–5 once for the site, section 6 once per
        individual. Lines already assigned are skipped.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({ userId, siteId, individualId: individualId || null, source: "checklist" });
        }}
      >
        <label>
          Staff member
          <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Site
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)} required>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Individual (adds section 6 for this person)
          <select value={individualId} onChange={(e) => setIndividualId(e.target.value)}>
            <option value="">— none —</option>
            {individuals.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <button className="button" type="submit" disabled={busy || !userId || !siteId}>
          Generate checklist
        </button>
      </form>
    </Modal>
  );
}
