import { useCallback, useEffect, useState } from "react";
import { useData } from "../data/DataProvider";
import type { MfaAssurance, MfaFactor, SessionUser } from "../data/types";
import { isMfaRequired } from "./mfaPolicy";
import MfaSettingsSection from "./MfaSettingsSection";

/**
 * HIPAA §164.312(d): platform operators, administrators, and compliance
 * administrators must enroll MFA and complete a per-session TOTP
 * verification (AAL2) before using the workspace.
 *
 * This gate renders INSTEAD of the workspace — never inside LoginScreen —
 * so the login screen on the demo/interactive-tour branch stays untouched.
 * Integration: in App, wrap the authenticated workspace:
 *
 *   <MfaGate session={session}>
 *     <InactivityGuard onSignOut={signOut}>…workspace…</InactivityGuard>
 *   </MfaGate>
 *
 * Enrollment alone is not enough: a returning user at AAL1 must enter a
 * fresh 6-digit authenticator code (verifyTotpForSession) before the
 * workspace renders. In the local preview (no Auth MFA available) the
 * section reports the limitation and the gate lets the user continue; the
 * hosted workspace never offers that escape hatch.
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
  const [assurance, setAssurance] = useState<MfaAssurance>("aal1");
  const [factors, setFactors] = useState<MfaFactor[]>([]);
  const [unavailable, setUnavailable] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const state = await api.getMfaState();
      setEnrolled(state.enrolled);
      setAssurance(state.assurance);
      setFactors(state.factors);
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
  if (!required || unavailable) {
    return <>{children}</>;
  }
  if (enrolled === null) {
    return <p className="muted page-loading">Checking security requirements…</p>;
  }
  // AAL2 reached (enrollment verification or a fresh challenge) — open up.
  if (enrolled && assurance === "aal2") {
    return <>{children}</>;
  }
  // Enrolled but this session is still AAL1: force a TOTP challenge.
  if (enrolled && factors.length > 0) {
    return (
      <div className="mfa-gate">
        <div className="mfa-gate-card">
          <h2>Verify it&rsquo;s you</h2>
          <p className="muted">
            Your role requires two-factor authentication. Enter the 6-digit
            code from your authenticator app to continue this session.
          </p>
          <MfaChallenge
            factors={factors}
            onVerified={() => void refresh()}
          />
        </div>
      </div>
    );
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

/** Per-session AAL2 step-up: challenge one enrolled TOTP factor. */
function MfaChallenge({
  factors,
  onVerified,
}: {
  factors: MfaFactor[];
  onVerified: () => void;
}) {
  const { api } = useData();
  const [factorId, setFactorId] = useState(factors[0]?.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify() {
    if (busy || !factorId || code.replace(/\s+/g, "").length < 6) return;
    setBusy(true);
    setError("");
    try {
      await api.verifyTotpForSession(factorId, code);
      setCode("");
      onVerified();
    } catch (err) {
      setCode("");
      setError(
        err instanceof Error
          ? err.message
          : "That code didn't match. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void verify();
      }}
    >
      {factors.length > 1 && (
        <>
          <label className="reauth-label" htmlFor="mfa-challenge-factor">
            Authenticator
          </label>
          <select
            id="mfa-challenge-factor"
            className="reauth-input"
            value={factorId}
            onChange={(e) => setFactorId(e.target.value)}
            disabled={busy}
          >
            {factors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.friendlyName}
              </option>
            ))}
          </select>
        </>
      )}
      <label className="reauth-label" htmlFor="mfa-challenge-code">
        6-digit code
      </label>
      <input
        id="mfa-challenge-code"
        className="reauth-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={8}
        autoFocus
        value={code}
        onChange={(e) => setCode(e.target.value)}
        disabled={busy}
      />
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button
          type="submit"
          className="button primary reauth-button"
          disabled={busy || code.replace(/\s+/g, "").length < 6}
        >
          {busy ? "Verifying…" : "Verify and continue"}
        </button>
      </div>
    </form>
  );
}
