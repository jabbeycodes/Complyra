/**
 * KioskClockPage.tsx — standalone punch-only time clock for a site kiosk.
 *
 * Route: #/clock/k/<token>. This page renders NOTHING from the rest of the
 * app: no nav, no sidebar, no links out. App.tsx early-returns to this page
 * when the hash matches, before the session-gated shell.
 *
 * Flow: token check -> employee ID (keypad) -> PIN (keypad) -> action
 * (CLOCK IN / CLOCK OUT / BREAK / TRANSFER) -> per-action steps
 * (shift suggestion + EVV pick for clock-in, meal-break attestation for
 * clock-out) -> confirmation (auto-resets after 8s).
 *
 * Every kiosk punch is verified by PIN: verification_method is stamped
 * "kiosk_pin" server-side by the submit_kiosk_punch RPC and the punch is
 * flagged remote=false. There is no photo/webcam capture anywhere in the
 * kiosk path.
 *
 * Store access goes through the KioskClient contract (./kioskClient). Tests
 * register a mock with setKioskClient; otherwise the page builds a real
 * client from the HrStore via ./kioskStoreAdapter.
 */

import { useCallback, useEffect, useState } from "react";
import "./kiosk.css";
import {
  KIOSK_SERVICE_TYPES,
  getRegisteredKioskClient,
  type KioskClient,
  type KioskIndividual,
  type KioskPunchInput,
  type KioskPunchKind,
  type KioskShiftStatus,
  type KioskShiftSuggestion,
  type KioskSite,
} from "./kioskClient";
import { createKioskClient } from "./kioskStoreAdapter";
import { enqueuePunch } from "./kioskQueue";
import { useKioskSync } from "./useKioskSync";

type Step =
  | "resolving"
  | "invalid"
  | "id"
  | "pin"
  | "action"
  | "clockin"
  | "attest"
  | "confirm";

interface Session {
  staffId: string;
  displayName: string;
}

interface MealAttestation {
  mealBreakTaken: boolean;
  askedAt: string;
}

interface PunchIntent {
  kind: KioskPunchKind;
  attestation: MealAttestation | null;
}

interface ConfirmInfo {
  displayName: string;
  kindLabel: string;
  time: string;
  offline: boolean;
}

const CONFIRM_RESET_MS = 8000;
const PUNCH_KIND_LABELS: Record<KioskPunchKind, string> = {
  in: "Clocked in",
  out: "Clocked out",
  break_in: "Break started",
  break_out: "Break ended",
  transfer: "Transfer recorded",
};

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatCountdown(lockedUntil: string, now: number): string {
  const ms = new Date(lockedUntil).getTime() - now;
  if (ms <= 0) return "0:00";
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Serialize the meal-break attestation for the punch's jsonb column. */
function serializeAttestation(attestation: MealAttestation): string {
  return JSON.stringify({
    meal_break_taken: attestation.mealBreakTaken,
    asked_at: attestation.askedAt,
  });
}

/* ------------------------- numeric keypad ------------------------------ */

function Keypad({
  onDigit,
  onBackspace,
  onClear,
  label,
}: {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  label: string;
}) {
  return (
    <div className="kiosk-keypad" role="group" aria-label={label}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
        <button key={d} type="button" className="kiosk-key" onClick={() => onDigit(d)}>
          {d}
        </button>
      ))}
      <button type="button" className="kiosk-key kiosk-key-fn" onClick={onClear}>
        Clear
      </button>
      <button type="button" className="kiosk-key" onClick={() => onDigit("0")}>
        0
      </button>
      <button
        type="button"
        className="kiosk-key kiosk-key-fn"
        onClick={onBackspace}
        aria-label="Backspace"
      >
        ⌫
      </button>
    </div>
  );
}

/* ------------------------------ page ----------------------------------- */

export default function KioskClockPage({ token }: { token: string }) {
  const [step, setStep] = useState<Step>("resolving");
  const [client, setClient] = useState<KioskClient | null>(null);
  const [site, setSite] = useState<KioskSite | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [pinBusy, setPinBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<KioskShiftStatus | null>(null);
  const [individuals, setIndividuals] = useState<KioskIndividual[]>([]);

  const [suggestion, setSuggestion] = useState<KioskShiftSuggestion | null>(null);
  const [customizing, setCustomizing] = useState(false);
  const [transferMode, setTransferMode] = useState(false);
  const [serviceType, setServiceType] = useState<string>("");
  const [individualId, setIndividualId] = useState<string>("");

  const [punchBusy, setPunchBusy] = useState(false);
  const [confirmInfo, setConfirmInfo] = useState<ConfirmInfo | null>(null);

  const { pendingCount } = useKioskSync(client);

  /* ---- token resolution + client bootstrap (mount / token change) ---- */
  useEffect(() => {
    let cancelled = false;
    setStep("resolving");
    setError(null);
    setSite(null);
    setClient(null);
    const boot = async () => {
      const registered = getRegisteredKioskClient();
      if (registered) {
        const resolved = await registered.resolveKioskToken(token);
        if (cancelled) return;
        setClient(registered);
        setSite(resolved);
        setStep("id");
        return;
      }
      const bootstrapped = await createKioskClient(token);
      if (cancelled) return;
      setClient(bootstrapped.client);
      setSite({
        siteId: bootstrapped.siteId,
        siteName: bootstrapped.siteName,
        agencyId: bootstrapped.agencyId,
      });
      setStep("id");
    };
    boot().catch(() => {
      if (!cancelled) setStep("invalid");
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  /* ---- lockout countdown ticker ---- */
  useEffect(() => {
    if (!lockedUntil) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [lockedUntil]);

  const resetToId = useCallback(() => {
    setEmployeeId("");
    setPin("");
    setLockedUntil(null);
    setSession(null);
    setStatus(null);
    setSuggestion(null);
    setCustomizing(false);
    setTransferMode(false);
    setServiceType("");
    setIndividualId("");
    setConfirmInfo(null);
    setError(null);
    setStep("id");
  }, []);

  /* ---- confirmation auto-reset ---- */
  useEffect(() => {
    if (step !== "confirm") return;
    const timer = window.setTimeout(() => resetToId(), CONFIRM_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [step, resetToId]);

  const loadStatus = useCallback(
    async (activeClient: KioskClient, staffId: string, siteId: string) => {
      const next = await activeClient.fetchKioskStatus(staffId, siteId);
      setStatus(next);
      return next;
    },
    [],
  );

  const loadIndividuals = useCallback(
    async (
      activeClient: KioskClient,
      siteId: string,
      extra: KioskShiftSuggestion | null,
    ) => {
      const people = await activeClient
        .fetchKioskIndividuals(siteId)
        .catch(() => [] as KioskIndividual[]);
      if (extra?.individualId && !people.some((p) => p.id === extra.individualId)) {
        people.push({
          id: extra.individualId,
          name: extra.individualName ?? extra.individualId,
        });
      }
      setIndividuals(people);
    },
    [],
  );

  /* ------------------------------- ID step ------------------------------ */

  const handleIdContinue = () => {
    if (!employeeId.trim()) {
      setError("Enter your employee ID to continue.");
      return;
    }
    setError(null);
    setStep("pin");
  };

  /* ------------------------------ PIN step ------------------------------ */

  const handlePinSubmit = async () => {
    if (pinBusy || pin.length < 4 || !site || !client) return;
    setPinBusy(true);
    setError(null);
    try {
      const result = await client.verifyKioskPin(token, employeeId.trim(), pin);
      if (result.ok) {
        const nextSession = { staffId: result.staffId, displayName: result.displayName };
        setSession(nextSession);
        setPin("");
        setLockedUntil(null);
        const suggestionPromise = client
          .suggestKioskShift(result.staffId, site.siteId)
          .catch(() => null);
        const [nextStatus, nextSuggestion] = await Promise.all([
          loadStatus(client, result.staffId, site.siteId),
          suggestionPromise,
        ]);
        setStatus(nextStatus);
        setSuggestion(nextSuggestion);
        void loadIndividuals(client, site.siteId, nextSuggestion);
        setStep("action");
      } else if (result.reason === "locked") {
        setLockedUntil(result.lockedUntil ?? null);
        setError(
          result.lockedUntil
            ? "Too many wrong PINs — this kiosk is locked for a bit."
            : "Too many wrong PINs — this kiosk is locked. Ask your manager for help.",
        );
      } else if (result.reason === "bad_token") {
        setStep("invalid");
      } else {
        const left = result.attemptsLeft;
        setError(
          typeof left === "number"
            ? `Incorrect PIN. ${left} ${left === 1 ? "try" : "tries"} left before lockout.`
            : "Incorrect PIN. Try again.",
        );
        setPin("");
      }
    } catch {
      setError("Something went wrong. Check the connection and try again.");
    } finally {
      setPinBusy(false);
    }
  };

  /* ---------------------------- action step ----------------------------- */

  const beginClockIn = () => {
    if (!session) return;
    setError(null);
    setCustomizing(false);
    setTransferMode(false);
    setServiceType(suggestion?.serviceType ?? "");
    setIndividualId(suggestion?.individualId ?? "");
    setStep("clockin");
  };

  const beginClockOut = () => {
    setError(null);
    setStep("attest");
  };

  const beginBreak = () => {
    if (!status) return;
    setError(null);
    void submitPunch({
      kind: status.onBreak ? "break_out" : "break_in",
      attestation: null,
    });
  };

  const beginTransfer = () => {
    if (!status?.clockedIn) return;
    setError(null);
    setCustomizing(true);
    setTransferMode(true);
    setServiceType("");
    setIndividualId("");
    setStep("clockin");
  };

  const confirmClockInDetails = () => {
    setError(null);
    void submitPunch({ kind: transferMode ? "transfer" : "in", attestation: null });
  };

  const handleAttestation = (mealBreakTaken: boolean) => {
    void submitPunch({
      kind: "out",
      attestation: { mealBreakTaken, askedAt: new Date().toISOString() },
    });
  };

  /* --------------------------- punch submit ----------------------------- */

  const submitPunch = async (nextIntent: PunchIntent) => {
    if (!session || !site || !client || punchBusy) return;
    setPunchBusy(true);
    const punchedAt = new Date().toISOString();
    const evvKinds: KioskPunchKind[] = ["in", "transfer"];
    const input: KioskPunchInput = {
      staffId: session.staffId,
      siteId: site.siteId,
      kind: nextIntent.kind,
      punchedAt,
      serviceType: evvKinds.includes(nextIntent.kind) && serviceType ? serviceType : null,
      individualId: evvKinds.includes(nextIntent.kind) && individualId ? individualId : null,
      // Verification ('kiosk_pin') and remote=false are stamped server-side
      // by the submit_kiosk_punch RPC — the token authenticates the device.
      offline: false,
      attestation: nextIntent.attestation
        ? serializeAttestation(nextIntent.attestation)
        : null,
      note: nextIntent.kind === "transfer" ? "Service/individual transfer at kiosk" : null,
    };
    let offline = false;
    try {
      await client.submitKioskPunch(token, input);
    } catch {
      try {
        await enqueuePunch(input, token);
        offline = true;
      } catch {
        // Queue unavailable too — the punch is still acknowledged on screen;
        // the failed submit is surfaced so staff can tell a manager.
        setError("Punch could not be sent or saved. Please tell your manager.");
      }
    }
    setConfirmInfo({
      displayName: session.displayName,
      kindLabel: PUNCH_KIND_LABELS[nextIntent.kind],
      time: formatClockTime(punchedAt),
      offline,
    });
    setPunchBusy(false);
    setStep("confirm");
    // Refresh status for the next person at this kiosk.
    try {
      await loadStatus(client, session.staffId, site.siteId);
    } catch {
      // Non-fatal; the confirmation already went through.
    }
  };

  /* -------------------------------- render ------------------------------ */

  const siteName = site?.siteName ?? "Time clock";

  return (
    <div className="kiosk">
      <div className="kiosk-wrap">
        <header className="kiosk-header">
          <div className="kiosk-brand">ComplyRer Time Clock</div>
          <h1 className="kiosk-site">{siteName}</h1>
        </header>

        {error && (
          <div className="kiosk-error" role="alert">
            {error}
          </div>
        )}

        {step === "resolving" && (
          <div className="kiosk-panel">
            <p className="kiosk-big">Checking this kiosk link…</p>
          </div>
        )}

        {step === "invalid" && (
          <div className="kiosk-panel">
            <p className="kiosk-big">This kiosk link isn’t valid.</p>
            <p className="kiosk-muted">
              Ask your manager for the current kiosk link for this house.
            </p>
          </div>
        )}

        {step === "id" && (
          <div className="kiosk-panel">
            <label className="kiosk-label" htmlFor="kiosk-employee-id">
              Employee ID
            </label>
            <input
              id="kiosk-employee-id"
              className="kiosk-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value.replace(/\D/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleIdContinue();
              }}
              placeholder="Enter your ID"
            />
            <Keypad
              label="Employee ID keypad"
              onDigit={(d) => setEmployeeId((v) => (v + d).slice(0, 12))}
              onBackspace={() => setEmployeeId((v) => v.slice(0, -1))}
              onClear={() => setEmployeeId("")}
            />
            <button
              type="button"
              className="kiosk-btn kiosk-btn-primary"
              onClick={handleIdContinue}
              disabled={!employeeId.trim()}
            >
              Continue
            </button>
          </div>
        )}

        {step === "pin" && (
          <div className="kiosk-panel">
            <p className="kiosk-big">Enter your PIN</p>
            <div className="kiosk-pin-dots" aria-label={`${pin.length} of up to 6 digits entered`}>
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={i < pin.length ? "on" : ""} />
              ))}
            </div>
            {lockedUntil ? (
              <div className="kiosk-lockout" role="alert">
                <p className="kiosk-big">Locked</p>
                <p className="kiosk-muted">
                  Try again in {formatCountdown(lockedUntil, nowMs)}.
                </p>
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn-ghost"
                  onClick={resetToId}
                >
                  Start over
                </button>
              </div>
            ) : (
              <>
                <Keypad
                  label="PIN keypad"
                  onDigit={(d) => setPin((v) => (v + d).slice(0, 6))}
                  onBackspace={() => setPin((v) => v.slice(0, -1))}
                  onClear={() => setPin("")}
                />
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn-primary"
                  onClick={() => void handlePinSubmit()}
                  disabled={pin.length < 4 || pinBusy}
                >
                  {pinBusy ? "Checking…" : "Verify PIN"}
                </button>
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn-ghost"
                  onClick={() => {
                    setPin("");
                    setLockedUntil(null);
                    setError(null);
                    setStep("id");
                  }}
                >
                  Back
                </button>
              </>
            )}
          </div>
        )}

        {step === "action" && session && (
          <div className="kiosk-panel">
            <p className="kiosk-big">Hi, {session.displayName}</p>
            <div className="kiosk-status">
              {status?.clockedIn ? (
                <p>
                  Clocked in since{" "}
                  <strong>{status.sinceIso ? formatClockTime(status.sinceIso) : "—"}</strong>
                  {status.onBreak && status.breakSinceIso && (
                    <>
                      {" "}· on break since {formatClockTime(status.breakSinceIso)}
                    </>
                  )}
                </p>
              ) : (
                <p>Not clocked in.</p>
              )}
              {status?.scheduledShiftLabel && (
                <p className="kiosk-muted">Today’s shift: {status.scheduledShiftLabel}</p>
              )}
            </div>
            <div className="kiosk-actions">
              <button
                type="button"
                className="kiosk-btn kiosk-btn-clockin"
                onClick={beginClockIn}
                disabled={status?.clockedIn || punchBusy}
              >
                CLOCK IN
              </button>
              <button
                type="button"
                className="kiosk-btn kiosk-btn-clockout"
                onClick={beginClockOut}
                disabled={!status?.clockedIn || punchBusy}
              >
                CLOCK OUT
              </button>
              <button
                type="button"
                className="kiosk-btn kiosk-btn-break"
                onClick={beginBreak}
                disabled={!status?.clockedIn || punchBusy}
              >
                {status?.onBreak ? "END BREAK" : "BREAK"}
              </button>
              {status?.clockedIn && (
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn-ghost"
                  onClick={beginTransfer}
                >
                  TRANSFER
                </button>
              )}
            </div>
            <button
              type="button"
              className="kiosk-btn kiosk-btn-ghost"
              onClick={resetToId}
            >
              Done
            </button>
          </div>
        )}

        {step === "clockin" && session && (
          <div className="kiosk-panel">
            <p className="kiosk-big">
              {transferMode || customizing ? "Shift details" : "Confirm your shift"}
            </p>
            {suggestion && !customizing ? (
              <div className="kiosk-suggest">
                <p className="kiosk-suggest-label">{suggestion.shiftLabel}</p>
                {suggestion.serviceType && <p>Service: {suggestion.serviceType}</p>}
                {suggestion.individualName && <p>Individual: {suggestion.individualName}</p>}
                {!suggestion.serviceType && !suggestion.individualName && (
                  <p className="kiosk-muted">No service details on file for this shift.</p>
                )}
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn-primary"
                  onClick={confirmClockInDetails}
                  disabled={punchBusy}
                >
                  {punchBusy ? "Recording…" : "CONFIRM"}
                </button>
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn-ghost"
                  onClick={() => setCustomizing(true)}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="kiosk-form">
                {!suggestion && !customizing && (
                  <p className="kiosk-muted">
                    No scheduled shift found — choose the details for this punch.
                  </p>
                )}
                <label className="kiosk-label" htmlFor="kiosk-service-type">
                  Service type
                </label>
                <select
                  id="kiosk-service-type"
                  className="kiosk-input"
                  value={serviceType}
                  onChange={(e) => setServiceType(e.target.value)}
                >
                  <option value="">Choose a service type…</option>
                  {KIOSK_SERVICE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <label className="kiosk-label" htmlFor="kiosk-individual">
                  Individual served
                </label>
                <select
                  id="kiosk-individual"
                  className="kiosk-input"
                  value={individualId}
                  onChange={(e) => setIndividualId(e.target.value)}
                >
                  <option value="">Choose an individual…</option>
                  {individuals.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="kiosk-btn kiosk-btn-primary"
                  onClick={confirmClockInDetails}
                  disabled={punchBusy}
                >
                  {punchBusy ? "Recording…" : "CONFIRM"}
                </button>
                {suggestion && (
                  <button
                    type="button"
                    className="kiosk-btn kiosk-btn-ghost"
                    onClick={() => {
                      setServiceType(suggestion.serviceType ?? "");
                      setIndividualId(suggestion.individualId ?? "");
                      setCustomizing(false);
                    }}
                  >
                    Use suggestion
                  </button>
                )}
              </div>
            )}
            <button
              type="button"
              className="kiosk-btn kiosk-btn-ghost"
              onClick={() => setStep("action")}
            >
              Back
            </button>
          </div>
        )}

        {step === "attest" && (
          <div className="kiosk-panel">
            <p className="kiosk-big">Did you take your 30-minute meal break?</p>
            <div className="kiosk-actions">
              <button
                type="button"
                className="kiosk-btn kiosk-btn-clockin"
                onClick={() => handleAttestation(true)}
                disabled={punchBusy}
              >
                YES
              </button>
              <button
                type="button"
                className="kiosk-btn kiosk-btn-clockout"
                onClick={() => handleAttestation(false)}
                disabled={punchBusy}
              >
                NO
              </button>
            </div>
            <button
              type="button"
              className="kiosk-btn kiosk-btn-ghost"
              onClick={() => setStep("action")}
            >
              Back
            </button>
          </div>
        )}

        {step === "confirm" && confirmInfo && (
          <div className="kiosk-panel kiosk-confirm">
            <div className="kiosk-check" aria-hidden="true">
              ✓
            </div>
            <p className="kiosk-big">{confirmInfo.kindLabel}</p>
            <p className="kiosk-confirm-name">{confirmInfo.displayName}</p>
            <p className="kiosk-muted">{confirmInfo.time}</p>
            {confirmInfo.offline && (
              <p className="kiosk-note">
                Saved on this kiosk — will sync when the connection returns.
              </p>
            )}
            <button
              type="button"
              className="kiosk-btn kiosk-btn-primary"
              onClick={resetToId}
            >
              Done
            </button>
          </div>
        )}

        <footer className="kiosk-footer">
          {pendingCount > 0 && (
            <span className="kiosk-pending">
              {pendingCount} {pendingCount === 1 ? "punch" : "punches"} waiting to sync
            </span>
          )}
        </footer>
      </div>
    </div>
  );
}
