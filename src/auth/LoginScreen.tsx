import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useData } from "../data/DataProvider";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "../data/seed";
import { DEMO_PASSWORD } from "../data/types";
import { roleLabel } from "../data/status";

export default function LoginScreen() {
  const { signIn, usingHostedBackend } = useData();
  const [agencyCode, setAgencyCode] = useState(DEMO_AGENCY_CODE);
  const [username, setUsername] = useState(DEMO_ADMIN_USERNAME);
  const [password, setPassword] = useState(DEMO_PASSWORD);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <img src="/favicon.svg" alt="" />
          <span>
            complyra<span className="brand-period">.</span>
          </span>
        </div>
        <h1>Sign in to your agency workspace</h1>
        <p>
          {usingHostedBackend
            ? "Use the agency code, username, and password your administrator gave you."
            : "This environment is using the schema-faithful Evergreen Care workspace. Connect VITE_SUPABASE_URL to use hosted Auth, RLS, and private storage."}
        </p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await signIn({ agencyCode, username, password });
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="form-label">
            Agency code
            <input
              type="text"
              autoComplete="organization"
              value={agencyCode}
              onChange={(e) => setAgencyCode(e.target.value.toUpperCase())}
              required
            />
          </label>
          <label className="form-label">
            Username
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label className="form-label">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <button className="button primary full" type="submit" disabled={busy}>
            <ShieldCheck size={17} /> {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <div className="login-demo">
          <strong>Fictional Evergreen Care accounts</strong>
          <button
            type="button"
            onClick={() => {
              setAgencyCode(DEMO_AGENCY_CODE);
              setUsername(DEMO_ADMIN_USERNAME);
              setPassword(DEMO_PASSWORD);
            }}
          >
            {roleLabel("administrator")} · {DEMO_AGENCY_CODE} / {DEMO_ADMIN_USERNAME}
          </button>
          <button
            type="button"
            onClick={() => {
              setAgencyCode(DEMO_AGENCY_CODE);
              setUsername(DEMO_DSP_USERNAME);
              setPassword(DEMO_PASSWORD);
            }}
          >
            DSP · {DEMO_AGENCY_CODE} / {DEMO_DSP_USERNAME}
          </button>
          <small>Sample password: {DEMO_PASSWORD}</small>
        </div>
      </div>
    </div>
  );
}
