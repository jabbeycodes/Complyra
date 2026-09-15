/**
 * Restores the hosted Complyrer operator Auth identity so
 * COMPLYRER-MO / platform.owner / Evergreen!demo1 can sign in.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY. Does not rewrite Evergreen demo data.
 */
import { createClient } from "@supabase/supabase-js";
import { PLATFORM_AGENCY_ID, PLATFORM_USER_ID } from "../src/data/seed.ts";
import { DEMO_PASSWORD } from "../src/data/types.ts";

const url =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ynjthbdfuzkqrbvjuvwd.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY before repairing.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const EMAIL = "platform.owner@complyrer.com";
const USERNAME = "platform.owner";

async function main() {
  const { data: updated, error: updateError } = await admin.auth.admin.updateUserById(
    PLATFORM_USER_ID,
    {
      email: EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: {
        full_name: "Complyrer operator",
        username: USERNAME,
        job_title: "Platform owner",
        home_agency_id: PLATFORM_AGENCY_ID,
        must_change_password: false,
        email_verified: true,
      },
    },
  );
  if (updateError || !updated.user) {
    throw new Error(updateError?.message ?? "Could not update platform.owner Auth.");
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({
      email: EMAIL,
      username: USERNAME,
      full_name: "Complyrer operator",
      job_title: "Platform owner",
      home_agency_id: PLATFORM_AGENCY_ID,
      platform_admin: true,
      active: true,
      must_change_password: false,
    })
    .eq("id", PLATFORM_USER_ID);
  if (profileError) throw new Error(profileError.message);

  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", PLATFORM_USER_ID)
    .eq("agency_id", PLATFORM_AGENCY_ID)
    .maybeSingle();
  if (membershipError) throw new Error(membershipError.message);
  if (!membership) {
    const { error: insertError } = await admin.from("memberships").insert({
      agency_id: PLATFORM_AGENCY_ID,
      user_id: PLATFORM_USER_ID,
      role: "administrator",
      role_key: "administrator",
      site_id: null,
      expires_on: null,
    });
    if (insertError) throw new Error(insertError.message);
  }

  const identities = updated.user.identities ?? [];
  if (!identities.some((row) => row.provider === "email")) {
    throw new Error("platform.owner still has no email identity after repair.");
  }

  console.log(
    `Repaired ${EMAIL}. Hosted login: COMPLYRER-MO / ${USERNAME} / ${DEMO_PASSWORD}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
