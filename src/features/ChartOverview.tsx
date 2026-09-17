/**
 * ChartOverview.tsx — issue #81: the Individual chart "Overview" section.
 *
 * Extends the existing IndividualChart with, in order:
 *   1. Identity strip (photo, legal name, optional DMH ID, site, DOB)
 *   2. PCSP / trackables summary (active plan-year tasks + completion rollup)
 *   3. Active diagnoses
 *   4. Medication list with a quiet read-through to the medication board
 *      (the scheduled MAR grid itself ships separately in #64)
 *   5. Contacts: read-only agency contacts (site managers + administrators),
 *      manager-editable personal contacts, and manager-editable providers
 *   6. Quiet links to Appointments, the medication board, and Shift notes
 *
 * Visibility and editing are gated by canSeeChartOverview /
 * canEditIndividualContacts / canEditDiagnoses from src/data/chart.ts.
 * Contacts are never invented: only stored contacts render, and an empty
 * provider list shows "No providers yet".
 */
import { useState } from "react";
import type { MouseEvent } from "react";
import { Pencil, Plus, Printer } from "lucide-react";
import { Empty } from "../components";
import {
  canEditDiagnoses,
  canEditIndividualContacts,
  pcspTaskSummary,
  todayIso,
} from "../data/chart";
import { portraitSrc } from "../data/personPortrait";
import type {
  GuardianContact,
  IndividualProfile,
  PlanStackView,
  ProviderContact,
} from "../data/planStack";

export interface OverviewPerson {
  id: string;
  name: string;
  site: string;
  siteId: string;
  dateOfBirth: string;
  photoUrl?: string | null;
}

export interface OverviewStaffMember {
  id: string;
  name: string;
  role: string;
  roleKey: string;
  siteId: string | null;
  expiresOn: string | null;
}

export interface ChartOverviewProps {
  person: OverviewPerson;
  profile: IndividualProfile;
  stack: PlanStackView;
  staff: OverviewStaffMember[];
  sessionRoleKey: string;
  onUpdateContacts: (patch: {
    guardians: GuardianContact[];
    providerContacts: ProviderContact[];
  }) => Promise<void>;
  onUpdateDiagnosis: (diagnosis: string) => Promise<void>;
  onPrintProfile: () => Promise<void>;
  run: (action: () => Promise<void>) => Promise<void>;
}

const MANAGER_ROLE_KEYS = ["house_manager", "program_manager"];

function staffActive(member: OverviewStaffMember, today: string) {
  return !member.expiresOn || member.expiresOn >= today;
}

function ContactLines({
  contact,
}: {
  contact: { phone: string; email: string; address?: string; notes?: string };
}) {
  const lines: { label: string; value: string }[] = [];
  if (contact.phone) lines.push({ label: "Phone", value: contact.phone });
  if (contact.email) lines.push({ label: "Email", value: contact.email });
  if (contact.address) lines.push({ label: "Address", value: contact.address });
  if (contact.notes) lines.push({ label: "Notes", value: contact.notes });
  if (lines.length === 0) return <p className="overview-contact-empty">No contact details on file.</p>;
  return (
    <dl className="overview-contact-lines">
      {lines.map((line) => (
        <div key={line.label}>
          <dt>{line.label}</dt>
          <dd>{line.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface ContactDraft {
  name: string;
  role: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

function ContactEditor({
  kind,
  initial,
  onSave,
  onCancel,
}: {
  kind: "guardian" | "provider";
  initial: ContactDraft;
  onSave: (draft: ContactDraft) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ContactDraft>(initial);
  const set = (key: keyof ContactDraft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft((prev) => ({ ...prev, [key]: event.target.value }));
  const roleLabel = kind === "provider" ? "Role" : "Role / relationship";
  const roleHint =
    kind === "provider" ? "e.g. PCP, neurologist, dentist, pharmacy" : "e.g. Family, guardian, friend";
  const canSave = draft.name.trim().length > 0 && (kind === "guardian" || draft.role.trim().length > 0);
  return (
    <form
      className="overview-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave) onSave(draft);
      }}
    >
      <div className="overview-form-grid">
        <label>
          Name
          <input value={draft.name} onChange={set("name")} required autoComplete="off" />
        </label>
        <label>
          {roleLabel}
          <input
            value={draft.role}
            onChange={set("role")}
            required={kind === "provider"}
            placeholder={roleHint}
            autoComplete="off"
          />
        </label>
        <label>
          Phone
          <input value={draft.phone} onChange={set("phone")} inputMode="tel" autoComplete="off" />
        </label>
        <label>
          Email
          <input value={draft.email} onChange={set("email")} inputMode="email" autoComplete="off" />
        </label>
        <label className="overview-form-span">
          Address
          <input value={draft.address} onChange={set("address")} autoComplete="off" />
        </label>
        <label className="overview-form-span">
          Notes
          <textarea value={draft.notes} onChange={set("notes")} rows={2} />
        </label>
      </div>
      <div className="overview-editor-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="button primary" disabled={!canSave}>
          Save contact
        </button>
      </div>
    </form>
  );
}

/** In-page scroll for the quiet section links (see note at the nav). */
function scrollToChartSection(id: string) {
  return (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
}

export default function ChartOverview({
  person,
  profile,
  stack,
  staff,
  sessionRoleKey,
  onUpdateContacts,
  onUpdateDiagnosis,
  onPrintProfile,
  run,
}: ChartOverviewProps) {
  const today = todayIso();
  const summary = pcspTaskSummary([...stack.required, ...stack.checked]);
  const canEditContacts = canEditIndividualContacts(sessionRoleKey);
  const canEditDiagnosis = canEditDiagnoses(sessionRoleKey);

  const managers = staff
    .filter(
      (member) =>
        MANAGER_ROLE_KEYS.includes(member.roleKey) &&
        member.siteId === person.siteId &&
        staffActive(member, today),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const administrators = staff
    .filter((member) => member.roleKey === "administrator" && staffActive(member, today))
    .sort((a, b) => a.name.localeCompare(b.name));

  const [editingDiagnosis, setEditingDiagnosis] = useState(false);
  const [diagnosisDraft, setDiagnosisDraft] = useState(profile.diagnosis);
  const [editing, setEditing] = useState<
    | { kind: "guardian"; index: number | null }
    | { kind: "provider"; index: number | null }
    | null
  >(null);

  const legalName = profile.legalName.trim() || person.name;
  const dmhId = profile.dmhId.trim();

  const openEditor = (kind: "guardian" | "provider", index: number | null) => {
    setEditing({ kind, index });
  };

  const editorInitial = (): ContactDraft => {
    if (!editing) return { name: "", role: "", phone: "", email: "", address: "", notes: "" };
    if (editing.kind === "guardian") {
      const contact = editing.index === null ? null : profile.guardians[editing.index];
      return {
        name: contact?.name ?? "",
        role: contact?.relationship ?? "",
        phone: contact?.phone ?? "",
        email: contact?.email ?? "",
        address: contact?.address ?? "",
        notes: contact?.notes ?? "",
      };
    }
    const contact = editing.index === null ? null : profile.providerContacts[editing.index];
    return {
      name: contact?.name ?? "",
      role: contact?.role ?? "",
      phone: contact?.phone ?? "",
      email: contact?.email ?? "",
      address: contact?.address ?? "",
      notes: contact?.notes ?? "",
    };
  };

  const saveContact = async (draft: ContactDraft) => {
    if (!editing) return;
    const trimmed = {
      name: draft.name.trim(),
      role: draft.role.trim(),
      phone: draft.phone.trim(),
      email: draft.email.trim(),
      address: draft.address.trim(),
      notes: draft.notes.trim(),
    };
    if (editing.kind === "guardian") {
      const next = [...profile.guardians];
      const row: GuardianContact = {
        name: trimmed.name,
        relationship: trimmed.role,
        phone: trimmed.phone,
        email: trimmed.email,
        preferredContact: editing.index === null ? "" : (next[editing.index]?.preferredContact ?? ""),
        address: trimmed.address,
        notes: trimmed.notes,
      };
      if (editing.index === null) next.push(row);
      else next[editing.index] = row;
      let saved = false;
      await run(async () => {
        await onUpdateContacts({ guardians: next, providerContacts: profile.providerContacts });
        saved = true;
      });
      if (saved) setEditing(null);
    } else {
      const next = [...profile.providerContacts];
      const existing = editing.index === null ? null : next[editing.index];
      const row: ProviderContact = {
        id: existing?.id ?? `provider-${Date.now().toString(36)}`,
        name: trimmed.name,
        role: trimmed.role,
        phone: trimmed.phone,
        email: trimmed.email,
        address: trimmed.address,
        notes: trimmed.notes,
      };
      if (editing.index === null) next.push(row);
      else next[editing.index] = row;
      let saved = false;
      await run(async () => {
        await onUpdateContacts({ guardians: profile.guardians, providerContacts: next });
        saved = true;
      });
      if (saved) setEditing(null);
    }
  };

  const saveDiagnosis = async () => {
    let saved = false;
    await run(async () => {
      await onUpdateDiagnosis(diagnosisDraft);
      saved = true;
    });
    if (saved) setEditingDiagnosis(false);
  };

  return (
    <section className="chart-widget overview" aria-labelledby="overview-heading">
      <div className="overview-head">
        <h2 id="overview-heading">Overview</h2>
        <button type="button" className="button" onClick={() => run(() => onPrintProfile())}>
          <Printer size={16} aria-hidden="true" /> Print profile
        </button>
      </div>

      {/* 1. Identity strip */}
      <div className="overview-identity">
        <img
          className="overview-photo"
          src={portraitSrc(person.name, person.photoUrl ?? undefined)}
          alt={`Photo of ${legalName}`}
        />
        <dl className="overview-identity-lines">
          <div>
            <dt>Legal name</dt>
            <dd className="overview-legal-name">{legalName}</dd>
          </div>
          {profile.goesBy.trim() && profile.goesBy.trim() !== legalName ? (
            <div>
              <dt>Goes by</dt>
              <dd>{profile.goesBy.trim()}</dd>
            </div>
          ) : null}
          {dmhId ? (
            <div>
              <dt>DMH ID</dt>
              <dd>{dmhId}</dd>
            </div>
          ) : null}
          <div>
            <dt>Site</dt>
            <dd>{person.site}</dd>
          </div>
          <div>
            <dt>Date of birth</dt>
            <dd>{person.dateOfBirth}</dd>
          </div>
        </dl>
      </div>

      {/* 2. PCSP / trackables summary */}
      <h3 className="overview-subhead">PCSP / trackables summary</h3>
      {summary.tasks.length === 0 ? (
        <p className="overview-muted">No PCSP tasks on this chart yet.</p>
      ) : (
        <div className="overview-pcsp">
          <p className="overview-pcsp-counts">
            {summary.active} active · {summary.completed} completed
          </p>
          <ul className="overview-task-list">
            {summary.tasks.map((task) => (
              <li key={task.id} className={task.completed ? "is-done" : undefined}>
                <span className="overview-task-title">{task.title}</span>
                {task.frequency ? <span className="overview-task-freq">{task.frequency}</span> : null}
                {task.completed ? <span className="overview-task-done">Completed</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 3. Diagnoses */}
      <h3 className="overview-subhead">Diagnoses</h3>
      {editingDiagnosis ? (
        <div className="overview-editor">
          <label className="overview-diagnosis-label">
            Active diagnoses
            <textarea
              value={diagnosisDraft}
              onChange={(event) => setDiagnosisDraft(event.target.value)}
              rows={3}
              aria-label="Active diagnoses"
            />
          </label>
          <div className="overview-editor-actions">
            <button type="button" className="button" onClick={() => setEditingDiagnosis(false)}>
              Cancel
            </button>
            <button type="button" className="button primary" onClick={saveDiagnosis}>
              Save diagnoses
            </button>
          </div>
        </div>
      ) : (
        <div className="overview-row">
          <p className="overview-muted" style={{ margin: 0 }}>
            {profile.diagnosis.trim() ? profile.diagnosis.trim() : "No diagnosis on file."}
          </p>
          {canEditDiagnosis ? (
            <button
              type="button"
              className="button"
              onClick={() => {
                setDiagnosisDraft(profile.diagnosis);
                setEditingDiagnosis(true);
              }}
            >
              <Pencil size={16} aria-hidden="true" /> Edit diagnoses
            </button>
          ) : null}
        </div>
      )}

      {/* 4. Medication list */}
      <h3 className="overview-subhead">Medications</h3>
      {stack.medications.length === 0 ? (
        <p className="overview-muted">No medications on this chart.</p>
      ) : (
        <ul className="overview-med-list">
          {stack.medications.map((med) => (
            <li key={med.id}>
              <span className="overview-med-name">{med.name}</span>
              {med.strength ? <span className="overview-med-meta">{med.strength}</span> : null}
              <span className="overview-med-meta">{med.kind === "prn" ? "PRN" : "Scheduled"}</span>
            </li>
          ))}
        </ul>
      )}
      <a className="overview-quiet-link" href="#chart-meds">
        Open medication board
      </a>

      {/* 5. Contacts */}
      <h3 className="overview-subhead">Contacts</h3>

      <p className="overview-group-label">Agency contacts</p>
      {managers.length === 0 && administrators.length === 0 ? (
        <p className="overview-muted">No agency contacts assigned yet.</p>
      ) : (
        <ul className="overview-agency-list">
          {managers.map((member) => (
            <li key={member.id}>
              <span className="overview-contact-name">{member.name}</span>
              <span className="overview-contact-role">{member.role} · {person.site}</span>
            </li>
          ))}
          {administrators.map((member) => (
            <li key={member.id}>
              <span className="overview-contact-name">{member.name}</span>
              <span className="overview-contact-role">Agency administrator</span>
            </li>
          ))}
        </ul>
      )}

      <div className="overview-group-head">
        <p className="overview-group-label">Personal contacts</p>
        {canEditContacts ? (
          <button type="button" className="button" onClick={() => openEditor("guardian", null)}>
            <Plus size={16} aria-hidden="true" /> Add contact
          </button>
        ) : null}
      </div>
      {profile.guardians.length === 0 ? (
        <p className="overview-muted">No personal contacts on file.</p>
      ) : (
        <ul className="overview-contact-cards">
          {profile.guardians.map((contact, index) => (
            <li key={`${contact.name}-${index}`} className="overview-contact-card">
              <div className="overview-contact-head">
                <div>
                  <p className="overview-contact-name">{contact.name}</p>
                  {contact.relationship ? (
                    <p className="overview-contact-role">{contact.relationship}</p>
                  ) : null}
                </div>
                {canEditContacts ? (
                  <button
                    type="button"
                    className="button"
                    aria-label={`Edit ${contact.name}`}
                    onClick={() => openEditor("guardian", index)}
                  >
                    <Pencil size={16} aria-hidden="true" /> Edit
                  </button>
                ) : null}
              </div>
              <ContactLines contact={contact} />
            </li>
          ))}
        </ul>
      )}

      <div className="overview-group-head">
        <p className="overview-group-label">Providers</p>
        {canEditContacts && profile.providerContacts.length > 0 ? (
          <button type="button" className="button" onClick={() => openEditor("provider", null)}>
            <Plus size={16} aria-hidden="true" /> Add provider
          </button>
        ) : null}
      </div>
      {profile.providerContacts.length === 0 ? (
        <Empty
          mark="quiet"
          title="No providers yet"
          text="Providers added by a manager appear here."
          actions={
            canEditContacts ? (
              <button type="button" className="button" onClick={() => openEditor("provider", null)}>
                <Plus size={16} aria-hidden="true" /> Add provider
              </button>
            ) : undefined
          }
        />
      ) : (
        <ul className="overview-contact-cards">
          {profile.providerContacts.map((contact) => (
            <li key={contact.id} className="overview-contact-card">
              <div className="overview-contact-head">
                <div>
                  <p className="overview-contact-name">{contact.name}</p>
                  {contact.role ? <p className="overview-contact-role">{contact.role}</p> : null}
                </div>
                {canEditContacts ? (
                  <button
                    type="button"
                    className="button"
                    aria-label={`Edit ${contact.name}`}
                    onClick={() =>
                      openEditor(
                        "provider",
                        profile.providerContacts.findIndex((row) => row.id === contact.id),
                      )
                    }
                  >
                    <Pencil size={16} aria-hidden="true" /> Edit
                  </button>
                ) : null}
              </div>
              <ContactLines contact={contact} />
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ContactEditor
          kind={editing.kind}
          initial={editorInitial()}
          onSave={saveContact}
          onCancel={() => setEditing(null)}
        />
      ) : null}

      {/* 6. Quiet links — Shift notes stays last.
          Plain hash hrefs would trip the app's hash router (App.tsx treats
          "#<page>" as a page key), so scroll in-page instead. */}
      <nav className="overview-links" aria-label="Chart sections">
        <a href="#chart-appointments" onClick={scrollToChartSection("chart-appointments")}>Appointments</a>
        <span aria-hidden="true">·</span>
        <a href="#chart-meds" onClick={scrollToChartSection("chart-meds")}>Medication board</a>
        <span aria-hidden="true">·</span>
        <a href="#chart-shift-notes" onClick={scrollToChartSection("chart-shift-notes")}>Shift notes</a>
      </nav>
    </section>
  );
}
