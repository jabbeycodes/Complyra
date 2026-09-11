import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { useData } from "../data/DataProvider";
import {
  DEMO_ADMIN_USERNAME,
  DEMO_AGENCY_CODE,
  DEMO_DSP_USERNAME,
} from "../data/seed";
import { DEMO_PASSWORD } from "../data/types";
import type { CreateAgencyResult } from "../data/types";
import { roleLabel } from "../data/status";

export default function LoginScreen({
  onSetup,
  prefill,
}: {
  onSetup?: () => void;
  prefill?: CreateAgencyResult | null;
}) {
  const { signIn, usingHostedBackend } = useData();
  const [agencyCode, setAgencyCode] = useState(
    prefill?.agencyCode ?? DEMO_AGENCY_CODE,
  );
  const [username, setUsername] = useState(
    prefill?.username ?? DEMO_ADMIN_USERNAME,
  );
  const [password, setPassword] = useState("");
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
            ? "Use your agency code (for example evergreen-mo), username, and password."
            : "Local Evergreen demo is available. Hosted agencies use the same agency-code + username sign-in."}
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
              onChange={(e) => setAgencyCode(e.target.value.toLowerCase())}
              placeholder="evergreen-mo"
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
        {onSetup && (
          <button className="button full setup-link" type="button" onClick={onSetup}>
            Set up an agency
          </button>
        )}
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
