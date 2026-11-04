import { useEffect, useState } from "react";
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
  // HR can assign operational roles but never sees administrator.
  const grantableRoles = grantableRoleTemplates(session?.roleKey);
  // WAVE-7T (simulation batch 158): the draft must start on the member's
  // actual current role. The old initializer fell back to "dsp" whenever the
  // viewer could not grant the member's current role (e.g. HR or compliance
  // viewing an administrator's row), so the select read "DSP" under a role
  // column saying "Agency administrator" — and an untouched Save would have
  // submitted that wrong role.
  const canGrantCurrent = canGrantRole(session?.roleKey, roleKey);
  const [nextRole, setNextRole] = useState(roleKey);
  const [nextSite, setNextSite] = useState(siteId ?? "");
  const [nextExpiry, setNextExpiry] = useState(expiresOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Staff rows are keyed by member name, so this instance can be reused for
  // a different member (or a changed assignment) after a refresh — re-sync
  // the draft whenever the member's assignment changes underneath it.
  useEffect(() => {
    setNextRole(roleKey);
    setNextSite(siteId ?? "");
    setNextExpiry(expiresOn ?? "");
  }, [userId, roleKey, siteId, expiresOn]);

  if (session?.userId === userId && roleKey === "administrator") {
    return <span className="muted">Administrator</span>;
  }

  if (!canGrantCurrent) {
    // The viewer may assign roles, but not THIS member's current role —
    // administrator / compliance-administrator stay with administrators
    // (GRANT_RULES). There is no safe draft to offer: any select would have
    // to open on a role the member does not hold. Render the actual role
    // read-only instead of a form pre-set to a different role.
    const label =
      ROLE_TEMPLATES.find((row) => row.key === roleKey)?.name ?? roleKey;
    return <span className="muted">{label}</span>;
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
