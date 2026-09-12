import { useEffect, useMemo, useState } from "react";
import { Building2, Check, X } from "lucide-react";
import { PageHeading } from "../components";
import { useData } from "../data/DataProvider";
import { buildAgencyCode, suggestAgencySlug } from "../data/agencyCode";
import { US_STATES } from "../data/usStates";
import type { PendingAgency } from "../data/types";

export default function PlatformConsole({
  onSaved,
}: {
  onSaved: (message: string) => void;
}) {
  const { api, refresh } = useData();
  const [pending, setPending] = useState<PendingAgency[]>([]);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("MO");
  const [slug, setSlug] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminTempPassword, setAdminTempPassword] = useState("");
  const [created, setCreated] = useState<{
    agencyCode: string;
    username: string;
    tempPassword: string;
  } | null>(null);
  const agencyCode = useMemo(
    () => (slug && stateCode ? buildAgencyCode(slug, stateCode) : ""),
    [slug, stateCode],
  );

  async function load() {
    setPending(await api.listPendingAgencies());
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [api]);

  return (
    <>
      <PageHeading
        eyebrow="COMPLYRER OPERATOR."
        title="Approve agency setups"
        description="Self-serve agencies stay pending until you activate them. Provider codes are always ALL CAPS."
      />
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>Pending agencies</h2>
        {pending.length === 0 ? (
          <p className="muted">No agencies are waiting.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Agency</th>
                  <th>Provider code</th>
                  <th>State</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {pending.map((agency) => (
                  <tr key={agency.id}>
                    <td>{agency.name}</td>
                    <td>
                      <strong>{agency.agencyCode}</strong>
                    </td>
                    <td>{agency.stateCode}</td>
                    <td>
                      <button
                        className="button primary"
                        type="button"
                        onClick={async () => {
                          await api.setAgencyStatus(agency.id, "active");
                          await load();
                          await refresh();
                          onSaved(`${agency.agencyCode} is active.`);
                        }}
                      >
                        <Check size={16} /> Approve
                      </button>
                      <button
                        className="button"
                        type="button"
                        onClick={async () => {
                          await api.setAgencyStatus(agency.id, "rejected");
                          await load();
                          onSaved(`${agency.agencyCode} was rejected.`);
                        }}
                      >
                        <X size={16} /> Reject
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel">
        <h2>Set up an agency for a provider</h2>
        <p className="form-help">
          This path is Complyrer-operated, so the agency is active immediately.
        </p>
        {created ? (
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
        ) : (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setError("");
              try {
                const result = await api.createAgency({
                  name,
                  stateCode,
                  slug,
                  adminFullName,
                  adminUsername,
                  adminTempPassword,
                  provisionedBy: "platform",
                });
                setCreated({
                  agencyCode: result.agencyCode,
                  username: result.username,
                  tempPassword: adminTempPassword,
                });
                onSaved(`${result.agencyCode} is ready.`);
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <label className="form-label">
              Agency name
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSlug(suggestAgencySlug(e.target.value));
                }}
                required
              />
            </label>
            <label className="form-label">
              Home state
              <select
                value={stateCode}
                onChange={(e) => setStateCode(e.target.value)}
              >
                {US_STATES.map((state) => (
                  <option key={state.code} value={state.code}>
                    {state.name} ({state.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Short name
              <input
                value={slug}
                onChange={(e) =>
                  setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""))
                }
                required
              />
            </label>
            <p className="form-help">
              Provider code <strong>{agencyCode || "SHORTNAME-ST"}</strong>
            </p>
            <label className="form-label">
              First administrator name
              <input
                value={adminFullName}
                onChange={(e) => {
                  setAdminFullName(e.target.value);
                  if (!adminUsername) {
                    setAdminUsername(
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
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value.toLowerCase())}
                required
              />
            </label>
            <label className="form-label">
              Temporary password
              <input
                value={adminTempPassword}
                onChange={(e) => setAdminTempPassword(e.target.value)}
                minLength={8}
                required
              />
            </label>
            <button className="button primary" type="submit">
              <Building2 size={16} /> Create active agency
            </button>
          </form>
        )}
      </section>
    </>
  );
}
