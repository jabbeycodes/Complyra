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
  process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey || !url) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before seeding.");
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
  await upsertOnConflict(table, rows, "id");
}

async function upsertOnConflict<T extends Record<string, unknown>>(
  table: string,
  rows: T[],
  onConflict: string,
) {
  if (!rows.length) return;
  const { error } = await admin.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function findAuthUserIdByEmail(email: string): Promise<string | undefined> {
  const needle = email.toLowerCase();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth list ${email}: ${error.message}`);
    const match = data.users.find((row) => row.email?.toLowerCase() === needle);
    if (match) return match.id;
    if (data.users.length < 200) return undefined;
  }
  return undefined;
}

function authMetadata(input: {
  username: string;
  fullName: string;
  jobTitle: string;
  homeAgencyId: string;
}) {
  return {
    full_name: input.fullName,
    username: input.username,
    job_title: input.jobTitle,
    home_agency_id: input.homeAgencyId,
    must_change_password: false,
    email_verified: true,
  };
}

async function setAuthPassword(userId: string, input: {
  email: string;
  username: string;
  fullName: string;
  jobTitle: string;
  homeAgencyId: string;
}) {
  // Always write the password + email identity. createUser with a fixed UUID
  // can leave auth.identities empty, which makes signInWithPassword fail.
  const { error } = await admin.auth.admin.updateUserById(userId, {
    email: input.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: authMetadata(input),
  });
  if (error) throw new Error(`auth ${input.email}: ${error.message}`);
}

async function ensureAuthUser(input: {
  id: string;
  email: string;
  username: string;
  fullName: string;
  jobTitle: string;
  homeAgencyId: string;
}): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    id: input.id,
    email: input.email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: authMetadata(input),
  });
  let userId = !error && data.user ? data.user.id : undefined;
  if (!userId) {
    if (!error || !/already been registered|already exists/i.test(error.message)) {
      throw new Error(`auth ${input.email}: ${error?.message ?? "could not create"}`);
    }
    userId = await findAuthUserIdByEmail(input.email);
    if (!userId) {
      throw new Error(`auth ${input.email}: already exists but could not be loaded`);
    }
  }
  await setAuthPassword(userId, input);
  return userId;
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

  const authIdBySeedId = new Map<string, string>();
  for (const profile of seed.profiles) {
    const authId = await ensureAuthUser({
      id: profile.id,
      email: profile.email,
      username: profile.username,
      fullName: profile.fullName,
      jobTitle: profile.jobTitle,
      homeAgencyId: profile.homeAgencyId,
    });
    authIdBySeedId.set(profile.id, authId);
  }
  const uid = (seedId: string | null | undefined) =>
    seedId ? (authIdBySeedId.get(seedId) ?? seedId) : seedId;

  await upsert(
    "profiles",
    seed.profiles.map((row) => ({
      id: uid(row.id),
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
  await upsertOnConflict(
    "memberships",
    seed.memberships.map((row) => ({
      agency_id: row.agencyId,
      user_id: uid(row.userId),
      role: row.role,
      role_key: row.roleKey ?? row.role,
      site_id: row.siteId,
      expires_on: row.expiresOn,
    })),
    "agency_id,user_id",
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
      user_id: uid(row.userId),
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
      created_by: uid(row.createdBy),
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
      owner_user_id: uid(row.ownerUserId),
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
  await upsertOnConflict(
    "individual_profiles",
    seed.individuals
      .filter((row) => row.profile)
      .map((row) => ({
        agency_id: row.agencyId,
        individual_id: row.id,
        profile: row.profile,
      })),
    "individual_id",
  );
  await upsert(
    "appointments",
    seed.appointments.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      individual_id: row.individualId,
      starts_on: row.startsOn,
      start_time: `${row.startTime}:00`,
      end_time: `${row.endTime}:00`,
      timezone: row.timezone,
      consultant: row.consultant,
      specialty: row.specialty,
      reason: row.reason,
      visit_address: row.visitAddress,
      created_by: uid(row.createdBy),
      created_by_name: row.createdByName,
      created_at: row.createdAt,
      updated_by: row.updatedBy ? uid(row.updatedBy) : null,
      updated_by_name: row.updatedByName,
      updated_at: row.updatedAt,
      deleted_by: row.deletedBy ? uid(row.deletedBy) : null,
      deleted_by_name: row.deletedByName,
      deleted_at: row.deletedAt,
      completed_by: row.completedBy ? uid(row.completedBy) : null,
      completed_by_name: row.completedByName,
      completed_at: row.completedAt,
      visit_comments: row.visitComments,
      consultation_file_id: row.consultationFileId,
    })),
  );
  await upsert(
    "acknowledgment_rows",
    seed.rows.map((row) => ({
      id: row.id,
      agency_id: row.agencyId,
      packet_id: row.packetId,
      user_id: uid(row.userId),
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
  console.log(
    `Operator login: agency COMPLYRER-MO / platform.owner / ${DEMO_PASSWORD}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
