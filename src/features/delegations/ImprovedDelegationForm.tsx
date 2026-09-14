import {
  DELEGATION_COMPETENCY_ITEMS,
  DELEGATION_NON_TRANSFERABILITY_CLAUSE,
  DELEGATION_RN_RESPONSIBILITY_CLAUSE,
  delegationReviewState,
  type DelegationForm,
} from "../../data/types";
import { formatDate } from "../../components";

/**
 * Complyrer's own rendering of the delegation record: explicit review/expiry
 * date, a structured inspection cadence, a competency checklist per roster
 * row, and a review reminder banner. Same content as the delegation the RN
 * signed — Complyrer's wording and layout throughout.
 */
export default function ImprovedDelegationForm({
  individualName,
  location,
  taskTitle,
  form,
  rnSignatureLine,
}: {
  individualName: string;
  location: string;
  taskTitle: string;
  form: DelegationForm;
  rnSignatureLine: string | null;
}) {
  const review = delegationReviewState(form);
  return (
    <div className="delegation-paper improved">
      <header className="delegation-paper-head">
        <h3>Delegation of Specified Nursing Task</h3>
        <p className="delegation-paper-sub">
          Complyrer version · {individualName}
        </p>
      </header>

      {review ? (
        <div className={`delegation-review-banner ${review.overdue ? "overdue" : "ok"}`}>
          <strong>{review.label}</strong>
          {form.inspectionCadence && <span> · Inspections: {form.inspectionCadence}</span>}
        </div>
      ) : (
        <div className="delegation-review-banner missing">
          <strong>No review date set.</strong> Set one so this delegation gets
          automatic renewal reminders.
        </div>
      )}

      <div className="delegation-grid2">
        <div className="delegation-field">
          <span className="delegation-label">Delegated task</span>
          <span className="delegation-value">{taskTitle || "—"}</span>
        </div>
        <div className="delegation-field">
          <span className="delegation-label">Individual · Location</span>
          <span className="delegation-value">
            {individualName} · {location || "—"}
          </span>
        </div>
      </div>

      <section className="delegation-section">
        <h4>Purpose</h4>
        <p className="delegation-value">{form.purpose || "—"}</p>
      </section>

      <section className="delegation-section">
        <h4>Delegation terms</h4>
        <p className="delegation-clause">{DELEGATION_NON_TRANSFERABILITY_CLAUSE}</p>
        <p className="delegation-clause">{DELEGATION_RN_RESPONSIBILITY_CLAUSE}</p>
      </section>

      <section className="delegation-section">
        <h4>Instructions</h4>
        <div className="delegation-grid2">
          <div>
            <span className="delegation-label">Procedures / steps</span>
            <p className="delegation-pre">{form.procedures || "—"}</p>
          </div>
          <div>
            <span className="delegation-label">Observe · report · do · contact</span>
            <p className="delegation-pre">{form.observeReportDo || "—"}</p>
          </div>
        </div>
      </section>

      <section className="delegation-section">
        <h4>Delegated staff &amp; competency</h4>
        <table className="delegation-table">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Competency verified</th>
              <th>Signed</th>
              <th>Rescinded</th>
            </tr>
          </thead>
          <tbody>
            {form.roster
              .map((row, i) => ({ row, i }))
              .filter(({ row }) => row.printName.trim())
              .map(({ row, i }) => (
                <tr key={i}>
                  <td>
                    {row.printName}
                    {row.title ? ` — ${row.title}` : ""}
                  </td>
                  <td>
                    {row.competency.length > 0 ? (
                      <ul className="delegation-competency">
                        {row.competency.map((c) => (
                          <li key={c}>✓ {c}</li>
                        ))}
                      </ul>
                    ) : (
                      <span className="delegation-warn">Not recorded</span>
                    )}
                  </td>
                  <td>
                    {row.signedAt ? (
                      <>
                        {row.signatureName} · {row.initials}
                        <br />
                        <span className="delegation-small">{formatDate(row.signedAt)}</span>
                      </>
                    ) : (
                      <span className="delegation-warn">Pending</span>
                    )}
                  </td>
                  <td>{row.rescindedDate ? formatDate(row.rescindedDate) : "—"}</td>
                </tr>
              ))}
          </tbody>
        </table>
        <p className="delegation-note">
          Competency items: {DELEGATION_COMPETENCY_ITEMS.join(" · ")}
        </p>
      </section>

      <section className="delegation-section">
        <h4>Accountability</h4>
        <div className="delegation-grid2">
          <div className="delegation-field">
            <span className="delegation-label">Delegating RN</span>
            <span className="delegation-value">{form.delegatingRn.name || "—"}</span>
            <span className="delegation-small">
              Signed: {rnSignatureLine ?? "—"}
              {form.delegatingRn.contactNumber ? ` · ${form.delegatingRn.contactNumber}` : ""}
            </span>
          </div>
          <div className="delegation-field">
            <span className="delegation-label">Instructing licensed professional</span>
            <span className="delegation-value">{form.instructingProfessional.name || "—"}</span>
            <span className="delegation-small">
              {form.instructingProfessional.title}
              {form.instructingProfessional.contactNumber
                ? ` · ${form.instructingProfessional.contactNumber}`
                : ""}
            </span>
          </div>
        </div>
      </section>
    </div>
  );
}
