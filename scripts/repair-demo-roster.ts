/**
 * Re-runs the hosted Evergreen 2×2 roster repair (Cedar/Willow + four
 * Individuals). Requires SUPABASE_SERVICE_ROLE_KEY. Safe to call after
 * `supabase db push` has applied 20260915200000.
 *
 * Preview and production share one database; PR migrations do not auto-run.
 */
import { createClient } from "@supabase/supabase-js";

const url =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ynjthbdfuzkqrbvjuvwd.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY before repairing the demo roster.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.rpc("repair_evergreen_demo_roster");
if (error) {
  console.error(error.message);
  console.error("If the function is missing, run: npx supabase db push");
  process.exit(1);
}
console.log(JSON.stringify(data, null, 2));
