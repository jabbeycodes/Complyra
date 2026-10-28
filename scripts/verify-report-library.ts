/**
 * Report Library smoke check: runs EVERY registry entry's runner against
 * the Evergreen demo seed in local mode and asserts a real PDF comes out.
 * This is the "no dead entries" proof — a catalog entry whose builder or
 * API path is broken fails here, by name.
 *
 * Run: npx tsx scripts/verify-report-library.ts
 */
import { LocalApi, MemoryStore } from "../src/data/localApi";
import { createEvergreenSeed, DEMO_AGENCY_CODE } from "../src/data/seed";
import { DEMO_PASSWORD } from "../src/data/types";
import { todayIso } from "../src/data/chart";
import { monthKeyFrom } from "../src/data/monthlyChecks";
import { REPORT_LIBRARY } from "../src/features/reports/reportLibrary";
import {
  listReportRecordOptions,
  REPORT_RUNNERS,
  type ReportRunContext,
  type ReportScopeSelection,
} from "../src/features/reports/reportRunners";

function daysAgoIso(days: number): string {
  const date = new Date(`${todayIso()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function signInAs(roleKey: string): Promise<ReportRunContext> {
  const seed = createEvergreenSeed();
  const membership = seed.memberships.find(
    (row) => row.agencyId === seed.agencies[0]?.id && row.roleKey === roleKey,
  );
  if (!membership) throw new Error(`No demo user with role ${roleKey}`);
  const profile = seed.profiles.find((row) => row.id === membership.userId);
  if (!profile) throw new Error(`No demo profile for role ${roleKey}`);
  const api = new LocalApi(new MemoryStore(structuredClone(seed)));
  const session = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: profile.username,
    password: DEMO_PASSWORD,
  });
  const workspace = await api.loadWorkspace(session);
  return { api, session, workspace };
}

async function main() {
  const contexts = new Map<string, ReportRunContext>();
  async function ctxFor(roleKey: string) {
    if (!contexts.has(roleKey)) contexts.set(roleKey, await signInAs(roleKey));
    return contexts.get(roleKey)!;
  }

  const passed: string[] = [];
  const failed: string[] = [];

  for (const def of REPORT_LIBRARY) {
    // Exercise each entry with the most specific role it allows that the
    // demo seed has (house_manager for the mileage sheets, else the first
    // listed role available in the seed).
    const roleKey =
      def.roles.find((role) => role === "house_manager" && def.module === "Mileage") ??
      def.roles.find((role) => ["administrator", "house_manager", "nurse"].includes(role)) ??
      def.roles[0];
    try {
      const ctx = await ctxFor(roleKey);
      if (ctx.workspace.sites.length === 0) throw new Error("demo workspace has no sites");

      const base: ReportScopeSelection = {
        monthKey: monthKeyFrom(todayIso()),
        year: Number(todayIso().slice(0, 4)),
        from: daysAgoIso(13),
        to: todayIso(),
        staffUserId: ctx.workspace.staff[0]?.id ?? null,
      };

      // Find a scope combination that has data, the way a user would:
      // walk homes, then the Individuals in each home, until the entry's
      // record picker (or the entry itself, for care-plan) has something
      // to run.
      let file: { blob: Blob; name: string } | null = null;
      let lastError: unknown = null;
      const candidateSites = def.scopes.includes("site") ? ctx.workspace.sites : [null];
      outer: for (const site of candidateSites) {
        const peopleHere = site
          ? ctx.workspace.individuals.filter((row) => row.siteId === site.id)
          : [];
        const candidateIndividuals = def.scopes.includes("individual")
          ? peopleHere
          : [null];
        for (const person of candidateIndividuals) {
          const attempt: ReportScopeSelection = {
            ...base,
            siteId: site?.id ?? null,
            individualId: person?.id ?? null,
          };
          if (def.recordKind) {
            const options = await listReportRecordOptions(ctx, def, attempt);
            if (options.length === 0) continue;
            attempt.recordId = options[0].id;
          }
          try {
            file = await REPORT_RUNNERS[def.id](ctx, attempt);
            break outer;
          } catch (err) {
            lastError = err;
          }
        }
      }
      if (!file) {
        throw lastError instanceof Error
          ? lastError
          : new Error("no runnable scope found in demo data");
      }
      const bytes = file.blob.size;
      if (!file.name.endsWith(".pdf") || bytes < 1000) {
        throw new Error(`suspicious output: ${file.name} (${bytes} bytes)`);
      }
      passed.push(`${def.id} — ${file.name} (${bytes} bytes, as ${roleKey})`);
    } catch (err) {
      failed.push(`${def.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  console.log(`Report Library smoke check — ${REPORT_LIBRARY.length} entries`);
  for (const line of passed) console.log(`  PASS ${line}`);
  for (const line of failed) console.log(`  FAIL ${line}`);
  console.log(`${passed.length} passed, ${failed.length} failed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
