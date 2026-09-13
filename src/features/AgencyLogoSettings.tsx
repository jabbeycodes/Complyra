import { useRef, useState } from "react";
import { canManageAgencyLogo, LOGO_ACCEPT } from "../data/branding";
import { useData } from "../data/DataProvider";

export default function AgencyLogoSettings({
  onSaved,
}: {
  onSaved: (message: string) => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  if (!session || !workspace) return null;

  const canEdit = canManageAgencyLogo(session.roleKey);
  const logoUrl = workspace.branding.logoUrl;

  async function run(action: () => Promise<void>, message: string) {
    setError("");
    try {
      await action();
      await refresh();
      onSaved(message);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="settings-row agency-logo-settings">
      <span>
        <strong>Agency logo</strong>
        <small>
          Used in the sidebar and on every signed sheet and downloaded
          report. PNG or JPEG, under 1.5 MB.
        </small>
      </span>
      <div className="agency-logo-actions">
        <span className="agency-logo-preview" aria-hidden={!logoUrl}>
          {logoUrl ? (
            <img src={logoUrl} alt={`${session.agencyName} logo`} />
          ) : (
            <em>No logo yet</em>
          )}
        </span>
        {canEdit && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={LOGO_ACCEPT.join(",")}
              aria-label="Upload agency logo"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) {
                  void run(() => api.uploadAgencyLogo(file), "Agency logo saved.");
                }
              }}
            />
            <button className="button" onClick={() => inputRef.current?.click()}>
              {logoUrl ? "Replace logo" : "Upload logo"}
            </button>
            {logoUrl && (
              <button
                className="button"
                onClick={() => run(() => api.removeAgencyLogo(), "Agency logo removed.")}
              >
                Remove
              </button>
            )}
          </>
        )}
        {error && <p className="form-error">{error}</p>}
      </div>
    </div>
  );
}

export function AgencyMark({
  name,
  logoUrl,
  size = 34,
}: {
  name: string;
  logoUrl?: string | null;
  size?: number;
}) {
  if (logoUrl) {
    return (
      <span className="agency-mark has-logo" style={{ width: size, height: size }}>
        <img src={logoUrl} alt="" />
      </span>
    );
  }
  return (
    <span className="agency-mark" style={{ width: size, height: size }} aria-hidden="true">
      {name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)}
    </span>
  );
}
