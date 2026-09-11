import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ComplyraApi, WorkspaceView } from "./localApi";
import { LocalApi, MemoryStore } from "./localApi";
import type { SessionUser } from "./types";

export function isSupabaseConfigured() {
  return Boolean(
    import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY,
  );
}

export function createSupabaseBrowserClient() {
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
 * Hosted Supabase adapter. When credentials are missing, the schema-faithful
 * local workspace is used so the product loop can be developed and tested
 * without putting PHI in an unconfigured project.
 */
export class SupabaseApi extends LocalApi implements ComplyraApi {
  constructor(
    private readonly client: SupabaseClient,
    store?: MemoryStore,
  ) {
    super(store);
  }

  async getSession() {
    const { data } = await this.client.auth.getUser();
    if (!data.user) return super.getSession();
    return this.sessionFromUser(data.user.id, data.user.email ?? "");
  }

  async signIn(email: string, password: string) {
    const { error, data } = await this.client.auth.signInWithPassword({
      email,
      password,
    });
    if (error || !data.user) {
      return super.signIn(email, password);
    }
    const session = await this.sessionFromUser(data.user.id, data.user.email ?? email);
    if (!session) throw new Error("This account is not a member of an agency.");
    return session;
  }

  async signOut() {
    await this.client.auth.signOut();
    await super.signOut();
  }

  private async sessionFromUser(
    userId: string,
    email: string,
  ): Promise<SessionUser | null> {
    const { data: profile } = await this.client
      .from("profiles")
      .select("id, full_name, email, job_title")
      .eq("id", userId)
      .maybeSingle();
    const { data: membership } = await this.client
      .from("memberships")
      .select("agency_id, role, site_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!profile || !membership) return null;
    const { data: agency } = await this.client
      .from("agencies")
      .select("id, name")
      .eq("id", membership.agency_id)
      .single();
    return {
      userId: profile.id,
      email: profile.email || email,
      fullName: profile.full_name,
      jobTitle: profile.job_title,
      role: membership.role,
      agencyId: membership.agency_id,
      agencyName: agency?.name ?? "Agency",
      siteId: membership.site_id,
    };
  }
}

export function createApi(): ComplyraApi {
  const client = createSupabaseBrowserClient();
  if (client) return new SupabaseApi(client);
  return new LocalApi();
}

export type { ComplyraApi, WorkspaceView };
