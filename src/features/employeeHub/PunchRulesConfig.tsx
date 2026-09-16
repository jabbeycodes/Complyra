/**
 * Punch rules config ("Clock settings") — agency-wide kiosk/time-clock
 * rules, gated on hub.manage_pay_settings by the Payroll tab.
 *
 * Shape is Worker 1's HrPunchRules, which matches the hr_punch_rules
 * migration: rounding minutes (0/5/10/15), rounding applies-to (payroll
 * only vs display + payroll), grace minutes, auto-clock-out buffer, and
 * the auto-approval score threshold — with a plain-English summary of
 * what the active rules do, in the style of describeOvertimeRules.
 *
 * Worker 3's exact method names are consumed through adaptKioskStore,
 * which normalizes Worker 3's declared shapes to this one (see
 * kioskContracts.ts for the known hrStore.ts/migration mismatch).
 *
 * `initialRules` seeds the first render (tests / SSR).
 */
import { useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import { DEFAULT_PUNCH_RULES } from "../../data/hr";
import type { HrPunchRules } from "../../data/hr";
import type { HrStore } from "../../data/hrStore";
import {
  adaptKioskStore,
  isKioskStoreAvailable,
} from "./kioskContracts";

const ROUNDING_OPTIONS = [0, 5, 10, 15] as const;

export type RoundingMinutes = (typeof ROUNDING_OPTIONS)[number];

/**
 * Plain-English summary of the active punch rules, e.g.
 * "Punch times are rounded to the nearest 5 minutes for payroll only.
 * Clock-ins within 5 minutes of a shift start aren't flagged late.
 * Staff still clocked in 30 minutes after their shift end are clocked out
 * automatically. Timecards scoring 90 or higher can auto-approve."
 */
export function describePunchRules(rules: HrPunchRules): string {
  const parts: string[] = [];
  if (rules.roundingMinutes === 0) {
    parts.push("Punch times are not rounded — exact clock times are used.");
  } else {
    parts.push(
      `Punch times are rounded to the nearest ${rules.roundingMinutes} minutes ` +
        (rules.roundingApplies === "payroll"
          ? "for payroll only (the times staff see stay exact)."
          : "everywhere, including the times staff see."),
    );
  }
  if (rules.graceMinutes <= 0) {
    parts.push("Any clock-in after the shift start is flagged late.");
  } else {
    parts.push(
      `Clock-ins within ${rules.graceMinutes} minutes of a shift start aren't flagged late, ` +
        `and clock-outs within ${rules.graceMinutes} minutes of the shift end aren't flagged early.`,
    );
  }
  if (rules.autoClockoutBufferMinutes <= 0) {
    parts.push("Automatic clock-out is off — open punches stay open until someone clocks out.");
  } else {
    parts.push(
      `Staff still clocked in ${rules.autoClockoutBufferMinutes} minutes after their shift end are clocked out automatically.`,
    );
  }
  if (rules.autoApprovalScoreThreshold <= 0) {
    parts.push("No timecard auto-approvals — every timecard needs a manager's decision.");
  } else {
    parts.push(
      `Timecards scoring ${rules.autoApprovalScoreThreshold} or higher, with no missed punches or unverified photos, can auto-approve.`,
    );
  }
  return parts.join(" ");
}

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function PunchRulesConfig({
  store,
  initialRules,
}: {
  store: HrStore;
  initialRules?: HrPunchRules;
}) {
  const kiosk = useMemo(() => adaptKioskStore(store), [store]);
  const available = isKioskStoreAvailable(store);
  const [rules, setRules] = useState<HrPunchRules | null>(initialRules ?? null);
  const [loading, setLoading] = useState(!initialRules && available);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const [roundingMinutes, setRoundingMinutes] = useState<RoundingMinutes>(
    initialRules?.roundingMinutes === 5 ||
    initialRules?.roundingMinutes === 10 ||
    initialRules?.roundingMinutes === 15
      ? initialRules.roundingMinutes
      : (DEFAULT_PUNCH_RULES.roundingMinutes as RoundingMinutes),
  );
  const [roundingApplies, setRoundingApplies] = useState<HrPunchRules["roundingApplies"]>(
    initialRules?.roundingApplies ?? DEFAULT_PUNCH_RULES.roundingApplies,
  );
  const [graceMinutes, setGraceMinutes] = useState(
    String(initialRules?.graceMinutes ?? DEFAULT_PUNCH_RULES.graceMinutes),
  );
  const [autoClockoutBufferMinutes, setAutoClockoutBufferMinutes] = useState(
    String(initialRules?.autoClockoutBufferMinutes ?? DEFAULT_PUNCH_RULES.autoClockoutBufferMinutes),
  );
  const [autoApprovalScoreThreshold, setAutoApprovalScoreThreshold] = useState(
    String(initialRules?.autoApprovalScoreThreshold ?? DEFAULT_PUNCH_RULES.autoApprovalScoreThreshold),
  );

  const applyToForm = (r: HrPunchRules) => {
    setRoundingMinutes(
      r.roundingMinutes === 5 || r.roundingMinutes === 10 || r.roundingMinutes === 15
        ? r.roundingMinutes
        : 0,
    );
    setRoundingApplies(r.roundingApplies);
    setGraceMinutes(String(r.graceMinutes));
    setAutoClockoutBufferMinutes(String(r.autoClockoutBufferMinutes));
    setAutoApprovalScoreThreshold(String(r.autoApprovalScoreThreshold));
  };

  useEffect(() => {
    if (!available || initialRules) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    kiosk
      .getPunchRules()
      .then((r) => {
        if (cancelled) return;
        setRules(r);
        applyToForm(r);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(errMessage(err, "Could not load punch rules."));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kiosk, available]);

  const save = async () => {
    const grace = Number(graceMinutes);
    const buffer = Number(autoClockoutBufferMinutes);
    const threshold = Number(autoApprovalScoreThreshold);
    if (!Number.isFinite(grace) || grace < 0 || grace > 60) {
      setError("Grace minutes must be between 0 and 60.");
      return;
    }
    if (!Number.isFinite(buffer) || buffer < 0 || buffer > 720) {
      setError("Auto-clock-out buffer must be between 0 and 720 minutes.");
      return;
    }
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) {
      setError("Auto-approval threshold must be between 0 and 100 (0 turns it off).");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await kiosk.savePunchRules({
        roundingMinutes,
        roundingApplies,
        graceMinutes: grace,
        autoClockoutBufferMinutes: buffer,
        autoApprovalScoreThreshold: threshold,
      });
      setRules(saved);
      setSavedAt(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
    } catch (err) {
      setError(errMessage(err, "Could not save punch rules."));
    } finally {
      setBusy(false);
    }
  };

  if (!available && !initialRules) {
    return (
      <section className="hub-card" aria-label="Clock settings" style={{ marginTop: 24 }}>
        <h3>Clock settings</h3>
        <p className="hub-sub">
          The kiosk time clock is still being set up — punch rules will be
          configurable here once it's live.
        </p>
      </section>
    );
  }

  return (
    <section className="hub-card" aria-label="Clock settings" style={{ marginTop: 24 }}>
      <h3>Clock settings</h3>
      <p className="hub-sub">
        How kiosk punches are rounded, when lateness is flagged, when the
        system clocks people out, and which timecards can auto-approve.
      </p>
      {error && <div className="hub-error" role="alert">{error}</div>}
      {loading ? (
        <p>Loading clock settings…</p>
      ) : (
        <>
          <div className="hub-summary-box" aria-live="polite" style={{ marginBottom: 12 }}>
            <strong>Active rules:</strong>{" "}
            {rules ? describePunchRules(rules) : "None configured yet."}
          </div>
          <div className="hub-form">
            <label>
              Rounding
              <select
                value={roundingMinutes}
                onChange={(e) => setRoundingMinutes(Number(e.target.value) as RoundingMinutes)}
              >
                {ROUNDING_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "No rounding — exact times" : `Nearest ${n} minutes`}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Rounding applies to
              <select
                value={roundingApplies}
                onChange={(e) => setRoundingApplies(e.target.value as HrPunchRules["roundingApplies"])}
              >
                <option value="payroll">Payroll only — staff see exact times</option>
                <option value="display_and_payroll">Display + payroll — staff see rounded times</option>
              </select>
            </label>
            <label>
              Grace minutes (late/early flags)
              <input
                type="number"
                min="0"
                max="60"
                value={graceMinutes}
                onChange={(e) => setGraceMinutes(e.target.value)}
              />
            </label>
            <label>
              Auto-clock-out buffer (minutes after shift end)
              <input
                type="number"
                min="0"
                max="720"
                value={autoClockoutBufferMinutes}
                onChange={(e) => setAutoClockoutBufferMinutes(e.target.value)}
              />
            </label>
            <label>
              Auto-approval score threshold (0 = off)
              <input
                type="number"
                min="0"
                max="100"
                value={autoApprovalScoreThreshold}
                onChange={(e) => setAutoApprovalScoreThreshold(e.target.value)}
              />
            </label>
          </div>
          <div className="hub-form-actions" style={{ marginTop: 12 }}>
            <button className="hub-btn primary" disabled={busy} onClick={save}>
              <Check size={16} /> Save clock settings
            </button>
            {savedAt && <span className="hub-sub">Saved at {savedAt}.</span>}
          </div>
        </>
      )}
    </section>
  );
}
