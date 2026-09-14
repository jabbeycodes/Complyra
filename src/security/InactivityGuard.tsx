import { useCallback, useEffect, useRef, useState } from "react";
import { Modal } from "../components";
import {
  INACTIVITY_TIMEOUT_MS,
  INACTIVITY_WARNING_MS,
  inactivityPhase,
  logoffCountdownSeconds,
  type InactivityPhase,
} from "./inactivity";

/**
 * HIPAA §164.312(a)(2)(iii) — automatic logoff after 15 minutes of
 * inactivity.
 *
 * Wraps the authenticated workspace. Mouse, keyboard, touch, and scroll
 * activity reset the clock. During the final 60 seconds a warning modal
 * counts down; "Stay signed in" resets the clock, "Sign out now" (or the
 * countdown reaching zero) ends the session via onSignOut.
 */
export default function InactivityGuard({
  onSignOut,
  children,
}: {
  onSignOut: () => void;
  children: React.ReactNode;
}) {
  const lastActivityRef = useRef<number>(Date.now());
  const signedOutRef = useRef(false);
  const [phase, setPhase] = useState<InactivityPhase>("active");
  const [countdown, setCountdown] = useState(
    Math.ceil(INACTIVITY_WARNING_MS / 1000),
  );

  const touch = useCallback(() => {
    lastActivityRef.current = Date.now();
    setPhase((p) => (p === "active" ? p : "active"));
  }, []);

  useEffect(() => {
    const events: Array<keyof WindowEventMap> = [
      "mousedown",
      "keydown",
      "touchstart",
      "scroll",
    ];
    for (const name of events) {
      window.addEventListener(name, touch, { passive: true, capture: true });
    }
    const tick = window.setInterval(() => {
      const now = Date.now();
      const next = inactivityPhase(lastActivityRef.current, now);
      if (next === "expired") {
        if (!signedOutRef.current) {
          signedOutRef.current = true;
          onSignOut();
        }
        return;
      }
      setPhase(next);
      if (next === "warning") {
        setCountdown(logoffCountdownSeconds(lastActivityRef.current, now));
      }
    }, 1000);
    return () => {
      window.clearInterval(tick);
      for (const name of events) {
        window.removeEventListener(name, touch, true);
      }
    };
  }, [onSignOut, touch]);

  const staySignedIn = useCallback(() => {
    lastActivityRef.current = Date.now();
    setPhase("active");
  }, []);

  const signOutNow = useCallback(() => {
    if (!signedOutRef.current) {
      signedOutRef.current = true;
      onSignOut();
    }
  }, [onSignOut]);

  return (
    <>
      {children}
      {phase !== "active" && (
        <Modal title="Still there?" onClose={staySignedIn}>
          <div className="reauth-body">
            <p className="muted">
              You’ll be signed out for inactivity in{" "}
              <strong aria-live="polite">{countdown} seconds</strong> to protect
              the records on this device.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="button reauth-button"
                onClick={signOutNow}
              >
                Sign out now
              </button>
              <button
                type="button"
                className="button primary reauth-button"
                onClick={staySignedIn}
                autoFocus
              >
                Stay signed in
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

export { INACTIVITY_TIMEOUT_MS };
