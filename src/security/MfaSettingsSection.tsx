import { useEffect, useState } from "react";
import { useData } from "../data/DataProvider";
import type { TotpEnrollment } from "../data/types";
import { getMfaRequirement } from "./mfaPolicy";

const HOSTED_ONLY_MESSAGE = "MFA is only available in the hosted workspace.";

/**
 * Settings → Security: Supabase Auth TOTP enrollment and verification.
 * Shows the QR code, the manual setup key, and the 6-digit verification
 * code field. Enrolled factors can be removed here. The secret is shown
 * once during enrollment and never stored.
 */
export default function MfaSettingsSection({
  onChanged,
  onUnavailable,
}: {
  /** Called after enrollment/removal so a parent gate can refresh. */
  onChanged?: () => void;
  /** Called when enrollment is impossible (local preview, no Auth MFA). */
  onUnavailable?: () => void;
}) {
  const { api, session } = useData();
  const [loading, setLoading] = useState(true);
  const [enrolled, setEnrolled] = useState(false);
  const [assurance, setAssurance] = useState("");
  const [factors, setFactors] = useState<
    Array<{ id: string; friendlyName: string }>
  >([]);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const state = await api.getMfaState();
      setEnrolled(state.enrolled);
      setAssurance(state.assurance);
      setFactors(
        state.factors.map((f) => ({ id: f.id, friendlyName: f.friendlyName })),
      );
      setUnavailable(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not check MFA status.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnrollment() {
    setBusy(true);
    setError("");
    try {
      const result = await api.enrollTotpFactor("Authenticator app");
      setEnrollment(result);
      setCode("");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not start setup.";
      if (message === HOSTED_ONLY_MESSAGE) {
        setUnavailable(true);
        onUnavailable?.();
      }
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmEnrollment() {
    if (!enrollment || code.replace(/\s+/g, "").length < 6) return;
    setBusy(true);
    setError("");
    try {
      await api.verifyTotpEnrollment(enrollment.factorId, code);
      setEnrollment(null);
      setCode("");
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "That code didn't match. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeFactor(factorId: string) {
    if (!window.confirm("Remove this authenticator? You'll sign in with your password only.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.unenrollMfaFactor(factorId);
      await refresh();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove that authenticator.");
    } finally {
      setBusy(false);
    }
  }

  const requirement = getMfaRequirement(session);

  if (loading) {
    return <p className="muted">Checking two-factor status…</p>;
  }

  return (
    <div className="mfa-settings">
      <div className="settings-row">
        <div>
          <h4 className="settings-row-title">Two-factor authentication</h4>
          <p className="muted">
            Status:{" "}
            <strong>{enrolled ? "On" : "Off"}</strong>
            {assurance === "aal2" && " (verified this session)"}
            {requirement === "required" && (
              <> — required for your role</>
            )}
          </p>
        </div>
      </div>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {enrolled && factors.length > 0 && (
        <ul className="mfa-factor-list">
          {factors.map((f) => (
            <li key={f.id} className="mfa-factor">
              <span>{f.friendlyName}</span>
              <button
                type="button"
                className="button danger"
                disabled={busy}
                onClick={() => void removeFactor(f.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!enrolled && !enrollment && !unavailable && (
        <button
          type="button"
          className="button primary"
          disabled={busy}
          onClick={() => void startEnrollment()}
        >
          {busy ? "Starting…" : "Set up authenticator app"}
        </button>
      )}

      {enrollment && (
        <div className="mfa-enroll">
          <p className="muted">
            Scan this QR code with your authenticator app (Google Authenticator,
            1Password, Authy), or enter the setup key manually. Then enter the
            6-digit code it shows.
          </p>
          <img
            src={enrollment.qrCode}
            alt="QR code for authenticator app setup"
            className="mfa-qr"
            width={200}
            height={200}
          />
          <p className="muted">
            Manual setup key:{" "}
            <code className="mfa-secret">{enrollment.secret}</code>
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void confirmEnrollment();
            }}
          >
            <label className="reauth-label" htmlFor="mfa-code">
              6-digit code
            </label>
            <input
              id="mfa-code"
              className="reauth-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  setEnrollment(null);
                  setCode("");
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="button primary"
                disabled={busy || code.replace(/\s+/g, "").length < 6}
              >
                {busy ? "Verifying…" : "Verify and turn on"}
              </button>
            </div>
          </form>
        </div>
      )}

      {unavailable && (
        <p className="muted">
          Two-factor authentication is available in the hosted workspace.
        </p>
      )}
    </div>
  );
}
