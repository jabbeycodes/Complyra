/**
 * Restores city / county / zip on hosted Evergreen houses without
 * renaming the roster. Maple/Oakwood and Cedar/Willow both map.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY. Does not run seed:evergreen.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { EVERGREEN_DEMO_HOUSES } from "../src/data/evergreenSiteAddress.ts";
import { normalizeSiteFacts, type SiteFacts } from "../src/data/siteReview.ts";
import { AGENCY_ID } from "../src/data/seed.ts";

const url =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ynjthbdfuzkqrbvjuvwd.supabase.co";

export async function repairEvergreenSiteLocality(
  admin: SupabaseClient,
): Promise<Array<{ name: string; address: string; city: string; zip: string }>> {
  const { data: sites, error: siteError } = await admin
    .from("sites")
    .select("id,name,address,agency_id")
    .eq("agency_id", AGENCY_ID);
  if (siteError) throw new Error(`sites: ${siteError.message}`);

  const repaired: Array<{ name: string; address: string; city: string; zip: string }> = [];

  for (const site of sites ?? []) {
    const locality = EVERGREEN_DEMO_HOUSES[site.name as string];
    if (!locality) continue;

    const { data: existing, error: factsError } = await admin
      .from("site_facts")
      .select("facts")
      .eq("site_id", site.id)
      .maybeSingle();
    if (factsError) throw new Error(`site_facts ${site.name}: ${factsError.message}`);

    const merged: SiteFacts = normalizeSiteFacts({
      ...((existing?.facts as Partial<SiteFacts> | null) ?? {}),
      city: locality.city,
      county: locality.county,
      zip: locality.zip,
      sitePhone: locality.sitePhone,
      contactName: locality.contactName,
      contactPhone: locality.contactPhone,
    });

    const { error: upsertError } = await admin.from("site_facts").upsert(
      {
        site_id: site.id,
        agency_id: site.agency_id,
        facts: merged,
      },
      { onConflict: "site_id" },
    );
    if (upsertError) throw new Error(`upsert ${site.name}: ${upsertError.message}`);

    repaired.push({
      name: site.name as string,
      address: site.address as string,
      city: merged.city,
      zip: merged.zip,
    });
  }

  return repaired;
}

async function main() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    console.error("Set SUPABASE_SERVICE_ROLE_KEY before repairing site addresses.");
    process.exit(1);
  }
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const repaired = await repairEvergreenSiteLocality(admin);
  console.log(JSON.stringify({ repaired }, null, 2));
}

const invokedDirectly = process.argv[1]?.includes("repair-site-addresses");
if (invokedDirectly) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
