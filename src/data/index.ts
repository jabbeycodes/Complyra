import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ComplyraApi, WorkspaceView } from "./localApi";
import { LocalApi } from "./localApi";
import { HostedApi } from "./hostedApi";

export function isSupabaseConfigured() {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}

export function createSupabaseBrowserClient(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}

/**
 * When hosted credentials are present, the browser is only a client.
 * The local workspace is used only for development and tests.
 */
export function createApi(): ComplyraApi {
  const client = createSupabaseBrowserClient();
  if (client) return new HostedApi(client);
  return new LocalApi();
}

export type { ComplyraApi, WorkspaceView };
