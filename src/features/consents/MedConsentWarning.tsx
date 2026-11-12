/**
 * MedConsentWarning — the loud, non-blocking medication-consent
 * banner (founder decision 2026-11-11). Renders only when the
 * Individual's medication administration consent is expired,
 * missing, or revoked (medConsentWarningText); it never disables
 * or gates a medication action. The load state is part of the
 * contract: an unloaded register renders nothing rather than a
 * verdict, exactly like the shared consent-status selector.
 */
import { TriangleAlert } from "lucide-react";
import {
  consentStatusFor,
  medConsentWarningText,
  type ConsentRegister,
} from "../../data/consents";
import { useData } from "../../data/DataProvider";
import { useConsentRegister } from "./useConsentRegister";

export function MedConsentWarning({
  register,
  individualId,
  roleKey,
}: {
  register: ConsentRegister | null | undefined;
  individualId: string;
  roleKey: string;
}) {
  const text = medConsentWarningText(
    consentStatusFor(register, individualId, "medication"),
    roleKey,
  );
  if (!text) return null;
  return (
    <p className="med-consent-warning" role="alert">
      <TriangleAlert size={16} aria-hidden="true" />
      <span>
        <strong>Medication consent:</strong> {text}
      </span>
    </p>
  );
}

/**
 * The DataProvider-backed form for surfaces that do not already
 * hold the consent register (the chart, the chart MAR card): loads
 * the register through the shared hook and renders nothing while
 * it loads, fails, or the viewer's role cannot see consents.
 */
export default function MedConsentWarningGate({
  individualId,
}: {
  individualId: string;
}) {
  const { session } = useData();
  const state = useConsentRegister();
  if (state.kind !== "ready" || !session) return null;
  return (
    <MedConsentWarning
      register={state.register}
      individualId={individualId}
      roleKey={session.roleKey}
    />
  );
}
