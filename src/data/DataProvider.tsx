import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createApi, isSupabaseConfigured, type ComplyraApi, type WorkspaceView } from "./index";
import type { LoginInput, SessionUser } from "./types";

interface DataContextValue {
  api: ComplyraApi;
  session: SessionUser | null;
  workspace: WorkspaceView | null;
  loading: boolean;
  error: string;
  usingHostedBackend: boolean;
  signIn: (input: LoginInput) => Promise<void>;
  changePassword: (currentPassword: string, nextPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

function asErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

export function DataProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => createApi(), []);
  const usingHostedBackend = isSupabaseConfigured();
  const [session, setSession] = useState<SessionUser | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestId = useRef(0);

  async function refresh(nextSession?: SessionUser | null) {
    const request = ++requestId.current;
    try {
    const active = nextSession === undefined ? await api.getSession() : nextSession;
    if (request !== requestId.current) return;
    setSession(active);
    if (!active || active.mustChangePassword) {
      setWorkspace(null);
      return;
    }
    if (!active.platformAdmin && active.agencyStatus !== "active") {
      setWorkspace(null);
      return;
    }
      const view = await api.loadWorkspace(active);
      if (request !== requestId.current) return;
      setWorkspace(view);
      setError("");
    } catch (err) {
      if (request !== requestId.current) return;
      setWorkspace(null);
      setError(asErrorMessage(err, "Could not load the workspace."));
      throw err;
    }
  }

  useEffect(() => {
    let cancelled = false;
    const request = ++requestId.current;
    (async () => {
      try {
        const existing = await api.getSession();
        if (cancelled || request !== requestId.current) return;
        setSession(existing);
        if (
          existing &&
          !existing.mustChangePassword &&
          (existing.platformAdmin || existing.agencyStatus === "active")
        ) {
          const view = await api.loadWorkspace(existing);
          if (!cancelled && request === requestId.current) setWorkspace(view);
        }
      } catch (err) {
        if (!cancelled && request === requestId.current) {
          setError(asErrorMessage(err, "Could not load the workspace."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
      requestId.current++;
    };
  }, [api]);

  return (
    <DataContext.Provider
      value={{
        api,
        session,
        workspace,
        loading,
        error,
        usingHostedBackend,
        signIn: async (input) => {
          const request = ++requestId.current;
          setError("");
          setWorkspace(null);
          const next = await api.signIn(input);
          if (request !== requestId.current) return;
          setSession(next);
          await refresh(next);
        },
        changePassword: async (currentPassword, nextPassword) => {
          setError("");
          await api.changePassword(currentPassword, nextPassword);
          const next =
            (await api.getSession()) ??
            (session ? { ...session, mustChangePassword: false } : null);
          const ready = next ? { ...next, mustChangePassword: false } : null;
          if (!ready) {
            setSession(null);
            setWorkspace(null);
            return;
          }
          // Load the workspace before flipping mustChangePassword in UI so a
          // failed bootstrap cannot unmount the password form into an infinite
          // "Loading workspace…" spinner.
          try {
            await refresh(ready);
          } catch {
            // Password already changed. Surface the load error on the
            // workspace screen instead of trapping the user on the form.
          } finally {
            setSession(ready);
          }
        },
        signOut: async () => {
          requestId.current++;
          setWorkspace(null);
          await api.signOut();
          setSession(null);
          setWorkspace(null);
          setError("");
        },
        refresh: () => refresh(),
      }}
    >
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const value = useContext(DataContext);
  if (!value) throw new Error("useData must be used within DataProvider");
  return value;
}
