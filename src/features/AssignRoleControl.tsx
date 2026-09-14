import { useState } from "react";
import { ROLE_TEMPLATES, canGrantRole, grantableRoleTemplates } from "../data/permissions";
import { useData } from "../data/DataProvider";

export default function AssignRoleControl({
  userId,
  roleKey,
  siteId,
  expiresOn,
  onAssigned,
}: {
  userId: string;
  roleKey: string;
  siteId: string | null;
  expiresOn: string | null;
  onAssigned: (message: string) => void;
}) {
  const { api, workspace, refresh, session } = useData();
  // Grantable roles come from the canonical GRANT_RULES (src/data/permissions.ts):
  // HR can assign operational roles but never sees administrator /
  // compliance-administrator.
  const grantableRoles = grantableRoleTemplates(session?.roleKey);
  const [nextRole, setNextRole] = useState(
    canGrantRole(session?.roleKey, roleKey) ? roleKey : "dsp",
  );
  const [nextSite, setNextSite] = useState(siteId ?? "");
  const [nextExpiry, setNextExpiry] = useState(expiresOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (session?.userId === userId && roleKey === "administrator") {
    return <span className="muted">Administrator</span>;
  }

  return (
    <form
      className="assign-role"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          await api.assignMemberRole(
            userId,
            nextRole,
            nextSite || null,
            nextRole === "auditor" ? nextExpiry || null : null,
          );
          await refresh();
          const label =
            ROLE_TEMPLATES.find((row) => row.key === nextRole)?.name ?? nextRole;
          onAssigned(`${label} assigned.`);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <select
        aria-label="Assigned role"
        value={nextRole}
        onChange={(e) => setNextRole(e.target.value)}
      >
        {grantableRoles.map((row) => (
          <option key={row.key} value={row.key}>
            {row.shortCode} · {row.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Home site"
        value={nextSite}
        onChange={(e) => setNextSite(e.target.value)}
      >
        <option value="">Agency-wide</option>
        {workspace?.sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
      {nextRole === "auditor" && (
        <input
          type="date"
          aria-label="Auditor access ends"
          value={nextExpiry}
          onChange={(e) => setNextExpiry(e.target.value)}
          required
        />
      )}
      <button className="button" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
