import { useEffect, useState } from "react";
import { useData } from "../../data/DataProvider";
import type { SignatureSettings } from "../../data/types";

/**
 * Agency settings row (Settings page): which adoption methods staff may use.
 * Admin-only — both the UI and the API gate on the administrator role.
 */
export default function SignatureSettingsSection({
  onSaved,
}: {
  onSaved: (message: string) => void;
}) {
  const { api, session } = useData();
  const [settings, setSettings] = useState<SignatureSettings | null>(null);
  const [draft, setDraft] = useState<SignatureSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.getSignatureSettings();
        if (!cancelled) setSettings(loaded);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!session) return null;
  const canEdit = session.roleKey === "administrator";
  const current = draft ?? settings;

  async function save() {
    if (!current) return;
    setError("");
    setBusy(true);
    try {
      const saved = await api.updateSignatureSettings(current);
      setSettings(saved);
      setDraft(null);
      onSaved("Signature adoption methods saved for this agency.");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-row signature-settings">
      <span>
        <strong>Electronic signature methods</strong>
        <small>
          Which ways staff may adopt their signature and initials: drawing on a
          touchscreen, typing their name in a signature style, or uploading an
          image. At least one method must stay on.
        </small>
      </span>
      <div className="signature-settings-controls">
        {error && <p className="form-error">{error}</p>}
        {!current ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            {(
              [
                ["allowDraw", "Draw"],
                ["allowType", "Type"],
                ["allowUpload", "Upload"],
              ] as Array<[keyof SignatureSettings, string]>
            ).map(([key, label]) => (
              <label key={key} className="sig-toggle">
                <input
                  type="checkbox"
                  checked={current[key]}
                  disabled={!canEdit || busy}
                  onChange={() =>
                    setDraft({ ...current, [key]: !current[key] })
                  }
                />
                {label}
              </label>
            ))}
            {canEdit ? (
              <button
                type="button"
                className="button"
                disabled={busy || !draft || Object.values(draft).every((v) => !v)}
                onClick={() => void save()}
              >
                {busy ? "Saving…" : "Save methods"}
              </button>
            ) : (
              <p className="muted">Only an administrator can change this.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
