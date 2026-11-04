import { useState } from "react";
import { useData } from "../data/DataProvider";
import OneTimeSecret from "../components/OneTimeSecret";

/**
 * The post-reset handover notice. The generated temporary password
 * renders only through OneTimeSecret (masked by default, explicit
 * Show/Copy); "Done" removes it from the staff table entirely —
 * previously it sat in plain text in the row with no way to clear it.
 */
export function ResetTempPasswordNotice({
  name,
  tempPassword,
  onDone,
}: {
  name: string;
  tempPassword: string;
  onDone: () => void;
}) {
  return (
    <p className="form-help">
      Temporary password for {name}:{" "}
      <OneTimeSecret value={tempPassword} onDone={onDone} />
    </p>
  );
}

export default function ResetPasswordControl({
  userId,
  name,
  onReset,
}: {
  userId: string;
  name: string;
  onReset: (message: string) => void;
}) {
  const { api, session } = useData();
  const [busy, setBusy] = useState(false);
  const [tempPassword, setTempPassword] = useState("");
  const [error, setError] = useState("");

  if (session?.userId === userId) return null;

  if (tempPassword) {
    return (
      <ResetTempPasswordNotice
        name={name}
        tempPassword={tempPassword}
        onDone={() => setTempPassword("")}
      />
    );
  }

  return (
    <div>
      <button
        className="text-button"
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await api.resetMemberPassword(userId);
            setTempPassword(result.tempPassword);
            onReset(`Temporary password issued for ${name}. Share it once.`);
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Resetting…" : "Reset password"}
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
