import { useCallback, useEffect, useState } from "react";
import { useData } from "../data/DataProvider";
import type { SessionUser } from "../data/types";
import { isMfaRequired } from "./mfaPolicy";
import MfaSettingsSection from "./MfaSettingsSection";

/**
 * HIPAA §164.312(d): platform operators, administrators, and compliance
 * administrators must enroll MFA before using the workspace.
 *
 * This gate renders INSTEAD of the workspace — never inside LoginScreen —
 * so the login screen on the demo/interactive-tour branch stays untouched.
 * Integration: in App, wrap the authenticated workspace:
 *
 *   <MfaGate session={session}>
 *     <InactivityGuard onSignOut={signOut}>…workspace…</InactivityGuard>
 *   </MfaGate>
 *
 * In the local preview (no Auth MFA available) the section reports the
 * limitation and the gate lets the user continue; the hosted workspace
 * never offers that escape hatch.
 */
export default function MfaGate({
  session,
  children,
}: {
  session: SessionUser;
  children: React.ReactNode;
}) {
  const { api } = useData();
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await api.getMfaState();
      setEnrolled(state.enrolled);
    } catch {
      setEnrolled(false);
    }
  }, [api]);

  useEffect(() => {
    if (isMfaRequired(session)) void refresh();
    else setEnrolled(true);
  }, [api, refresh, session]);

  const required = isMfaRequired(session);
  // Local preview has no Auth MFA: once the section reports it, continue.
  if (!required || enrolled || unavailable) {
    return <>{children}</>;
  }
  if (enrolled === null) {
    return <p className="muted page-loading">Checking security requirements…</p>;
  }

  return (
    <div className="mfa-gate">
      <div className="mfa-gate-card">
        <h2>Two-factor authentication required</h2>
        <p className="muted">
          Your role requires two-factor authentication before you can use the
          workspace. Set up an authenticator app once — it takes about a
          minute.
        </p>
        <MfaSettingsSection onChanged={refresh} onUnavailable={() => setUnavailable(true)} />
      </div>
    </div>
  );
}
