import type { SessionUser } from "./types";

/**
 * Wave 7N (simulation batches 76/78): who may see — and use — the sample
 * workspace reset.
 *
 * The reset wipes the local workspace back to the seed. It is a
 * destructive, workspace-level control, so the matrix is deliberately
 * narrow:
 *
 * | viewer                      | local/demo | hosted |
 * |-----------------------------|------------|--------|
 * | administrator               | visible    | hidden |
 * | every other role / signed out | hidden   | hidden |
 *
 * "Hidden" means the control does not render at all — never a disabled
 * button. In hosted mode there is no reset for anyone: hosted data lives
 * server-side (HostedApi.resetWorkspace throws as a backstop), and the
 * Settings "Advanced & data" section that carries the reset does not
 * render either, so no role is shown a "workspace reset" label for a
 * control that does not exist. LocalApi.resetWorkspace enforces the
 * administrator half of this matrix at the data boundary as well.
 */
export function canResetSampleWorkspace(
  session: Pick<SessionUser, "roleKey"> | null | undefined,
  usingHostedBackend: boolean,
): boolean {
  if (usingHostedBackend) return false;
  return session?.roleKey === "administrator";
}
