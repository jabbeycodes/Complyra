/**
 * Kiosk admin — pairing tokens and clock credentials for the kiosk
 * time clock. Rendered on the manager "Kiosk" tab; sections are gated
 * individually:
 *  - Pairing tokens (per site): hub.manage_staffing
 *  - Employee clock credentials (employee ID + PIN): hub.manage_pay_settings
 *
 * Types are Worker 1's HrKioskToken / HrClockCredential, which match the
 * kiosk migration; Worker 3's exact method names are consumed through
 * adaptKioskStore (see kioskContracts.ts for the known hrStore.ts
 * mismatch). Raw tokens and PINs are shown exactly ONCE in a copy box and
 * never stored client-side — the UI warns that they can't be recovered.
 *
 * `initialTokens` / `initialCredentials` seed the first render (tests / SSR).
 */
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
import { Empty } from "../../components";
import { hasPermission } from "../../data/permissions";
import type { HrStore } from "../../data/hrStore";
import type { SessionUser } from "../../data/types";
import {
  adaptKioskStore,
  isKioskStoreAvailable,
  type ClockCredential,
  type KioskToken,
} from "./kioskContracts";
import { RemotePunchAdmin } from "./RemotePunchAdmin";
import type { HubSite, HubStaffEntry } from "./EmployeeHubPage";

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${d.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} · ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}

function randomPin(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

function kioskUrlFor(rawToken: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}/#/clock/k/${rawToken}`;
}

async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  return false;
}

/**
 * Show-once reveal box for a raw token or PIN: the secret, the full kiosk
 * URL when it's a token, copy buttons, and the "write it down now"
 * warning. Exported for tests.
 */
export function KioskTokenReveal({
  title,
  secret,
  secretLabel,
  kioskUrl,
  warning,
  onDismiss,
}: {
  title: string;
  secret: string;
  secretLabel: string;
  kioskUrl?: string;
  warning: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState("");
  const copy = async (what: "secret" | "url", text: string) => {
    if (await copyText(text)) {
      setCopied(what);
      setTimeout(() => setCopied(""), 2000);
    }
  };
  return (
    <div className="hub-inline-form" role="alert" style={{ marginBottom: 16 }}>
      <h3>{title}</h3>
      <p className="hub-sub">{warning}</p>
      <label>
        {secretLabel}
        <span className="hub-token-box" style={{ display: "block", marginTop: 6 }}>
          {secret}
        </span>
      </label>
      <div className="hub-form-actions">
        <button className="hub-btn" onClick={() => copy("secret", secret)}>
          <Copy size={16} /> {copied === "secret" ? "Copied!" : "Copy"}
        </button>
      </div>
      {kioskUrl && (
        <>
          <label style={{ marginTop: 8 }}>
            Kiosk URL — bookmark this on the house laptop
            <span className="hub-token-box" style={{ display: "block", marginTop: 6 }}>
              {kioskUrl}
            </span>
          </label>
          <div className="hub-form-actions">
            <button className="hub-btn" onClick={() => copy("url", kioskUrl)}>
              <Copy size={16} /> {copied === "url" ? "Copied!" : "Copy URL"}
            </button>
          </div>
        </>
      )}
      <div className="hub-form-actions">
        <button className="hub-btn primary" onClick={onDismiss}>
          <Check size={16} /> I've saved it — hide this
        </button>
      </div>
    </div>
  );
}

export function KioskAdmin({
  session,
  store,
  sites,
  staffList,
  initialTokens,
  initialCredentials,
}: {
  session: SessionUser;
  store: HrStore;
  sites: HubSite[];
  staffList: HubStaffEntry[];
  initialTokens?: KioskToken[];
  initialCredentials?: ClockCredential[];
}) {
  const canTokens = hasPermission(session, "hub.manage_staffing");
  const canCreds = hasPermission(session, "hub.manage_pay_settings");
  const kiosk = useMemo(() => adaptKioskStore(store), [store]);
  const available = isKioskStoreAvailable(store);

  const [tokens, setTokens] = useState<KioskToken[]>(initialTokens ?? []);
  const [credentials, setCredentials] = useState<ClockCredential[]>(initialCredentials ?? []);
  const [loading, setLoading] = useState(!initialTokens && !initialCredentials && available);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [tokenSiteId, setTokenSiteId] = useState(sites[0]?.id ?? "");
  const [tokenLabel, setTokenLabel] = useState("");
  const [revealedToken, setRevealedToken] = useState<{ label: string; rawToken: string } | null>(null);

  const [credStaffId, setCredStaffId] = useState("");
  const [employeeIdNumber, setEmployeeIdNumber] = useState("");
  const [pin, setPin] = useState("");
  const [revealedPin, setRevealedPin] = useState<{ staffName: string; employeeIdNumber: string; pin: string } | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [newPin, setNewPin] = useState("");

  const staffName = (userId: string): string =>
    staffList.find((s) => s.userId === userId)?.fullName ?? "Unknown staff";
  const siteName = (siteId: string): string =>
    sites.find((s) => s.id === siteId)?.name ?? "Unknown site";

  const load = () => {
    if (!available) return;
    setLoading(true);
    setError("");
    Promise.all([
      canTokens ? kiosk.listKioskTokens().catch(() => [] as KioskToken[]) : Promise.resolve([] as KioskToken[]),
      canCreds ? kiosk.listClockCredentials().catch(() => [] as ClockCredential[]) : Promise.resolve([] as ClockCredential[]),
    ])
      .then(([t, c]) => {
        setTokens(t);
        setCredentials(c);
        setLoading(false);
      })
      .catch((err) => {
        setError(errMessage(err, "Could not load kiosk settings."));
        setLoading(false);
      });
  };

  useEffect(load, [kiosk, available, canTokens, canCreds]);

  const generateToken = async () => {
    if (!tokenSiteId) {
      setError("Pick the site this kiosk belongs to.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { rawToken } = await kiosk.generateKioskToken(tokenSiteId, tokenLabel.trim());
      setRevealedToken({ label: tokenLabel.trim() || siteName(tokenSiteId), rawToken });
      setTokenLabel("");
      load();
    } catch (err) {
      setError(errMessage(err, "Could not generate the token."));
    } finally {
      setBusy(false);
    }
  };

  const rotateToken = async (token: KioskToken) => {
    setBusy(true);
    setError("");
    try {
      const { rawToken } = await kiosk.rotateKioskToken(token.id);
      setRevealedToken({ label: token.label ?? siteName(token.siteId), rawToken });
      load();
    } catch (err) {
      setError(errMessage(err, "Could not rotate the token."));
    } finally {
      setBusy(false);
    }
  };

  const revokeToken = async (token: KioskToken) => {
    setBusy(true);
    setError("");
    try {
      await kiosk.revokeKioskToken(token.id);
      load();
    } catch (err) {
      setError(errMessage(err, "Could not revoke the token."));
    } finally {
      setBusy(false);
    }
  };

  const issueCredential = async () => {
    if (!credStaffId) {
      setError("Pick the staff member.");
      return;
    }
    if (!employeeIdNumber.trim()) {
      setError("Enter the employee ID number.");
      return;
    }
    if (!/^\d{4,8}$/.test(pin)) {
      setError("The PIN must be 4–8 digits.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await kiosk.issueClockCredential(credStaffId, employeeIdNumber.trim(), pin);
      setRevealedPin({
        staffName: staffName(credStaffId),
        employeeIdNumber: employeeIdNumber.trim(),
        pin,
      });
      setCredStaffId("");
      setEmployeeIdNumber("");
      setPin("");
      load();
    } catch (err) {
      setError(errMessage(err, "Could not issue the credential."));
    } finally {
      setBusy(false);
    }
  };

  const submitPinReset = async (cred: ClockCredential) => {
    if (!/^\d{4,8}$/.test(newPin)) {
      setError("The new PIN must be 4–8 digits.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await kiosk.resetClockPin(cred.staffId, newPin);
      setRevealedPin({
        staffName: staffName(cred.staffId),
        employeeIdNumber: cred.employeeIdNumber,
        pin: newPin,
      });
      setResettingId(null);
      setNewPin("");
      load();
    } catch (err) {
      setError(errMessage(err, "Could not reset the PIN."));
    } finally {
      setBusy(false);
    }
  };

  const unlock = async (cred: ClockCredential) => {
    setBusy(true);
    setError("");
    try {
      await kiosk.unlockCredential(cred.staffId);
      load();
    } catch (err) {
      setError(errMessage(err, "Could not unlock the credential."));
    } finally {
      setBusy(false);
    }
  };

  if (!available && !initialTokens && !initialCredentials) {
    return (
      <section className="hub-card" aria-label="Kiosk admin">
        <h2>Kiosk</h2>
        <p className="hub-sub">
          The kiosk time clock is still being set up — pairing tokens and
          clock credentials will be managed here once it's live.
        </p>
      </section>
    );
  }

  return (
    <section className="hub-card" aria-label="Kiosk admin">
      <h2>Kiosk</h2>
      <p className="hub-sub">
        Pair the house time-clock kiosks and manage staff clock credentials.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading kiosk settings…</p>
      ) : (
        <>
          {canTokens && (
            <div style={{ marginBottom: 28 }}>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <KeyRound size={18} aria-hidden="true" /> Pairing tokens
              </h3>
              <p className="hub-sub">
                One token per kiosk device. Anyone with the token URL can open
                that site's clock — rotate it if a device is lost.
              </p>
              {revealedToken && (
                <KioskTokenReveal
                  title={`New token for “${revealedToken.label}”`}
                  secret={revealedToken.rawToken}
                  secretLabel="Pairing token — shown once"
                  kioskUrl={kioskUrlFor(revealedToken.rawToken)}
                  warning="Copy the token and bookmark the URL on the house laptop now. It won't be shown again — if it's lost, rotate the token below."
                  onDismiss={() => setRevealedToken(null)}
                />
              )}
              <div className="hub-inline-form" style={{ marginBottom: 16 }}>
                <h3>Generate a token</h3>
                <div className="hub-form">
                  <label>
                    Site
                    <select value={tokenSiteId} onChange={(e) => setTokenSiteId(e.target.value)}>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Label
                    <input
                      value={tokenLabel}
                      onChange={(e) => setTokenLabel(e.target.value)}
                      placeholder="Maple House front desk"
                    />
                  </label>
                </div>
                <div className="hub-form-actions">
                  <button className="hub-btn primary" disabled={busy} onClick={generateToken}>
                    <Plus size={16} /> Generate token
                  </button>
                </div>
              </div>
              {tokens.length === 0 ? (
                <Empty title="No kiosk tokens" text="Generate the first token above to pair a kiosk." mark="quiet" />
              ) : (
                <ul className="hub-list">
                  {tokens.map((t) => (
                    <li className="hub-list-item" key={t.id}>
                      <div className="hub-item-main">
                        <span className="hub-item-title">
                          {t.label ?? "Untitled token"} · {siteName(t.siteId)}
                        </span>
                        <span className="hub-item-sub">
                          Created {fmtDateTime(t.createdAt)}
                          {t.lastUsedAt ? ` · last used ${fmtDateTime(t.lastUsedAt)}` : " · never used"}
                        </span>
                      </div>
                      <div className="hub-row">
                        {t.revokedAt || !t.active ? (
                          <span className="hub-status denied">Revoked</span>
                        ) : (
                          <>
                            <span className="hub-status approved">Active</span>
                            <button className="hub-btn" disabled={busy} onClick={() => rotateToken(t)} title="Issue a new token; the old one stops working">
                              <RefreshCw size={16} /> Rotate
                            </button>
                            <button className="hub-btn danger" disabled={busy} onClick={() => revokeToken(t)}>
                              <Ban size={16} /> Revoke
                            </button>
                          </>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {canCreds && (
            <div>
              <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <KeyRound size={18} aria-hidden="true" /> Clock credentials
              </h3>
              <p className="hub-sub">
                Employee ID + PIN pairs for kiosk sign-in. PINs are shown once
                when issued or reset and are never recoverable — write them
                down immediately.
              </p>
              {revealedPin && (
                <KioskTokenReveal
                  title={`PIN for ${revealedPin.staffName} (${revealedPin.employeeIdNumber})`}
                  secret={revealedPin.pin}
                  secretLabel="PIN — shown once"
                  warning="This PIN will never be shown again. Write it down now — if it's lost, reset it below."
                  onDismiss={() => setRevealedPin(null)}
                />
              )}
              <div className="hub-inline-form" style={{ marginBottom: 16 }}>
                <h3>Issue a credential</h3>
                <div className="hub-form">
                  <label>
                    Staff member
                    <select value={credStaffId} onChange={(e) => setCredStaffId(e.target.value)}>
                      <option value="">Pick…</option>
                      {staffList.map((s) => (
                        <option key={s.userId} value={s.userId}>{s.fullName}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Employee ID number
                    <input
                      value={employeeIdNumber}
                      onChange={(e) => setEmployeeIdNumber(e.target.value)}
                      placeholder="1042"
                      inputMode="numeric"
                    />
                  </label>
                  <label>
                    PIN (4–8 digits)
                    <input
                      value={pin}
                      onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                      placeholder="••••••"
                      inputMode="numeric"
                    />
                  </label>
                </div>
                <div className="hub-form-actions">
                  <button className="hub-btn" disabled={busy} onClick={() => setPin(randomPin())}>
                    Generate PIN
                  </button>
                  <button className="hub-btn primary" disabled={busy} onClick={issueCredential}>
                    <Plus size={16} /> Issue credential
                  </button>
                </div>
              </div>
              {credentials.length === 0 ? (
                <Empty title="No credentials issued" text="Issue the first clock credential above." mark="quiet" />
              ) : (
                <ul className="hub-list">
                  {credentials.map((c) => {
                    const locked = c.lockedUntil != null && Date.parse(c.lockedUntil) > Date.now();
                    return (
                      <li className="hub-list-item" key={c.staffId}>
                        <div className="hub-item-main">
                          <span className="hub-item-title">
                            {staffName(c.staffId)} · ID {c.employeeIdNumber}
                          </span>
                          <span className="hub-item-sub">
                            PIN set {fmtDateTime(c.pinUpdatedAt)}
                            {c.failedAttempts > 0 ? ` · ${c.failedAttempts} failed attempt${c.failedAttempts === 1 ? "" : "s"}` : ""}
                          </span>
                          {resettingId === c.staffId && (
                            <div className="hub-inline-form" style={{ marginTop: 8 }}>
                              <label>
                                New PIN (4–8 digits)
                                <input
                                  value={newPin}
                                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                                  inputMode="numeric"
                                  placeholder="••••••"
                                />
                              </label>
                              <div className="hub-form-actions">
                                <button className="hub-btn" disabled={busy} onClick={() => setNewPin(randomPin())}>
                                  Generate
                                </button>
                                <button className="hub-btn primary" disabled={busy} onClick={() => submitPinReset(c)}>
                                  <Check size={16} /> Set new PIN
                                </button>
                                <button className="hub-btn" onClick={() => setResettingId(null)}>Cancel</button>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="hub-row">
                          {locked ? (
                            <>
                              <span className="hub-status denied">Locked</span>
                              <button className="hub-btn primary" disabled={busy} onClick={() => unlock(c)}>
                                Unlock
                              </button>
                            </>
                          ) : (
                            <span className="hub-status approved">Active</span>
                          )}
                          <button
                            className="hub-btn"
                            disabled={busy}
                            onClick={() => {
                              setResettingId(c.staffId);
                              setNewPin(randomPin());
                            }}
                          >
                            Reset PIN
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
          {canCreds && (
            <div style={{ marginTop: 28 }}>
              <RemotePunchAdmin
                session={session}
                store={store}
                staffList={staffList}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}
