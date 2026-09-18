/**
 * Issue #100 — Medication profile header (DMH 9 CSR 10-7.070): allergies,
 * diagnosis, weight, and prescribing physicians, visible before the
 * medication list on the Individual chart's Medications tab.
 */
import type { MedicationMarView } from "../../data/mar";
import type { IndividualProfile } from "../../data/planStack";

export default function MedProfileHeader({
  profile,
  meds,
  weightKg,
}: {
  profile: IndividualProfile;
  meds: MedicationMarView[];
  /** No weight data source exists in the record yet; blank until one does. */
  weightKg: string;
}) {
  const prescribers = [...new Set(meds.map((med) => med.mar.prescriber.trim()).filter(Boolean))];
  const allergyText =
    profile.allergies.length === 0
      ? "None on record"
      : profile.allergies
          .map((allergy) => `${allergy.allergen}${allergy.reaction ? ` (${allergy.reaction})` : ""}`)
          .join("; ");
  return (
    <section className="mar-block" aria-label="Medication profile">
      <h3>Medication profile</h3>
      <dl className="mar-profile-grid">
        <div className="mar-profile-field">
          <dt>Allergies</dt>
          <dd>{allergyText}</dd>
        </div>
        <div className="mar-profile-field">
          <dt>Diagnosis</dt>
          <dd>{profile.diagnosis.trim() || "Not recorded"}</dd>
        </div>
        <div className="mar-profile-field">
          <dt>Weight</dt>
          <dd>{weightKg.trim() || "Not recorded"}</dd>
        </div>
        <div className="mar-profile-field">
          <dt>Prescribing physician(s)</dt>
          <dd>{prescribers.length > 0 ? prescribers.join("; ") : "Not recorded"}</dd>
        </div>
      </dl>
    </section>
  );
}
