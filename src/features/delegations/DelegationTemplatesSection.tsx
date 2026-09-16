import { useCallback, useEffect, useState } from "react";
import { Check, PenLine } from "lucide-react";
import { Badge, Empty, formatDate } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import type { ComplyraApi } from "../../data/index";
import {
  DIGITAL_RECORD_MARK,
  trainingMaterialStatusLabel,
  type DelegationAckStatusRow,
  type DelegationAcknowledgment,
  type DelegationTemplate,
  type DelegationTemplateCategory,
  type DelegationTrainingMaterial,
  type IndividualDelegationAssignment,
  type SiteDelegationActivation,
  type TrainingMaterialContent,
} from "../../delegation/delegation";
import SignaturePad from "../SignaturePad";

/**
 * Delegation template library UI: common templates -> site activation
 * ("In preparation") -> assignment to an individual -> PM/RN review of the
 * training draft -> publication -> staff review & electronic acknowledgment.
 *
 * The ComplyraApi methods below are being implemented by a sibling agent; the
 * cast keeps this UI compiling against the agreed contract until they land.
 */
interface DelegationLibraryApi {
  listDelegationTemplates(): Promise<DelegationTemplate[]>;
  updateDelegationTemplate(
    id: string,
    patch: { name?: string; category?: DelegationTemplateCategory; active?: boolean },
  ): Promise<DelegationTemplate>;
  activateDelegationTemplate(
    templateId: string,
    siteId: string,
  ): Promise<SiteDelegationActivation>;
  deactivateDelegationActivation(id: string): Promise<void>;
  listSiteDelegationActivations(filter?: {
    siteId?: string;
  }): Promise<SiteDelegationActivation[]>;
  assignDelegationToIndividual(
    activationId: string,
    individualId: string,
  ): Promise<IndividualDelegationAssignment>;
  endDelegationAssignment(id: string): Promise<void>;
  listDelegationAssignments(filter?: {
    siteId?: string;
  }): Promise<IndividualDelegationAssignment[]>;
  getDelegationTrainingMaterial(
    assignmentId: string,
  ): Promise<DelegationTrainingMaterial | null>;
  updateDelegationTrainingDraft(
    assignmentId: string,
    draft: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial>;
  submitDelegationForReview(
    assignmentId: string,
  ): Promise<DelegationTrainingMaterial>;
  approveDelegationTrainingMaterial(
    assignmentId: string,
    content: TrainingMaterialContent,
  ): Promise<DelegationTrainingMaterial>;
  openDelegationMaterial(assignmentId: string): Promise<void>;
  getMyDelegationAck(
    assignmentId: string,
  ): Promise<DelegationAcknowledgment | null>;
  signDelegationAcknowledgment(
    assignmentId: string,
    signatureName: string,
    signatureMark: string,
  ): Promise<DelegationAcknowledgment>;
  listDelegationAckStatus(
    assignmentId: string,
  ): Promise<DelegationAckStatusRow[]>;
  sweepDelegationAckOverdue(): Promise<number>;
}

const TEMPLATE_CATEGORIES: DelegationTemplateCategory[] = [
  "Health monitoring",
  "Nutrition",
  "Safety",
  "Daily living support",
];

function parseLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

interface Perms {
  canManage: boolean;
  canActivate: boolean;
  canAssign: boolean;
  canReview: boolean;
  canApprove: boolean;
  canAcknowledge: boolean;
}

/** Rendered preview of generated training material (draft or published). */
function MaterialPreview({ content }: { content: TrainingMaterialContent }) {
  return (
    <div className="delegation-preview">
      <h4>Purpose</h4>
      <p>{content.purpose}</p>
      <h4>Steps</h4>
      <ol>
        {content.steps.map((step, i) => (
          <li key={i}>{step}</li>
        ))}
      </ol>
      <h4>Safety warnings</h4>
      <ul>
        {content.safetyWarnings.map((warning, i) => (
          <li key={i}>{warning}</li>
        ))}
      </ul>
      <h4>Documentation</h4>
      <ul>
        {content.documentation.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
      {content.individualNotes.trim() !== "" && (
        <>
          <h4>Notes for {content.individualName}</h4>
          <p>{content.individualNotes}</p>
        </>
      )}
      <p className="delegation-individualization">
        <strong>Individualization note:</strong> {content.individualizationNote}
      </p>
      <p className="record-mark">{content.generatedMark}</p>
    </div>
  );
}

function templateAsContent(template: DelegationTemplate): TrainingMaterialContent {
  return {
    templateId: template.id,
    templateName: template.name,
    individualId: "",
    individualName: "",
    siteId: "",
    siteName: "",
    purpose: template.sections.purpose,
    steps: template.sections.steps,
    safetyWarnings: template.sections.safetyWarnings,
    documentation: template.sections.documentation,
    individualNotes: "",
    individualizationNote: template.individualizationNote,
    generatedMark: DIGITAL_RECORD_MARK,
  };
}

export default function DelegationTemplatesSection() {
  const { api, session, workspace, refresh } = useData();
  const lib = api as unknown as DelegationLibraryApi;
  const [tab, setTab] = useState<"library" | "sites" | "mine">("library");
  const [error, setError] = useState("");
  const [templates, setTemplates] = useState<DelegationTemplate[] | null>(null);
  const [activations, setActivations] = useState<SiteDelegationActivation[] | null>(null);
  const [assignments, setAssignments] = useState<IndividualDelegationAssignment[] | null>(null);

  const load = useCallback(async () => {
    const [t, acts, asgs] = await Promise.all([
      lib.listDelegationTemplates(),
      lib.listSiteDelegationActivations(),
      lib.listDelegationAssignments(),
    ]);
    setTemplates(t);
    setActivations(acts);
    setAssignments(asgs);
  }, [lib]);

  useEffect(() => {
    load().catch((err) => {
      setTemplates([]);
      setActivations([]);
      setAssignments([]);
      setError(
        `Could not load the delegation template library: ${(err as Error).message}`,
      );
    });
  }, [load]);

  async function mutate(action: () => Promise<void>) {
    setError("");
    try {
      await action();
      await refresh();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!session) return null;
  if (!can(session, "delegation.templates.view")) {
    return (
      <Empty
        title="Delegation templates"
        text="You don't have access to the delegation template library."
      />
    );
  }

  const perms: Perms = {
    canManage: can(session, "delegation.templates.manage"),
    canActivate: can(session, "delegation.activate"),
    canAssign: can(session, "delegation.assign"),
    canReview: can(session, "delegation.training.review"),
    canApprove: can(session, "delegation.training.approve"),
    canAcknowledge: can(session, "delegation.acknowledge"),
  };

  const staffRow = workspace?.staff.find((s) => s.id === session.userId);
  const mySiteIds = staffRow?.siteId
    ? [staffRow.siteId]
    : (workspace?.sites ?? []).map((s) => s.id);

  return (
    <div className="delegation-templates">
      {error && <p className="form-error">{error}</p>}
      <div className="tabs">
        <button
          className={tab === "library" ? "selected" : ""}
          onClick={() => setTab("library")}
        >
          Template library
        </button>
        <button
          className={tab === "sites" ? "selected" : ""}
          onClick={() => setTab("sites")}
        >
          Site delegations
        </button>
        {perms.canAcknowledge && (
          <button
            className={tab === "mine" ? "selected" : ""}
            onClick={() => setTab("mine")}
          >
            My acknowledgments
          </button>
        )}
      </div>
      {tab === "library" && (
        <TemplateLibraryTab
          lib={lib}
          templates={templates}
          onMutate={mutate}
          onTemplateSaved={(updated) =>
            setTemplates((prev) =>
              prev?.map((t) => (t.id === updated.id ? updated : t)) ?? prev,
            )
          }
          perms={perms}
          sites={workspace?.sites ?? []}
        />
      )}
      {tab === "sites" && (
        <SiteDelegationsTab
          lib={lib}
          activations={activations}
          assignments={assignments}
          onMutate={mutate}
          perms={perms}
          sites={workspace?.sites ?? []}
          individuals={workspace?.individuals ?? []}
          defaultSiteId={mySiteIds[0] ?? workspace?.sites[0]?.id ?? ""}
        />
      )}
      {tab === "mine" && perms.canAcknowledge && (
        <MyAcknowledgmentsTab
          lib={lib}
          assignments={(assignments ?? []).filter(
            (a) => a.status === "assigned" && mySiteIds.includes(a.siteId),
          )}
          session={session}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Template library tab                                                */
/* ------------------------------------------------------------------ */

function TemplateLibraryTab({
  lib,
  templates,
  onMutate,
  onTemplateSaved,
  perms,
  sites,
}: {
  lib: DelegationLibraryApi;
  templates: DelegationTemplate[] | null;
  onMutate: (action: () => Promise<void>) => Promise<void>;
  onTemplateSaved: (updated: DelegationTemplate) => void;
  perms: Perms;
  sites: { id: string; name: string }[];
}) {
  if (templates === null) {
    return <p className="quiet-note">Loading templates…</p>;
  }
  if (templates.length === 0) {
    return (
      <Empty
        title="No templates"
        text="The delegation template library is empty."
      />
    );
  }
  return (
    <div className="delegation-template-list">
      {templates.map((template) => (
        <TemplateCard
          key={template.id}
          lib={lib}
          template={template}
          onMutate={onMutate}
          onTemplateSaved={onTemplateSaved}
          perms={perms}
          sites={sites}
        />
      ))}
    </div>
  );
}

function TemplateCard({
  lib,
  template,
  onMutate,
  onTemplateSaved,
  perms,
  sites,
}: {
  lib: DelegationLibraryApi;
  template: DelegationTemplate;
  onMutate: (action: () => Promise<void>) => Promise<void>;
  onTemplateSaved: (updated: DelegationTemplate) => void;
  perms: Perms;
  sites: { id: string; name: string }[];
}) {
  const [previewing, setPreviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [activating, setActivating] = useState(false);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");

  return (
    <div className="delegation-template-card">
      <div className="delegation-card-head">
        <div>
          <strong>{template.name}</strong>
          <div className="delegation-small">{template.category}</div>
        </div>
        <Badge status={template.active ? "Active" : "Inactive"} />
      </div>
      <div className="delegation-card-actions">
        <button
          className="button small"
          onClick={() => setPreviewing((v) => !v)}
        >
          {previewing ? "Hide preview" : "Preview"}
        </button>
        {perms.canActivate && template.active && (
          <button
            className="button small"
            onClick={() => {
              setSiteId(sites[0]?.id ?? "");
              setActivating((v) => !v);
            }}
          >
            Activate for site
          </button>
        )}
        {perms.canManage && (
          <button
            className="button small"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? "Cancel" : "Edit"}
          </button>
        )}
      </div>
      {previewing && <MaterialPreview content={templateAsContent(template)} />}
      {activating && perms.canActivate && template.active && (
        <div className="delegation-inline-form">
          <label>
            Site
            <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
          <p className="form-help">
            Activated templates are visible to site staff as “In preparation”.
            No notifications are sent.
          </p>
          <button
            className="button primary small"
            disabled={!siteId}
            onClick={() =>
              onMutate(async () => {
                await lib.activateDelegationTemplate(template.id, siteId);
                setActivating(false);
              })
            }
          >
            Activate
          </button>
        </div>
      )}
      {editing && perms.canManage && (
        <TemplateEditor
          template={template}
          onCancel={() => setEditing(false)}
          onSave={(patch) =>
            onMutate(async () => {
              const updated = await lib.updateDelegationTemplate(
                template.id,
                patch,
              );
              onTemplateSaved(updated);
              setEditing(false);
            })
          }
        />
      )}
    </div>
  );
}

function TemplateEditor({
  template,
  onSave,
  onCancel,
}: {
  template: DelegationTemplate;
  onSave: (patch: {
    name?: string;
    category?: DelegationTemplateCategory;
    active?: boolean;
  }) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(template.name);
  const [category, setCategory] = useState<DelegationTemplateCategory>(
    template.category,
  );
  const [active, setActive] = useState(template.active);
  return (
    <form
      className="delegation-inline-form"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ name: name.trim(), category, active });
      }}
    >
      <label>
        Name
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <label>
        Category
        <select
          value={category}
          onChange={(e) =>
            setCategory(e.target.value as DelegationTemplateCategory)
          }
        >
          {TEMPLATE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="delegation-check">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
        Active (available for site activation)
      </label>
      <div className="delegation-card-actions">
        <button
          className="button primary small"
          type="submit"
          disabled={!name.trim()}
        >
          Save template
        </button>
        <button className="button small" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Site delegations tab                                                */
/* ------------------------------------------------------------------ */

function SiteDelegationsTab({
  lib,
  activations,
  assignments,
  onMutate,
  perms,
  sites,
  individuals,
  defaultSiteId,
}: {
  lib: DelegationLibraryApi;
  activations: SiteDelegationActivation[] | null;
  assignments: IndividualDelegationAssignment[] | null;
  onMutate: (action: () => Promise<void>) => Promise<void>;
  perms: Perms;
  sites: { id: string; name: string }[];
  individuals: { id: string; name: string; site: string }[];
  defaultSiteId: string;
}) {
  const [siteId, setSiteId] = useState(defaultSiteId);
  useEffect(() => {
    if (!siteId && sites[0]) setSiteId(sites[0].id);
  }, [sites, siteId]);
  const site = sites.find((s) => s.id === siteId);
  const activeActivations = (activations ?? []).filter(
    (a) => a.siteId === siteId && a.status === "active",
  );

  return (
    <div className="delegation-sites">
      <div className="delegation-inline-form delegation-site-select">
        <label>
          Site
          <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {activations === null || assignments === null ? (
        <p className="quiet-note">Loading site delegations…</p>
      ) : activeActivations.length === 0 ? (
        <Empty
          title="No active delegations"
          text="Activate a template for this site from the template library."
        />
      ) : (
        activeActivations.map((activation) => (
          <ActivationCard
            key={activation.id}
            lib={lib}
            activation={activation}
            assignments={(assignments ?? []).filter(
              (a) => a.activationId === activation.id,
            )}
            siteName={site?.name ?? activation.siteName}
            onMutate={onMutate}
            perms={perms}
            individuals={individuals}
          />
        ))
      )}
    </div>
  );
}

function ActivationCard({
  lib,
  activation,
  assignments,
  siteName,
  onMutate,
  perms,
  individuals,
}: {
  lib: DelegationLibraryApi;
  activation: SiteDelegationActivation;
  assignments: IndividualDelegationAssignment[];
  siteName: string;
  onMutate: (action: () => Promise<void>) => Promise<void>;
  perms: Perms;
  individuals: { id: string; name: string; site: string }[];
}) {
  const [assigning, setAssigning] = useState(false);
  const [individualId, setIndividualId] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const siteIndividuals = individuals.filter((p) => p.site === siteName);

  return (
    <div className="delegation-activation-card">
      <div className="delegation-card-head">
        <div>
          <strong>{activation.templateName}</strong>
          <div className="delegation-small">
            {activation.templateCategory} · activated {formatDate(activation.activatedAt)} by{" "}
            {activation.activatedBy}
          </div>
        </div>
        <Badge status="In preparation" />
      </div>
      <div className="delegation-card-actions">
        {perms.canAssign && (
          <button
            className="button small"
            onClick={() => {
              setIndividualId("");
              setAssigning((v) => !v);
            }}
          >
            Assign to individual
          </button>
        )}
        {perms.canActivate && (
          <button
            className="button small"
            onClick={() =>
              onMutate(() => lib.deactivateDelegationActivation(activation.id))
            }
          >
            Deactivate
          </button>
        )}
      </div>
      {assigning && perms.canAssign && (
        <div className="delegation-inline-form">
          <label>
            Individual
            <select
              value={individualId}
              onChange={(e) => setIndividualId(e.target.value)}
            >
              <option value="">Select…</option>
              {siteIndividuals.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button primary small"
            disabled={!individualId}
            onClick={() =>
              onMutate(async () => {
                await lib.assignDelegationToIndividual(
                  activation.id,
                  individualId,
                );
                setAssigning(false);
              })
            }
          >
            Assign
          </button>
        </div>
      )}
      {assignments.length > 0 && (
        <div className="delegation-assignment-list">
          {assignments.map((assignment) => (
            <div key={assignment.id} className="delegation-assignment">
              <div className="delegation-assignment-row">
                <div>
                  <strong>{assignment.individualName}</strong>
                  <div className="delegation-small">
                    Assigned {formatDate(assignment.assignedAt)} by{" "}
                    {assignment.assignedBy}
                  </div>
                </div>
                <Badge
                  status={
                    assignment.status === "assigned" ? "In preparation" : "Ended"
                  }
                />
                <button
                  className="button small"
                  onClick={() =>
                    setOpenId((v) => (v === assignment.id ? null : assignment.id))
                  }
                >
                  {openId === assignment.id ? "Close" : "Open"}
                </button>
              </div>
              {openId === assignment.id && (
                <AssignmentDetail
                  lib={lib}
                  assignment={assignment}
                  onMutate={onMutate}
                  perms={perms}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssignmentDetail({
  lib,
  assignment,
  onMutate,
  perms,
}: {
  lib: DelegationLibraryApi;
  assignment: IndividualDelegationAssignment;
  onMutate: (action: () => Promise<void>) => Promise<void>;
  perms: Perms;
}) {
  const [material, setMaterial] = useState<DelegationTrainingMaterial | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [roster, setRoster] = useState<DelegationAckStatusRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [confirmingApprove, setConfirmingApprove] = useState(false);
  const [notice, setNotice] = useState("");

  const canSeeRoster = perms.canReview || perms.canApprove || perms.canActivate;

  const reload = useCallback(async () => {
    const m = await lib.getDelegationTrainingMaterial(assignment.id);
    setMaterial(m);
    if (canSeeRoster) {
      setRoster(await lib.listDelegationAckStatus(assignment.id));
    }
  }, [lib, assignment.id, canSeeRoster]);

  useEffect(() => {
    reload()
      .then(() => setLoaded(true))
      .catch((err) => {
        setLoadError((err as Error).message);
        setLoaded(true);
      });
  }, [reload]);

  async function afterMaterial(action: () => Promise<DelegationTrainingMaterial>) {
    setNotice("");
    await onMutate(async () => {
      setMaterial(await action());
      setEditing(false);
      setConfirmingApprove(false);
      if (canSeeRoster) {
        setRoster(await lib.listDelegationAckStatus(assignment.id));
      }
    });
  }

  if (!loaded) return <p className="quiet-note">Loading…</p>;
  if (loadError) return <p className="inline-error">{loadError}</p>;

  const status = material?.status;
  const published = material?.status === "published" && material.publishedContent;
  const canWorkDraft = perms.canReview || perms.canApprove;

  return (
    <div className="delegation-detail">
      <div className="delegation-detail-head">
        {material && (
          <Badge status={trainingMaterialStatusLabel(material.status)} />
        )}
        {!material && <span className="quiet-note">No training material yet.</span>}
      </div>

      {material && status !== "published" && (
        <>
          {canWorkDraft ? (
            <>
              <MaterialPreview content={material.draftContent} />
              {!editing && (
                <div className="delegation-card-actions">
                  <button
                    className="button small"
                    onClick={() => setEditing(true)}
                  >
                    Review &amp; edit draft
                  </button>
                  {perms.canReview && status === "draft" && (
                    <button
                      className="button small"
                      onClick={() =>
                        afterMaterial(() => lib.submitDelegationForReview(assignment.id))
                      }
                    >
                      Submit for review
                    </button>
                  )}
                  {perms.canApprove && (
                    confirmingApprove ? (
                      <>
                        <span className="delegation-small">
                          Publishing makes this material visible to site staff.
                        </span>
                        <button
                          className="button primary small"
                          onClick={() =>
                            afterMaterial(() =>
                              lib.approveDelegationTrainingMaterial(
                                assignment.id,
                                material.draftContent,
                              ),
                            )
                          }
                        >
                          Confirm publish
                        </button>
                        <button
                          className="button small"
                          onClick={() => setConfirmingApprove(false)}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        className="button primary small"
                        onClick={() => setConfirmingApprove(true)}
                      >
                        Approve &amp; publish
                      </button>
                    )
                  )}
                </div>
              )}
              {editing && (
                <DraftEditor
                  initial={material.draftContent}
                  onCancel={() => setEditing(false)}
                  onSave={(draft) =>
                    afterMaterial(() =>
                      lib.updateDelegationTrainingDraft(assignment.id, draft),
                    )
                  }
                />
              )}
            </>
          ) : (
            <p className="quiet-note">
              This training material is in preparation and not yet published.
            </p>
          )}
        </>
      )}

      {published && <MaterialPreview content={published} />}

      {canSeeRoster && (
        <div className="delegation-roster">
          <div className="delegation-roster-head">
            <h4>Acknowledgment roster</h4>
            {(perms.canReview || perms.canActivate) && (
              <button
                className="button small"
                onClick={() =>
                  onMutate(async () => {
                    const count = await lib.sweepDelegationAckOverdue();
                    setNotice(
                      count === 1
                        ? "1 overdue reminder sent."
                        : `${count} overdue reminders sent.`,
                    );
                  })
                }
              >
                Send overdue reminders
              </button>
            )}
          </div>
          {notice && <p className="delegation-notice">{notice}</p>}
          {roster.length === 0 ? (
            <p className="quiet-note">No staff on the acknowledgment roster.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Staff member</th>
                    <th>Opened</th>
                    <th>Signed</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((row) => (
                    <tr key={row.staffId}>
                      <td>{row.staffName}</td>
                      <td>{row.openedAt ? formatDate(row.openedAt) : "—"}</td>
                      <td>{row.signedAt ? formatDate(row.signedAt) : "—"}</td>
                      <td>
                        <Badge
                          status={
                            row.signedAt
                              ? "Signed"
                              : row.overdue
                                ? "Overdue"
                                : "Outstanding"
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {perms.canAssign && assignment.status === "assigned" && (
        <div className="delegation-card-actions">
          <button
            className="button small"
            onClick={() => onMutate(() => lib.endDelegationAssignment(assignment.id))}
          >
            End assignment
          </button>
        </div>
      )}
    </div>
  );
}

function DraftEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: TrainingMaterialContent;
  onSave: (draft: TrainingMaterialContent) => Promise<void>;
  onCancel: () => void;
}) {
  const [purpose, setPurpose] = useState(initial.purpose);
  const [steps, setSteps] = useState(initial.steps.join("\n"));
  const [safetyWarnings, setSafetyWarnings] = useState(
    initial.safetyWarnings.join("\n"),
  );
  const [documentation, setDocumentation] = useState(
    initial.documentation.join("\n"),
  );
  const [individualNotes, setIndividualNotes] = useState(initial.individualNotes);

  return (
    <form
      className="delegation-inline-form delegation-draft-editor"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({
          ...initial,
          purpose: purpose.trim(),
          steps: parseLines(steps),
          safetyWarnings: parseLines(safetyWarnings),
          documentation: parseLines(documentation),
          individualNotes: individualNotes.trim(),
        });
      }}
    >
      <h4>Edit draft — individualize for {initial.individualName}</h4>
      <label>
        Purpose
        <textarea
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          rows={3}
          required
        />
      </label>
      <label>
        Steps (one per line)
        <textarea
          value={steps}
          onChange={(e) => setSteps(e.target.value)}
          rows={6}
          required
        />
      </label>
      <label>
        Safety warnings (one per line)
        <textarea
          value={safetyWarnings}
          onChange={(e) => setSafetyWarnings(e.target.value)}
          rows={4}
        />
      </label>
      <label>
        Documentation (one per line)
        <textarea
          value={documentation}
          onChange={(e) => setDocumentation(e.target.value)}
          rows={4}
        />
      </label>
      <label>
        Notes for this individual
        <textarea
          value={individualNotes}
          onChange={(e) => setIndividualNotes(e.target.value)}
          rows={3}
          placeholder="Person-specific additions the staff must know"
        />
      </label>
      <p className="form-help">{initial.individualizationNote}</p>
      <div className="delegation-card-actions">
        <button className="button primary small" type="submit">
          Save draft
        </button>
        <button className="button small" type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* My acknowledgments tab                                              */
/* ------------------------------------------------------------------ */

function MyAcknowledgmentsTab({
  lib,
  assignments,
  session,
}: {
  lib: DelegationLibraryApi;
  assignments: IndividualDelegationAssignment[];
  session: { userId: string; fullName: string };
}) {
  const [pairs, setPairs] = useState<
    { assignment: IndividualDelegationAssignment; material: DelegationTrainingMaterial }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const found: typeof pairs = [];
        const results = await Promise.all(
          assignments.map(async (assignment) => ({
            assignment,
            material: await lib.getDelegationTrainingMaterial(assignment.id),
          })),
        );
        for (const { assignment, material } of results) {
          if (material?.status === "published" && material.publishedContent) {
            found.push({ assignment, material });
          }
        }
        setPairs(found);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [lib, assignments]);

  if (loading) return <p className="quiet-note">Loading your acknowledgments…</p>;
  if (error) return <p className="inline-error">{error}</p>;
  if (pairs.length === 0) {
    return (
      <Empty
        title="Nothing to acknowledge"
        text="No published delegation training material is waiting for your signature."
      />
    );
  }
  return (
    <div className="delegation-template-list">
      {pairs.map(({ assignment, material }) => (
        <MyAckCard
          key={assignment.id}
          lib={lib}
          assignment={assignment}
          material={material}
          session={session}
        />
      ))}
    </div>
  );
}

function MyAckCard({
  lib,
  assignment,
  material,
  session,
}: {
  lib: DelegationLibraryApi;
  assignment: IndividualDelegationAssignment;
  material: DelegationTrainingMaterial;
  session: { userId: string; fullName: string };
}) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState<DelegationAcknowledgment | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [legalName, setLegalName] = useState(session.fullName ?? "");
  const [mark, setMark] = useState("");

  async function loadAck() {
    try {
      setAck(await lib.getMyDelegationAck(assignment.id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    if (open && !loaded) void loadAck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function run(action: () => Promise<unknown>) {
    setError("");
    try {
      await action();
      await loadAck();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const published = material.publishedContent!;
  const signed = Boolean(ack?.signedAt);

  return (
    <div className="delegation-template-card">
      <div className="delegation-card-head">
        <div>
          <strong>{assignment.templateName}</strong>
          <div className="delegation-small">
            {assignment.individualName} · {assignment.siteName}
          </div>
        </div>
        <Badge status={signed ? "Signed" : "Outstanding"} />
      </div>
      {error && <p className="inline-error">{error}</p>}
      <div className="delegation-card-actions">
        <button className="button small" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Review & sign"}
        </button>
      </div>
      {open && (
        <div className="delegation-detail">
          {/* Record mark is rendered inside MaterialPreview from publishedContent.generatedMark. */}
          <MaterialPreview content={published} />
          {loaded && !signed && (
            <>
              {!ack?.openedAt ? (
                <button
                  className="button primary"
                  onClick={() => run(() => lib.openDelegationMaterial(assignment.id))}
                >
                  I have reviewed this material
                </button>
              ) : (
                <div className="delegation-sign">
                  <h4 className="section-label">Your signature</h4>
                  <p className="form-help">
                    Review the material above first. Signing records your legal
                    name, mark, and the time.
                  </p>
                  <label className="form-label">
                    Legal name
                    <input
                      value={legalName}
                      onChange={(e) => setLegalName(e.target.value)}
                    />
                  </label>
                  <SignaturePad onChange={setMark} />
                  <button
                    className="button primary full"
                    disabled={!legalName.trim() || !mark}
                    onClick={() =>
                      run(() =>
                        lib.signDelegationAcknowledgment(
                          assignment.id,
                          legalName.trim(),
                          mark,
                        ),
                      )
                    }
                  >
                    <PenLine size={16} /> Sign acknowledgment
                  </button>
                </div>
              )}
            </>
          )}
          {loaded && signed && ack && (
            <div className="evidence-confirmed">
              <Check size={20} />
              <div>
                <strong>You signed this material</strong>
                <p>{new Date(ack.signedAt!).toLocaleString()}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
