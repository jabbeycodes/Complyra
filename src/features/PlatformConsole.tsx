import { useEffect, useMemo, useState } from "react";
import { Building2, Check, X } from "lucide-react";
import { PageHeading } from "../components";
import { useData } from "../data/DataProvider";
import { buildAgencyCode, suggestAgencySlug } from "../data/agencyCode";
import { US_STATES } from "../data/usStates";
import type { PendingAgency } from "../data/types";
import { createRulesStore } from "../data/rulesStore";
import { AgencyRulesPanel } from "./AgencyRulesPanel";
import PasswordField from "../components/PasswordField";
import OneTimeSecret from "../components/OneTimeSecret";

export type PlatformCreatedAgencyCredentials = {
  agencyCode: string;
  username: string;
  tempPassword: string;
};

/**
 * The platform console's post-creation handover. The temporary password
 * renders only through OneTimeSecret (masked by default, explicit
 * Show/Copy); "Done" clears it from the console entirely — previously
 * it sat in plain text on the page with no way to dismiss it.
 */
export function PlatformCreatedAgencyView({
  created,
  onDismiss,
}: {
  created: PlatformCreatedAgencyCredentials;
  onDismiss: () => void;
}) {
  return (
    <div>
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
            <OneTimeSecret value={created.tempPassword} onDone={onDismiss} />
          </dd>
        </div>
      </dl>
      <p className="form-help">
        Hand these credentials to the agency's first administrator once.
        The password is not shown again after you dismiss it.
      </p>
    </div>
  );
}

export default function PlatformConsole({
  onSaved,
}: {
  onSaved: (message: string) => void;
}) {
  const { api, refresh, session } = useData();
  const [pending, setPending] = useState<PendingAgency[]>([]);
  const [allAgencies, setAllAgencies] = useState<PendingAgency[]>([]);
  const rulesStore = useMemo(
    () =>
      createRulesStore({
        userId: session?.userId ?? "",
        fullName: session?.fullName ?? "",
        isOperator: Boolean(session?.platformAdmin),
        adminOfAgencyId: null,
        memberOfAgencyIds: session ? [session.agencyId] : [],
      }),
    [session],
  );
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
    const [pendingRows, everyAgency] = await Promise.all([
      api.listPendingAgencies(),
      api.listAgencies().catch(() => [] as PendingAgency[]),
    ]);
    setPending(pendingRows);
    setAllAgencies(everyAgency.filter((a) => a.status === "active"));
  }

  useEffect(() => {
    void load().catch((err) => setError((err as Error).message));
  }, [api]);

  return (
    <>
      <PageHeading
        title="Agencies"
        description="Provider codes are always ALL CAPS."
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
          <PlatformCreatedAgencyView
            created={created}
            onDismiss={() => {
              setCreated(null);
              setAdminTempPassword("");
            }}
          />
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
                // The handover view holds the only copy now; the form
                // field must not keep the password after submit.
                setAdminTempPassword("");
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
            <PasswordField
              label="Temporary password"
              value={adminTempPassword}
              onChange={setAdminTempPassword}
              minLength={8}
              required
            />
            <button className="button primary" type="submit">
              <Building2 size={16} /> Create active agency
            </button>
          </form>
        )}
      </section>
      <AgencyRulesPanel agencies={allAgencies} store={rulesStore} onSaved={onSaved} />
    </>
  );
}
