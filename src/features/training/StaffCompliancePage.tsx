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
import SignaturePad from "../SignaturePad";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import {
  canEditTrainingLine,
  canRequestTrainingCorrection,
  canSignTrainingAsHm,
} from "../../data/chart";
import { TRAINING_LINE_MAX_HOURS } from "./gate";
import type {
  StaffClearanceRow,
  StaffTrainingProfile,
  TrainingMethod,
  TrainingRequirementView,
  TrainingSignoff,
} from "../../data/types";

const SECTION_NAMES: Record<number, string> = {
  1: "General Information",
  2: "Locations",
  3: "Vehicle",
  4: "Emergency Procedures",
  5: "Staff Duties",
  6: "Individualized Trainings",
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
    null | { kind: "initial"; requirement: TrainingRequirementView; existing?: TrainingSignoff } | { kind: "waive"; requirement: TrainingRequirementView } | { kind: "sign"; role: "staff" | "hm"; siteId: string } | { kind: "correct"; countersignatureId: string } | { kind: "assign" }
  >(null);

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
          staffNames={Object.fromEntries((workspace?.staff ?? []).map((s) => [s.id, s.name]))}
          onInitial={(requirement) => setModal({ kind: "initial", requirement })}
          onEdit={(requirement, existing) =>
            setModal({ kind: "initial", requirement, existing })
          }
          onWaive={(requirement) => setModal({ kind: "waive", requirement })}
          onSign={(role, siteId) => setModal({ kind: "sign", role, siteId })}
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
          staffUserId={profile?.userId ?? ""}
          roster={workspace?.staff ?? []}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(input) =>
            run(
              () => api.initialRequirementLine(modal.requirement.id, input),
              modal.existing ? "Training line updated." : "Training line initialed.",
            )
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
      {modal?.kind === "sign" && (
        <SignChecklistModal
          role={modal.role}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={(name, mark) =>
            run(
              () =>
                api.signStaffChecklist({
                  userId: profile!.userId,
                  siteId: modal.siteId,
                  role: modal.role,
                  signatureName: name,
                  signatureMark: mark,
                }),
              modal.role === "staff" ? "Checklist signed." : "Checklist countersigned.",
            )
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
  staffNames,
  onInitial,
  onEdit,
  onWaive,
  onSign,
  onCorrect,
  onClose,
}: {
  profile: StaffTrainingProfile;
  sessionUserId: string;
  sessionRoleKey: string;
  canManage: boolean;
  isHm: boolean;
  busy: boolean;
  staffNames: Record<string, string>;
  onInitial: (requirement: TrainingRequirementView) => void;
  onEdit: (requirement: TrainingRequirementView, existing: TrainingSignoff) => void;
  onWaive: (requirement: TrainingRequirementView) => void;
  onSign: (role: "staff" | "hm", siteId: string) => void;
  onCorrect: (countersignatureId: string) => void;
  onClose: () => void;
}) {
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
                              {signoff.initials} · {formatDate(signoff.signedOn)}
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
                            {!signoff && !locked && (
                              <>
                                <button
                                  className="button"
                                  disabled={busy}
                                  onClick={() => onInitial(line)}
                                >
                                  Initial
                                </button>{" "}
                                {canManage && (
                                  <button
                                    className="button"
                                    disabled={busy}
                                    onClick={() => onWaive(line)}
                                  >
                                    N/A
                                  </button>
                                )}
                              </>
                            )}
                            {signoff && !locked && canEditLines && (
                              <button
                                className="button"
                                disabled={busy}
                                onClick={() => onEdit(line, signoff)}
                              >
                                Edit
                              </button>
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
      {profile.countersignatures.length === 0 && (
        <>
          <p className="muted">No signatures yet for this staff member.</p>
          {canInitialOwn && firstSiteId && (
            <p>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => onSign("staff", firstSiteId)}
              >
                Begin signature sheet
              </button>
            </p>
          )}
        </>
      )}
      <ul className="signature-list">
        {profile.countersignatures.map((counter) => {
          const locked = Boolean(counter.hmSignedAt);
          return (
            <li key={counter.id}>
              <strong>{profile.siteNames[0] ?? counter.siteId}</strong>
              <span>
                Staff:{" "}
                {counter.staffSignedAt
                  ? `${counter.staffSignatureName} · ${formatDate(counter.staffSignedAt)}`
                  : "not signed"}
              </span>
              <span>
                House manager:{" "}
                {counter.hmSignedAt
                  ? `${counter.hmSignatureName} · ${formatDate(counter.hmSignedAt)} — locked`
                  : "not countersigned"}
              </span>
              <span className="signature-actions">
                {canInitialOwn && !counter.staffSignedAt && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => onSign("staff", counter.siteId)}
                  >
                    Sign as staff
                  </button>
                )}
                {isHm && counter.staffSignedAt && !locked && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => onSign("hm", counter.siteId)}
                  >
                    Countersign as HM
                  </button>
                )}
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

function InitialLineModal({
  requirement,
  existing,
  staffUserId,
  roster,
  busy,
  onClose,
  onSubmit,
}: {
  requirement: TrainingRequirementView;
  existing?: TrainingSignoff;
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
  const today = new Date().toISOString().slice(0, 10);
  const [initials, setInitials] = useState(existing?.initials ?? "");
  const [signedOn, setSignedOn] = useState(existing?.signedOn ?? today);
  const [trainerUserId, setTrainerUserId] = useState(existing?.trainerUserId ?? "");
  const [method, setMethod] = useState<TrainingMethod | "">(existing?.method ?? "");
  const [hoursTotal, setHoursTotal] = useState(existing?.hoursTotal ?? 1);
  const [hoursWithHm, setHoursWithHm] = useState(existing?.hoursWithHm ?? 0);
  const [competencyText, setCompetencyText] = useState(existing?.competencyText ?? "");
  const [observerName, setObserverName] = useState(existing?.observerName ?? "");
  const [evidenceRef, setEvidenceRef] = useState(existing?.evidenceRef ?? "");
  const [renewalRule, setRenewalRule] = useState(existing?.renewalRule ?? "");
  const isEdit = Boolean(existing);
  const selfTraining = trainerUserId !== "" && trainerUserId === staffUserId;
  return (
    <Modal title={isEdit ? "Edit training line" : "Initial training line"} onClose={onClose}>
      <p className="muted">{requirement.topicTitle}</p>
      {isEdit && (
        <p className="muted">
          You are editing an existing signoff. The change is recorded in the audit trail
          with your name.
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            initials,
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
          Your initials (no checkmarks)
          <input value={initials} onChange={(e) => setInitials(e.target.value)} required maxLength={8} />
        </label>
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
        <button className="button" type="submit" disabled={busy}>
          {isEdit ? "Save changes" : "Save initials"}
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

function SignChecklistModal({
  role,
  busy,
  onClose,
  onSubmit,
}: {
  role: "staff" | "hm";
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, mark?: string) => void;
}) {
  const [name, setName] = useState("");
  const [mark, setMark] = useState("");
  return (
    <Modal
      title={role === "staff" ? "Sign training checklist" : "Countersign as house manager"}
      onClose={onClose}
    >
      <p className="muted">
        “I acknowledge that I have been informed, understand, and have had a chance to ask
        follow-up questions regarding all training aspects above.”
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(name, mark || undefined);
        }}
      >
        <label>
          Type your name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Signature mark
          <SignaturePad onChange={setMark} />
        </label>
        <button className="button" type="submit" disabled={busy}>
          {role === "staff" ? "Sign" : "Countersign"}
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
