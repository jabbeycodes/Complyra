import { useState } from "react";
import { Check, RotateCcw } from "lucide-react";
import { PageHeading } from "../components";
import { useData } from "../data/DataProvider";
import {
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  ROLE_TEMPLATE_BY_KEY,
  defaultPermissions,
  type PermissionKey,
  type PermissionMap,
  type RoleKey,
} from "../data/permissions";

export default function RolesAccessPage({
  onSaved,
}: {
  onSaved: (message: string) => void;
}) {
  const { api, workspace, refresh } = useData();
  const [selected, setSelected] = useState<RoleKey>("house_manager");
  const [draft, setDraft] = useState<PermissionMap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const role =
    workspace?.roles.find((row) => row.key === selected) ??
    ROLE_TEMPLATE_BY_KEY[selected];
  const permissions = draft ?? role.permissions;

  function selectRole(key: RoleKey) {
    setSelected(key);
    setDraft(null);
    setError("");
  }

  function toggle(key: PermissionKey) {
    if (selected === "administrator" && key === "members.assign_roles") return;
    setDraft({ ...permissions, [key]: !permissions[key] });
  }

  return (
    <>
      <PageHeading
        eyebrow="WHO CAN DO WHAT."
        title="Roles and access levels"
        description="Start from the house templates. Turn access on or off for this agency without building a checkbox for every screen."
      />
      <div className="role-layout">
        <section className="panel role-list">
          {(workspace?.roles ?? []).map((row) => (
            <button
              key={row.key}
              type="button"
              className={row.key === selected ? "selected" : ""}
              onClick={() => selectRole(row.key)}
            >
              <strong>
                {row.shortCode}
                <span>{row.name}</span>
              </strong>
              <small>{row.description}</small>
            </button>
          ))}
        </section>
        <section className="panel role-editor">
          <header>
            <div>
              <p className="eyebrow">{role.shortCode}</p>
              <h2>{role.name}</h2>
              <p>{role.description}</p>
              <p className="muted">Default scope: {role.defaultScope}</p>
            </div>
            <button
              className="button"
              type="button"
              onClick={() => setDraft(defaultPermissions(selected))}
            >
              <RotateCcw size={16} /> Reset template
            </button>
          </header>
          <ul className="permission-list">
            {PERMISSION_KEYS.map((key) => (
              <li key={key}>
                <label>
                  <input
                    type="checkbox"
                    checked={Boolean(permissions[key])}
                    disabled={
                      selected === "administrator" && key === "members.assign_roles"
                    }
                    onChange={() => toggle(key)}
                  />
                  <span>
                    <strong>{PERMISSION_LABELS[key]}</strong>
                    <small>{key}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button
            className="button primary"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api.updateAgencyRole(selected, permissions);
                await refresh();
                setDraft(null);
                onSaved(`${role.name} access levels saved.`);
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <Check size={16} /> Save access levels
          </button>
        </section>
      </div>
    </>
  );
}
