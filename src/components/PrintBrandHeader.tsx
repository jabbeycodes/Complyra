/**
 * Brand header for the in-app window.print() statements (House Card and
 * Personal Spending monthly statements, performance/corrective-action
 * printouts): the agency logo when one is set, the agency name always, and
 * "Prepared with Complyrer" — the on-screen twin of the PDF pattern in
 * src/pdf/brandHeader.ts (startBrandedDoc). Sits beside ComplyrerRecordMark,
 * which provides the matching footer line on generated documents.
 */
export default function PrintBrandHeader({
  agencyName,
  logoDataUrl,
}: {
  agencyName: string;
  /** Agency logo (data URL) when one is set; omitted headers keep the name alone. */
  logoDataUrl?: string | null;
}) {
  return (
    <div className="print-brand-header">
      {logoDataUrl ? (
        <img className="print-brand-logo" src={logoDataUrl} alt="" />
      ) : null}
      <div className="print-brand-names">
        <p className="print-brand-agency">{agencyName}</p>
        <p className="print-brand-prepared">Prepared with Complyrer</p>
      </div>
    </div>
  );
}
