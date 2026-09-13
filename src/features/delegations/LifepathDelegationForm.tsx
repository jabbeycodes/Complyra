import {
  DELEGATION_NON_TRANSFERABILITY_CLAUSE,
  DELEGATION_RN_RESPONSIBILITY_CLAUSE,
  type DelegationForm,
} from "../../data/types";
import { formatDate } from "../../components";

/**
 * Pixel-faithful digital replica of the paper
 * "LifePath RN Delegation of Specified Nursing Task Form" (extraction B4).
 * Same field order, same section headings, verbatim clauses, 12-row roster.
 * Read-only — editing and signing live in DelegationFormDetail.
 */
export default function LifepathDelegationForm({
  individualName,
  dmhId,
  location,
  taskTitle,
  form,
  rnSignatureLine,
}: {
  individualName: string;
  dmhId: string;
  location: string;
  taskTitle: string;
  form: DelegationForm;
  /** Rendered RN signature line from the chart record (typed name + date). */
  rnSignatureLine: string | null;
}) {
  return (
    <div className="delegation-paper">
      <header className="delegation-paper-head">
        <h3>LifePath RN Delegation of Specified Nursing Task Form</h3>
        <p className="delegation-paper-sub">LifePath of Mid-Missouri</p>
      </header>

      <div className="delegation-grid3">
        <Field label="Individual's Name" value={individualName} />
        <Field label="DMH ID Number" value={dmhId} />
        <Field label="Individual's Location" value={location} />
      </div>

      <Section title="Delegated Task">
        <p className="delegation-value">{taskTitle || "—"}</p>
      </Section>

      <Section title="Purpose of Task">
        <p className="delegation-value">{form.purpose || "—"}</p>
      </Section>

      <p className="delegation-clause">{DELEGATION_NON_TRANSFERABILITY_CLAUSE}</p>

      <Section title="Employees delegated this task">
        <table className="delegation-table">
          <thead>
            <tr>
              <th>Print name / title</th>
              <th>Staff signature</th>
              <th>Rescinded date</th>
              <th>Initials</th>
            </tr>
          </thead>
          <tbody>
            {form.roster.map((row, i) => (
              <tr key={i}>
                <td>
                  {row.printName || <span className="delegation-blank">&nbsp;</span>}
                  {row.title ? ` — ${row.title}` : ""}
                </td>
                <td>{row.signatureName || ""}</td>
                <td>{row.rescindedDate ? formatDate(row.rescindedDate) : ""}</td>
                <td>{row.initials || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <p className="delegation-clause">{DELEGATION_RN_RESPONSIBILITY_CLAUSE}</p>

      <Section title="Task Rescinded">
        <div className="delegation-checks">
          <label>
            <input type="checkbox" readOnly checked={form.rescindReason === "health_status_change"} />{" "}
            Change in Health Status
          </label>
          <label>
            <input type="checkbox" readOnly checked={form.rescindReason === "other"} /> Other
            (Please explain below)
          </label>
        </div>
        {form.rescindExplanation && <p className="delegation-value">{form.rescindExplanation}</p>}
      </Section>

      <Section title="Delegating RN">
        <div className="delegation-grid3">
          <Field label="Delegating RN" value={form.delegatingRn.name} />
          <Field label="Signature" value={rnSignatureLine ?? form.delegatingRn.signatureName ?? ""} />
          <Field label="Date Signed" value={form.delegatingRn.dateSigned ? formatDate(form.delegatingRn.dateSigned) : ""} />
        </div>
      </Section>

      <Section title="Specialized Instruction for Delegation">
        <table className="delegation-table two-col">
          <thead>
            <tr>
              <th>PROCEDURES / Steps to follow to perform the task</th>
              <th>What to OBSERVE for and REPORT, what to DO and WHOM to CONTACT</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="delegation-pre">{form.procedures || "—"}</td>
              <td className="delegation-pre">{form.observeReportDo || "—"}</td>
            </tr>
          </tbody>
        </table>
        <p className="delegation-note">*Attach any additional instructional documentation</p>
      </Section>

      <Section title="Instructional Licensed Medical Professional">
        <div className="delegation-grid4">
          <Field label="Printed name" value={form.instructingProfessional.name} />
          <Field label="Signature and Title" value={form.instructingProfessional.title} />
          <Field label="Date" value={form.instructingProfessional.signedAt ? formatDate(form.instructingProfessional.signedAt) : ""} />
          <Field label="Contact Number" value={form.instructingProfessional.contactNumber} />
        </div>
      </Section>

      <Section title="Delegating RN (if different than Instructing Medical Professional)">
        <div className="delegation-grid3">
          <Field label="Signature and Title" value={form.delegatingRn.signatureName ?? ""} />
          <Field label="Date" value={form.delegatingRn.dateSigned ? formatDate(form.delegatingRn.dateSigned) : ""} />
          <Field label="Contact Number" value={form.delegatingRn.contactNumber} />
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="delegation-section">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="delegation-field">
      <span className="delegation-label">{label}</span>
      <span className="delegation-value">{value || "—"}</span>
    </div>
  );
}
