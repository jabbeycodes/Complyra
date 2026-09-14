import { useMemo, useState } from "react";
import { ComplyRerWordmark } from "../brand/ComplyrerBrand";
import { Building2 } from "lucide-react";
import { useData } from "../data/DataProvider";
import { buildAgencyCode, suggestAgencySlug } from "../data/agencyCode";
import { US_STATES } from "../data/usStates";
import type { CreateAgencyResult } from "../data/types";

export default function SetupAgencyScreen({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (result: CreateAgencyResult) => void;
}) {
  const { api } = useData();
  const [name, setName] = useState("");
  const [stateCode, setStateCode] = useState("MO");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminFullName, setAdminFullName] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminTempPassword, setAdminTempPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<
    (CreateAgencyResult & { tempPassword: string }) | null
  >(null);

  const agencyCode = useMemo(
    () => (slug && stateCode ? buildAgencyCode(slug, stateCode) : ""),
    [slug, stateCode],
  );

  if (created) {
    const pending = created.status === "pending";
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-brand">
            <ComplyRerWordmark size={36} />
          </div>
          <h1>{pending ? "Submitted for review" : "Agency is ready"}</h1>
          <p>
            {pending
              ? "Complyrer will review this agency before staff can open care records. Save these first-administrator credentials."
              : "Give these credentials to the first administrator once. They must change the temporary password at first sign-in."}
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
          <button
            className="button primary full"
            type="button"
            onClick={() => onCreated(created)}
          >
            Continue to sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <ComplyRerWordmark size={36} />
        </div>
        <h1>Set up an agency</h1>
        <p>
          Create the provider code and the first administrator. Complyrer reviews
          self-serve setups before the workspace opens.
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              const result = await api.createAgency({
                name,
                stateCode,
                slug,
                adminFullName,
                adminUsername,
                adminTempPassword,
                provisionedBy: "self",
              });
              setCreated({ ...result, tempPassword: adminTempPassword });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="form-label">
            Agency name
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(suggestAgencySlug(e.target.value));
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
            Short name for the provider code
            <input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ""));
              }}
              required
            />
          </label>
          <p className="form-help">
            Staff will sign in with{" "}
            <strong>{agencyCode || "SHORTNAME-ST"}</strong>. This cannot change
            later.
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
              type="text"
              autoComplete="off"
              value={adminTempPassword}
              onChange={(e) => setAdminTempPassword(e.target.value)}
              minLength={8}
              required
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" type="submit" disabled={busy}>
            <Building2 size={17} /> {busy ? "Submitting…" : "Submit agency"}
          </button>
        </form>
        <div className="login-demo">
          <button type="button" onClick={onBack}>
            Back to sign in
          </button>
        </div>
      </div>
    </div>
  );
}
