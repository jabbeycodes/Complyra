import { useState } from "react";
import { useData } from "../data/DataProvider";
import { ROLE_TEMPLATES, type RoleKey } from "../data/permissions";
import type { InviteMemberResult } from "../data/types";
import { USERNAME_PATTERN, normalizeUsername } from "../data/types";

export default function InviteMemberForm({
  onCreated,
}: {
  onCreated?: (result: InviteMemberResult, tempPassword: string) => void;
}) {
  const { api, workspace, refresh } = useData();
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [tempPassword, setTempPassword] = useState("");
  const [roleKey, setRoleKey] = useState<RoleKey>("dsp");
  const [jobTitle, setJobTitle] = useState("Direct support professional");
  const [siteId, setSiteId] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<
    (InviteMemberResult & { tempPassword: string }) | null
  >(null);

  const template = ROLE_TEMPLATES.find((row) => row.key === roleKey)!;

  if (created) {
    return (
      <div className="invite-success">
        <p>
          Give these credentials to {created.fullName} once. They will sign in
          and must change the temporary password immediately.
        </p>
        <dl className="ack-meta">
          <div>
            <dt>Provider code</dt>
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
        if (roleKey === "auditor" && !expiresOn) {
          setError("Auditors need an access end date.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          const result = await api.inviteMember({
            fullName,
            username: nextUsername,
            tempPassword,
            roleKey,
            jobTitle,
            siteId: siteId || null,
            expiresOn: roleKey === "auditor" ? expiresOn : null,
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
        <select
          value={roleKey}
          onChange={(e) => {
            const next = e.target.value as RoleKey;
            setRoleKey(next);
            const nextTemplate = ROLE_TEMPLATES.find((row) => row.key === next);
            if (nextTemplate) setJobTitle(nextTemplate.name);
          }}
        >
          {ROLE_TEMPLATES.map((option) => (
            <option key={option.key} value={option.key}>
              {option.shortCode} · {option.name}
            </option>
          ))}
        </select>
      </label>
      <p className="form-help">{template.description}</p>
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
      {roleKey === "auditor" && (
        <label className="form-label">
          Access ends
          <input
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            required
          />
        </label>
      )}
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
