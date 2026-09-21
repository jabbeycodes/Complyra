import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ComplyraApi, WorkspaceView } from "./localApi";
import { LocalApi } from "./localApi";
import { HostedApi } from "./hostedApi";

/** import.meta.env is undefined outside a Vite bundle (e.g. node tests).
 * Access import.meta.env directly — assigning import.meta to a variable
 * first defeats Vite's static env replacement and silently drops every
 * VITE_* variable from production bundles (the app then falls back to the
 * local workspace instead of hosted Supabase). */
function viteEnv(): Record<string, string | undefined> {
  return import.meta.env ?? {};
}

export function isSupabaseConfigured() {
  const env = viteEnv();
  return Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY);
}

export function createSupabaseBrowserClient(): SupabaseClient | null {
  const env = viteEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
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
