import { useState } from "react";
import { useData } from "../data/DataProvider";
import type { AppRole, InviteMemberResult } from "../data/types";
import { USERNAME_PATTERN, normalizeUsername } from "../data/types";

const ROLES: { value: AppRole; label: string }[] = [
  { value: "dsp", label: "DSP" },
  { value: "manager", label: "House manager" },
  { value: "compliance_admin", label: "Compliance administrator" },
  { value: "administrator", label: "Agency administrator" },
];

export default function InviteMemberForm({
  onCreated,
}: {
  onCreated?: (result: InviteMemberResult, tempPassword: string) => void;
}) {
  const { api, workspace, refresh } = useData();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [role, setRole] = useState<AppRole>("dsp");
  const [jobTitle, setJobTitle] = useState("DSP");
  const [siteId, setSiteId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<
    (InviteMemberResult & { tempPassword: string }) | null
  >(null);

  if (created) {
    return (
      <div className="invite-success">
        <p>
          Give these credentials to {created.fullName} once. They will sign in
          and must change the temporary password immediately.
        </p>
        <dl className="ack-meta">
          <div>
            <dt>Agency code</dt>
            <dd>
              <strong>{created.agencyCode}</strong>
            </dd>
          </div>
          <div>
            <dt>Username</dt>
            <dd>
              <strong>{created.username}</strong>
            </dd>
          </div>
          <div>
            <dt>Temporary password</dt>
            <dd>
              <strong>{created.tempPassword}</strong>
            </dd>
          </div>
        </dl>
      </div>
    );
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const nextUsername = normalizeUsername(username);
        if (!USERNAME_PATTERN.test(nextUsername)) {
          setError("Username must be 3–40 characters: letters, numbers, or dots.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          const result = await api.inviteMember({
            fullName,
            username: nextUsername,
            tempPassword,
            role,
            jobTitle,
            siteId: siteId || null,
          });
          await refresh();
          const payload = { ...result, tempPassword };
          setCreated(payload);
          onCreated?.(result, tempPassword);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="form-help">
        Create a username and temporary password. The staff member uses your
        agency code to sign in, then chooses their own password.
      </p>
      <label className="form-label">
        Full name
        <input
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            if (!username) {
              setUsername(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, ".")
                  .replace(/^\.+|\.+$/g, ""),
              );
            }
          }}
          required
        />
      </label>
      <label className="form-label">
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          required
        />
      </label>
      <label className="form-label">
        Temporary password
        <input
          type="text"
          autoComplete="off"
          value={tempPassword}
          onChange={(e) => setTempPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      <label className="form-label">
        Role
        <select value={role} onChange={(e) => setRole(e.target.value as AppRole)}>
          {ROLES.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <label className="form-label">
        Job title
        <input value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} />
      </label>
      <label className="form-label">
        Home site
        <select value={siteId} onChange={(e) => setSiteId(e.target.value)}>
          <option value="">Agency-wide</option>
          {workspace?.sites.map((site) => (
            <option key={site.id} value={site.id}>
              {site.name}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" type="submit" disabled={busy}>
        {busy ? "Creating account…" : "Create member account"}
      </button>
    </form>
  );
}
