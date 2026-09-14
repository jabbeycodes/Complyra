import { useState } from "react";
import { Modal } from "../../components";
import { useData } from "../../data/DataProvider";

/**
 * 13 CSR 65-3.050 second identification component: the mobile-first password
 * sheet. It opens whenever applySignature raises ReauthRequiredError, and on a
 * correct password it calls onVerified so the caller retries the original
 * signing. The password is verified server-side (never trusted from the
 * client), never stored anywhere, and cleared from state on every close.
 *
 * One entry covers five minutes of signing, so a user initialing dozens of
 * training lines is not asked for the password on every line.
 *
 * The same sheet doubles as HIPAA step-up reauthentication for sensitive
 * actions (viewing a complete individual record, exporting data): pass a
 * custom title/description/confirmLabel and the sensitive action proceeds on
 * onVerified.
 */
const DEFAULT_DESCRIPTION =
  "To keep every signature attributable, Missouri rules require a second " +
  "check beyond your signed-in session: enter your account password. One " +
  "entry covers about five minutes of signing.";

export default function ReauthSheet({
  onVerified,
  onClose,
  title = "Confirm it’s you",
  description = DEFAULT_DESCRIPTION,
  confirmLabel = "Confirm and sign",
}: {
  onVerified: () => void;
  onClose: () => void;
  /** Step-up callers may override the copy; defaults keep signature wording. */
  title?: string;
  description?: string;
  confirmLabel?: string;
}) {
  const { api } = useData();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function verify() {
    if (busy || !password) return;
    setBusy(true);
    setError("");
    try {
      await api.verifySigningPassword(password);
      setPassword(""); // never retain the password past verification
      onVerified();
    } catch (err) {
      setPassword(""); // never retain a failed attempt either
      setError(
        err instanceof Error
          ? err.message
          : "Password confirmation failed. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <div className="reauth-body">
        <p className="muted">{description}</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <label className="reauth-label" htmlFor="reauth-password">
            Account password
          </label>
          <input
            id="reauth-password"
            type="password"
            className="reauth-input"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
          />
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <button
              type="button"
              className="button reauth-button"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="button primary reauth-button"
              disabled={busy || !password}
            >
              {busy ? "Confirming…" : confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
