import type { SessionUser } from "./types";

/**
 * Stall watchdog for the workspace loading gate.
 *
 * The gate in App.tsx renders a bare "Loading workspace…" spinner while a
 * load is in flight and only shows its error card when the load REJECTS.
 * A request that never settles (a wedged session restore or workspace
 * fetch on a flaky connection) therefore trapped the user on the spinner
 * forever, with no escape short of killing the browser (verified live
 * 2026-11-01). This module tracks how long the gate has been continuously
 * unsettled; past the threshold the gate swaps the spinner for a recovery
 * card with Try again / Sign out. If the load lands late, the stall clears
 * and the app renders normally.
 */
export const WORKSPACE_LOAD_STALL_MS = 30_000;

export interface WorkspaceLoadState {
  loading: boolean;
  session: SessionUser | null;
  workspace: unknown | null;
  error: string;
}

/**
 * True while the app is sitting on a workspace loading gate with no
 * settled outcome: the initial session restore is still running, or a
 * session that should have a workspace is present but the workspace has
 * not arrived and no error has been recorded. Sessions that intentionally
 * have no workspace (password change required, agency not yet active)
 * never count — those render their own screens, not the spinner.
 */
export function workspaceLoadPending(state: WorkspaceLoadState): boolean {
  if (state.error) return false;
  if (state.workspace) return false;
  if (state.loading) return true;
  const session = state.session;
  if (!session) return false;
  if (session.mustChangePassword) return false;
  if (!session.platformAdmin && session.agencyStatus !== "active") return false;
  return true;
}

export interface StallScheduler {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const defaultScheduler: StallScheduler = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Fires `onChange(true)` once when `pending` has stayed true continuously
 * for the threshold, and `onChange(false)` when the load settles. Feed it
 * the pending flag on every state change via `update`.
 */
export class LoadStallWatchdog {
  private handle: unknown = null;
  private stalled = false;

  constructor(
    private readonly onChange: (stalled: boolean) => void,
    private readonly thresholdMs: number = WORKSPACE_LOAD_STALL_MS,
    private readonly scheduler: StallScheduler = defaultScheduler,
  ) {}

  update(pending: boolean) {
    if (!pending) {
      this.cancelTimer();
      if (this.stalled) {
        this.stalled = false;
        this.onChange(false);
      }
      return;
    }
    // Already counting down, or already stalled (e.g. a retry is running
    // from the stall card): keep the existing state.
    if (this.stalled || this.handle !== null) return;
    this.handle = this.scheduler.set(() => {
      this.handle = null;
      this.stalled = true;
      this.onChange(true);
    }, this.thresholdMs);
  }

  dispose() {
    this.cancelTimer();
  }

  get isStalled() {
    return this.stalled;
  }

  private cancelTimer() {
    if (this.handle !== null) {
      this.scheduler.clear(this.handle);
      this.handle = null;
    }
  }
}
