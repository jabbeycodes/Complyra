import { useState } from "react";
import { complyrerLockupSvgDataUrl } from "../brand/complyrerLockup";

/**
 * Brand header for the in-app window.print() statements (House Card and
 * Personal Spending monthly statements, performance/corrective-action
 * printouts): the agency logo when one is set, the agency name always,
 * "Prepared with Complyrer", and the ComplyRer logo lockup at the right —
 * the on-screen twin of the PDF pattern in src/pdf/brandHeader.ts
 * (startBrandedDoc). Sits beside ComplyrerRecordMark, which provides the
 * matching footer line on generated documents. If the lockup asset cannot
 * load, the brand falls back to the typed wordmark.
 */
export default function PrintBrandHeader({
  agencyName,
  logoDataUrl,
}: {
  agencyName: string;
  /** Agency logo (data URL) when one is set; omitted headers keep the name alone. */
  logoDataUrl?: string | null;
}) {
  const [lockupFailed, setLockupFailed] = useState(false);
  return (
    <div className="print-brand-header">
      {logoDataUrl ? (
        <img className="print-brand-logo" src={logoDataUrl} alt="" />
      ) : null}
      <div className="print-brand-names">
        <p className="print-brand-agency">{agencyName}</p>
        <p className="print-brand-prepared">Prepared with Complyrer</p>
      </div>
      {lockupFailed ? (
        <p className="print-brand-complyrer">ComplyRer</p>
      ) : (
        <img
          className="print-brand-lockup"
          src={complyrerLockupSvgDataUrl()}
          alt="ComplyRer"
          onError={() => setLockupFailed(true)}
        />
      )}
    </div>
  );
}
