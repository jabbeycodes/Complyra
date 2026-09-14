import { useState } from "react";
import { ComplyRerWordmark } from "../brand/ComplyrerBrand";
import { Eye, EyeOff, Play, ShieldCheck } from "lucide-react";
import { useData } from "../data/DataProvider";
import { DEMO_ADMIN_USERNAME, DEMO_AGENCY_CODE } from "../data/seed";
import { DEMO_PASSWORD } from "../data/types";
import type { CreateAgencyResult } from "../data/types";
import { normalizeAgencyCode } from "../data/agencyCode";

export default function LoginScreen({
  onSetup,
  prefill,
}: {
  onSetup?: () => void;
  prefill?: CreateAgencyResult | null;
}) {
  const { signIn } = useData();
  const [agencyCode, setAgencyCode] = useState(
    prefill?.agencyCode ?? DEMO_AGENCY_CODE,
  );
  const [username, setUsername] = useState(
    prefill?.username ?? DEMO_ADMIN_USERNAME,
  );
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);

  async function enterDemo() {
    setDemoBusy(true);
    setError("");
    try {
      await signIn({
        agencyCode: DEMO_AGENCY_CODE,
        username: DEMO_ADMIN_USERNAME,
        password: DEMO_PASSWORD,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDemoBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <ComplyRerWordmark size={36} />
        </div>
        <h1>Sign in</h1>
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
            Provider code
            <input
              type="text"
              autoComplete="organization"
              value={agencyCode}
              onChange={(e) => setAgencyCode(normalizeAgencyCode(e.target.value))}
              placeholder="EVERGREEN-MO"
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
            <span className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "Hide password" : "Show password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff size={20} aria-hidden="true" />
                ) : (
                  <Eye size={20} aria-hidden="true" />
                )}
              </button>
            </span>
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
          <button
            type="button"
            className="button full"
            onClick={enterDemo}
            disabled={busy || demoBusy}
          >
            <Play size={17} aria-hidden="true" />{" "}
            {demoBusy ? "Loading demo…" : "Explore the interactive demo"}
          </button>
          <small>Fictional Evergreen Care data — no sign-up needed.</small>
        </div>
      </div>
    </div>
  );
}
