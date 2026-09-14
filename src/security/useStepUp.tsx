import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
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

/**
 * Shares one workspace-wide step-up instance with deep components (PDF
 * downloads, file opens) so every export path can require reauthentication
 * without prop-drilling. App creates the instance with useStepUp() and
 * provides requireStepUp here; the modal itself is still rendered once by
 * App. There is exactly one grace window for the whole workspace.
 */
const StepUpContext = createContext<{
  requireStepUp: (reason: StepUpReason) => Promise<boolean>;
} | null>(null);

export function StepUpProvider({
  requireStepUp,
  children,
}: {
  requireStepUp: (reason: StepUpReason) => Promise<boolean>;
  children: ReactNode;
}) {
  return (
    <StepUpContext.Provider value={{ requireStepUp }}>
      {children}
    </StepUpContext.Provider>
  );
}

/** requireStepUp for any component rendered inside the workspace. */
export function useStepUpContext() {
  const ctx = useContext(StepUpContext);
  if (!ctx) {
    throw new Error(
      "useStepUpContext must be used inside the workspace StepUpProvider.",
    );
  }
  return ctx;
}
