import { useState } from "react";
import { ComplyRerWordmark } from "../brand/ComplyrerBrand";
import { LockKeyhole } from "lucide-react";
import { useData } from "../data/DataProvider";
import PasswordField from "../components/PasswordField";

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
          <ComplyRerWordmark size={36} />
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
          <PasswordField
            label="Temporary password"
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            required
          />
          <PasswordField
            label="New password"
            value={nextPassword}
            onChange={setNextPassword}
            autoComplete="new-password"
            minLength={8}
            required
          />
          <PasswordField
            label="Confirm new password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={8}
            required
          />
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
