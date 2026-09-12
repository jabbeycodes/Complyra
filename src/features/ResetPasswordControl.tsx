import { useState } from "react";
import { useData } from "../data/DataProvider";

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
      <p className="form-help">
        Temporary password for {name}: <strong>{tempPassword}</strong>
      </p>
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
