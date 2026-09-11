import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { createApi, type ComplyraApi, type WorkspaceView } from "./index";
import type { SessionUser } from "./types";

interface DataContextValue {
  api: ComplyraApi;
  session: SessionUser | null;
  workspace: WorkspaceView | null;
  loading: boolean;
  error: string;
  usingHostedBackend: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children }: { children: ReactNode }) {
  const api = useMemo(() => createApi(), []);
  const usingHostedBackend = Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
  const [session, setSession] = useState<SessionUser | null>(null);
  const [workspace, setWorkspace] = useState<WorkspaceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh(nextSession?: SessionUser | null) {
    const active = nextSession === undefined ? session : nextSession;
    if (!active) {
      setWorkspace(null);
      return;
    }
    const view = await api.loadWorkspace(active);
    setWorkspace(view);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const existing = await api.getSession();
        if (cancelled) return;
        setSession(existing);
        if (existing) {
          setWorkspace(await api.loadWorkspace(existing));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
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
        signIn: async (email, password) => {
          setError("");
          const next = await api.signIn(email, password);
          setSession(next);
          await refresh(next);
        },
        signOut: async () => {
          await api.signOut();
          setSession(null);
          setWorkspace(null);
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
