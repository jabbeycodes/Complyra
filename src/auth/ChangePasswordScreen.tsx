import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { useData } from "../data/DataProvider";

export default function ChangePasswordScreen() {
  const { session, changePassword, signOut } = useData();
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" />
          <span>
            complyrer<span className="brand-period">.</span>
          </span>
        </div>
        <h1>Choose your own password</h1>
        <p>
          {session?.fullName}, your administrator created a temporary password
          for {session?.agencyCode} / {session?.username}. You must replace it
          before opening the workspace.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (nextPassword !== confirmPassword) {
              setError("The new passwords do not match.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              await changePassword(currentPassword, nextPassword);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="form-label">
            Temporary password
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="form-label">
            New password
            <input
              type="password"
              autoComplete="new-password"
              value={nextPassword}
              onChange={(e) => setNextPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          <label className="form-label">
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" type="submit" disabled={busy}>
            <LockKeyhole size={17} /> {busy ? "Saving…" : "Save new password"}
          </button>
        </form>
        <div className="login-demo">
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}
