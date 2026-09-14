import { useCallback, useRef, useState } from "react";
import ReauthSheet from "../features/signatures/ReauthSheet";
import { stepUpIsFresh } from "./stepUp";

export type StepUpReason = "individual-chart" | "export";

const REASON_COPY: Record<StepUpReason, string> = {
  "individual-chart":
    "You’re about to open a complete individual record. Enter your account " +
    "password to confirm it’s you — one confirmation covers about five " +
    "minutes of sensitive actions.",
  export:
    "You’re about to export data out of Complyrer. Enter your account " +
    "password to confirm it’s you — one confirmation covers about five " +
    "minutes of sensitive actions.",
};

interface PendingStepUp {
  reason: StepUpReason;
  resolve: (ok: boolean) => void;
}

/**
 * Step-up reauthentication for sensitive actions. `requireStepUp(reason)`
 * resolves true when the action may proceed (fresh grace window or a
 * successful password confirmation) and false when the user cancels.
 * Render `stepUpModal` next to the other workspace modals.
 */
export function useStepUp() {
  const [pending, setPending] = useState<PendingStepUp | null>(null);
  const pendingRef = useRef<PendingStepUp | null>(null);
  const lastVerifiedRef = useRef<number | null>(null);

  const settle = useCallback((ok: boolean) => {
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    p?.resolve(ok);
  }, []);

  const requireStepUp = useCallback(
    (reason: StepUpReason): Promise<boolean> => {
      if (stepUpIsFresh(lastVerifiedRef.current, Date.now())) {
        return Promise.resolve(true);
      }
      return new Promise<boolean>((resolve) => {
        const p = { reason, resolve };
        pendingRef.current = p;
        setPending(p);
      });
    },
    [],
  );

  const handleVerified = useCallback(() => {
    lastVerifiedRef.current = Date.now();
    settle(true);
  }, [settle]);

  const handleClose = useCallback(() => settle(false), [settle]);

  const stepUpModal = pending ? (
    <ReauthSheet
      title="Confirm it’s you"
      description={REASON_COPY[pending.reason]}
      confirmLabel="Confirm"
      onVerified={handleVerified}
      onClose={handleClose}
    />
  ) : null;

  return { requireStepUp, stepUpModal };
}
