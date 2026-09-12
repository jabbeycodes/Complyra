/**
 * Seeds the fictional Evergreen Care tenant into a hosted Supabase project.
 * Requires SUPABASE_SERVICE_ROLE_KEY. Never put that key in VITE_* or the browser.
 *
 * A second real agency can be inserted later with a different agency_code.
 * This script only creates Evergreen.
 */
import { createClient } from "@supabase/supabase-js";
import { AGENCY_ID, createEvergreenSeed } from "../src/data/seed.ts";
import { requirementStatusToDb } from "../src/data/status.ts";
import { DEMO_PASSWORD } from "../src/data/types.ts";

const url =
  process.env.SUPABASE_URL ??
  process.env.VITE_SUPABASE_URL ??
  "https://ynjthbdfuzkqrbvjuvwd.supabase.co";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY before seeding.");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const seed = createEvergreenSeed();

async function upsert<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
) {
  if (!rows.length) return;
  const { error } = await admin.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function ensureAuthUser(input: {
  id: string;
  email: string;
  username: string;
  fullName: string;
  jobTitle: string;
}) {
  const { error } = await admin.auth.admin.createUser({
    id: input.id,
    email: input.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: {
      full_name: input.fullName,
      username: input.username,
      job_title: input.jobTitle,
      home_agency_id: AGENCY_ID,
      must_change_password: false,
    },
  });
  if (error && !/already been registered|already exists/i.test(error.message)) {
    throw new Error(`auth ${input.email}: ${error.message}`);
  }
}

async function main() {
  await upsert(
    "agencies",
    seed.agencies.map((row) => ({
      id: row.id,
      name: row.name,
      agency_code: row.agencyCode,
      state_code: row.stateCode,
      provisioned_by: row.provisionedBy ?? "platform",
      status: row.status ?? "active",
    })),
  );

  for (const profile of seed.profiles) {
    await ensureAuthUser({
      id: profile.id,
      email: profile.email,
      username: profile.username,
      fullName: profile.fullName,
      jobTitle: profile.jobTitle,
    });
  }

  await upsert(
    "profiles",
    seed.profiles.map((row) => ({
      id: row.id,
      full_name: row.fullName,
      email: row.email,
      job_title: row.jobTitle,
      username: row.username,
      home_agency_id: row.homeAgencyId,
      must_change_password: false,
      platform_admin: Boolean(row.platformAdmin),
      active: true,
    })),
  );

  await upsert(
    "programs",
    seed.programs.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      name: row.name,
    })),
  );
  await upsert(
    "sites",
    seed.sites.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      program_id: row.programId,
      name: row.name,
      address: row.address,
    })),
  );
  await upsert(
    "memberships",
    seed.memberships.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      user_id: row.userId,
      role: row.role,
      role_key: row.roleKey ?? row.role,
      site_id: row.siteId,
      expires_on: row.expiresOn,
    })),
  );
  await upsert(
    "individuals",
    seed.individuals.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      site_id: row.siteId,
      full_name: row.fullName,
      date_of_birth: row.dateOfBirth,
    })),
  );
  await upsert(
    "staff_assignments",
    seed.assignments.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      user_id: row.userId,
      individual_id: row.individualId,
      site_id: row.siteId,
      starts_on: row.startsOn,
      ends_on: row.endsOn,
    })),
  );
  await upsert(
    "documents",
    seed.documents.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      individual_id: row.individualId,
      title: row.title,
      kind: row.kind,
    })),
  );
  await upsert(
    "document_versions",
    seed.versions.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      document_id: row.documentId,
      version_label: row.versionLabel,
      status: row.status,
      storage_path: row.storagePath,
      content_hash: row.contentHash,
      page_count: row.pageCount,
      effective_on: row.effectiveOn,
      expires_on: row.expiresOn,
      created_by: row.createdBy,
    })),
  );
  await upsert(
    "requirement_definitions",
    seed.requirements.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      document_version_id: row.documentVersionId,
      individual_id: row.individualId,
      site_id: row.siteId,
      title: row.title,
      category: row.category,
      owner_user_id: row.ownerUserId,
      due_on: row.dueOn,
      frequency: row.frequency,
      source_page: row.sourcePage,
      status: requirementStatusToDb(row.status),
      evidence_note: row.evidenceNote,
      completed_at: row.completedAt ?? null,
    })),
  );
  await upsert(
    "acknowledgment_packets",
    seed.packets.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      individual_id: row.individualId,
      document_version_id: row.documentVersionId,
      what_acknowledging: row.whatAcknowledging,
      starts_on: row.startsOn,
      ends_on: row.endsOn,
      status: row.status,
    })),
  );
  await upsert(
    "acknowledgment_rows",
    seed.rows.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      packet_id: row.packetId,
      user_id: row.userId,
      staff_name: row.staffName,
      added_manually: row.addedManually,
      add_reason: row.addReason,
      opened_at: row.openedAt,
      signed_at: row.signedAt,
      signature_name: row.signatureName,
      signature_mark: row.signatureMark,
    })),
  );

  console.log(
    `Seeded Evergreen Care (${AGENCY_ID}). Demo login: agency EVERGREEN-MO / sarah.mitchell / ${DEMO_PASSWORD}`,
  );
  console.log("A second agency can be added later with a different agency_code.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
