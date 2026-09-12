import { useState } from "react";
import { Check, FileText, LockKeyhole, PenLine } from "lucide-react";
import { Badge, formatDate } from "../components";
import { useData } from "../data/DataProvider";
import { can } from "../data/status";
import {
  canEditCover,
  canEditExtraction,
  canToggleDelegation,
  isObligationActive,
  type IndividualProfile,
  type ObligationView,
} from "../data/planStack";
import SignaturePad from "./SignaturePad";

type Tab = "required" | "checked";

export default function AssignedDocsPanel({
  individualId,
}: {
  individualId: string;
}) {
  const { api, session, workspace, refresh } = useData();
  const stack = workspace?.planStacks.find((item) => item.individualId === individualId);
  const person = workspace?.individuals.find((item) => item.id === individualId);
  const [tab, setTab] = useState<Tab>("required");
  const [signingId, setSigningId] = useState<string | null>(null);
  const [legalName, setLegalName] = useState(session?.fullName ?? "");
  const [mark, setMark] = useState("");
  const [error, setError] = useState("");
  const [protocolTitle, setProtocolTitle] = useState("");
  const [shiftDraft, setShiftDraft] = useState("");
  const [profile, setProfile] = useState<IndividualProfile | null>(null);

  if (!session || !stack || !person) return null;

  const editCover = canEditCover(session.roleKey);
  const editExtract = canEditExtraction(
    session.roleKey,
    can(session, "requirements.approve"),
  );
  const editDelegation = canToggleDelegation(
    session.roleKey,
    session.role,
    can(session, "requirements.approve"),
  );
  const activeProfile = profile ?? stack.profile;

  async function run(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="plan-stack">
      <div className="profile-heading">
        <div>
          <h2>{activeProfile.goesBy || person.name}</h2>
          <p>
            {person.site}
            {activeProfile.dmhId ? ` · DMH ${activeProfile.dmhId}` : ""}
            {person.dateOfBirth ? ` · DOB ${formatDate(person.dateOfBirth)}` : ""}
          </p>
        </div>
      </div>

      <section className="cover-fields">
        <h3 className="section-label">Cover page</h3>
        <div className="cover-grid">
          {(
            [
              ["legalName", "Legal name"],
              ["goesBy", "Goes by"],
              ["dmhId", "DMH ID"],
              ["diagnosis", "Primary diagnosis"],
              ["waiver", "Waiver"],
              ["address", "Address"],
              ["phone", "Phone"],
              ["language", "Language"],
              ["implementationStart", "Implementation start"],
              ["implementationEnd", "Implementation end"],
              ["serviceCoordinator", "Service coordinator"],
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                value={activeProfile[key]}
                disabled={!editCover}
                onChange={(e) =>
                  setProfile({ ...activeProfile, [key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        {editCover && (
          <button
            className="button"
            onClick={() =>
              run(() => api.updateIndividualProfile(individualId, activeProfile))
            }
          >
            Save cover page
          </button>
        )}
      </section>

      <div className="stack-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "required"}
          className={tab === "required" ? "active" : ""}
          onClick={() => setTab("required")}
        >
          Must acknowledge
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "checked"}
          className={tab === "checked" ? "active" : ""}
          onClick={() => setTab("checked")}
        >
          Checked in plan
        </button>
      </div>

      {error && <p className="form-error">{error}</p>}

      {tab === "required" ? (
        <RequiredList
          items={stack.required}
          signingId={signingId}
          legalName={legalName}
          mark={mark}
          canSign={can(session, "acknowledgments.sign_own")}
          editExtract={editExtract}
          editDelegation={editDelegation}
          canSubmit={stack.canSubmit}
          submittedAt={stack.mySubmissionAt}
          onSignId={setSigningId}
          onLegalName={setLegalName}
          onMark={setMark}
          onOpen={(id) => run(() => api.markObligationOpened(id))}
          onSign={(id) =>
            run(async () => {
              await api.signObligation(id, legalName, mark);
              setSigningId(null);
              setMark("");
            })
          }
          onToggle={(id, enabled) => run(() => api.updateObligation(id, { enabled }))}
          onSubmit={() => run(() => api.submitPlanPacket(individualId))}
        />
      ) : (
        <CheckedList
          items={stack.checked}
          editExtract={editExtract}
          shiftDraft={shiftDraft}
          onShiftDraft={setShiftDraft}
          onState={(id, inventoryState) =>
            run(() => api.updateObligation(id, { inventoryState }))
          }
          onPromote={(id) =>
            run(() =>
              api.promoteToShiftTask(
                id,
                shiftDraft.split(",").map((part) => part.trim()).filter(Boolean),
              ),
            )
          }
        />
      )}

      {editExtract && (
        <form
          className="add-protocol"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api.addProtocol(individualId, protocolTitle);
              setProtocolTitle("");
            });
          }}
        >
          <label>
            Add a protocol
            <input
              value={protocolTitle}
              onChange={(e) => setProtocolTitle(e.target.value)}
              placeholder="e.g. Aspiration protocol"
            />
          </label>
          <button className="button" type="submit">
            Add
          </button>
        </form>
      )}
    </div>
  );
}

function RequiredList({
  items,
  signingId,
  legalName,
  mark,
  canSign,
  editExtract,
  editDelegation,
  canSubmit,
  submittedAt,
  onSignId,
  onLegalName,
  onMark,
  onOpen,
  onSign,
  onToggle,
  onSubmit,
}: {
  items: ObligationView[];
  signingId: string | null;
  legalName: string;
  mark: string;
  canSign: boolean;
  editExtract: boolean;
  editDelegation: boolean;
  canSubmit: boolean;
  submittedAt: string | null;
  onSignId: (id: string | null) => void;
  onLegalName: (value: string) => void;
  onMark: (value: string) => void;
  onOpen: (id: string) => void;
  onSign: (id: string) => void;
  onToggle: (id: string, enabled: boolean) => void;
  onSubmit: () => void;
}) {
  const visible = items.filter(
    (view) => view.item.enabled || view.item.kind === "delegation",
  );
  return (
    <div className="obligation-list">
      <p className="stack-help">
        Sign each required document. Submit the packet when every item on your
        list is signed.
      </p>
      {visible.map((view) => {
        const mine = view.mySignature;
        const openForMe =
          view.item.enabled &&
          isObligationActive(view.item) &&
          view.item.mode === "required";
        return (
          <article key={view.item.id} className="obligation-card">
            <header>
              <span className={`kind-pill ${view.item.kind}`}>{view.item.kind.replace("_", " ")}</span>
              <h3>{view.item.title}</h3>
              <Badge
                status={
                  mine?.signedAt
                    ? "Signed"
                    : view.item.enabled
                      ? "Needs signature"
                      : "Off"
                }
              />
            </header>
            <p>{view.item.detail}</p>
            {view.item.shiftPeriods.length > 0 && (
              <p className="shift-periods">
                Shift periods: {view.item.shiftPeriods.join(", ")}
              </p>
            )}
            <small>
              {view.signedCount}/{view.assignedCount} assigned staff signed
              {view.item.sourcePage ? ` · p.${view.item.sourcePage}` : ""}
            </small>
            <div className="obligation-actions">
              {view.item.kind === "delegation" && editDelegation && (
                <button
                  className="button"
                  onClick={() => onToggle(view.item.id, !view.item.enabled)}
                >
                  {view.item.enabled ? "Turn delegation off" : "Turn delegation on"}
                </button>
              )}
              {openForMe && mine && !mine.signedAt && canSign && (
                <>
                  <button className="button" onClick={() => onOpen(mine.id)}>
                    <FileText size={16} /> Review
                  </button>
                  <button
                    className="button primary"
                    disabled={!mine.openedAt}
                    onClick={() => onSignId(mine.id)}
                  >
                    <PenLine size={16} /> Sign
                  </button>
                </>
              )}
              {mine?.signedAt && (
                <span className="signed-flag">
                  <Check size={16} /> Signed {formatDate(mine.signedAt)}
                </span>
              )}
            </div>
            {signingId === mine?.id && (
              <div className="sign-box">
                <label>
                  Printed name
                  <input
                    value={legalName}
                    onChange={(e) => onLegalName(e.target.value)}
                  />
                </label>
                <SignaturePad onChange={onMark} />
                <button
                  className="button primary"
                  disabled={!mark}
                  onClick={() => onSign(mine.id)}
                >
                  Save signature
                </button>
              </div>
            )}
            {editExtract && view.item.kind !== "delegation" && !view.item.enabled && (
              <button className="button" onClick={() => onToggle(view.item.id, true)}>
                Require this item
              </button>
            )}
          </article>
        );
      })}
      {submittedAt ? (
        <p className="quiet-note">
          <LockKeyhole size={15} /> Packet submitted {formatDate(submittedAt)}.
        </p>
      ) : (
        <button className="button primary full" disabled={!canSubmit} onClick={onSubmit}>
          Submit signed packet
        </button>
      )}
    </div>
  );
}

function CheckedList({
  items,
  editExtract,
  shiftDraft,
  onShiftDraft,
  onState,
  onPromote,
}: {
  items: ObligationView[];
  editExtract: boolean;
  shiftDraft: string;
  onShiftDraft: (value: string) => void;
  onState: (id: string, state: "present" | "missing" | "na" | "unchecked") => void;
  onPromote: (id: string) => void;
}) {
  return (
    <div className="obligation-list">
      <p className="stack-help">
        These sections were found in the plan. They are not signature tasks
        unless a DPM turns one into a daily shift requirement.
      </p>
      {editExtract && (
        <label>
          Shift periods for a daily task (comma-separated)
          <input
            value={shiftDraft}
            onChange={(e) => onShiftDraft(e.target.value)}
            placeholder="7a–3p, 3p–11p"
          />
        </label>
      )}
      {items.map((view) => (
        <article key={view.item.id} className="obligation-card">
          <header>
            <span className="kind-pill inventory">checked</span>
            <h3>{view.item.title}</h3>
            <Badge status={view.item.inventoryState} />
          </header>
          <p>{view.item.detail}</p>
          {editExtract && (
            <div className="obligation-actions">
              {(["present", "missing", "na"] as const).map((state) => (
                <button
                  key={state}
                  className="button"
                  onClick={() => onState(view.item.id, state)}
                >
                  Mark {state}
                </button>
              ))}
              <button className="button primary" onClick={() => onPromote(view.item.id)}>
                Make daily shift task
              </button>
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
