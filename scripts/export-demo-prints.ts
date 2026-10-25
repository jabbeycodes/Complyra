/**
 * Writes the Evergreen walkthrough as the PDFs an agency would print.
 * Run: npm run demo:prints
 * Files land in demo-prints/ (not committed).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { todayIso, pcspTaskSummary } from "../src/data/chart";
import { addDaysIso } from "../src/data/hmChecklist";
import { LocalApi, MemoryStore } from "../src/data/localApi";
import { monthKeyFrom } from "../src/data/monthlyChecks";
import { buildConsultationPacketPdf, consultationPacketFileName } from "../src/pdf/consultationPacketPdf";
import { buildIndividualProfilePdf, individualProfileFileName } from "../src/pdf/individualProfilePdf";
import { buildMileageMonthPdf, mileageMonthFileName } from "../src/pdf/mileagePdf";
import { buildQaAuditPdf } from "../src/pdf/qaAuditPdf";
import { qaFileName } from "../src/data/qaAudit";
import { buildAcknowledgmentPdf } from "../src/pdf/acknowledgmentPdf";
import { buildComplianceReportPdf, complianceReportPdfName } from "../src/pdf/complianceReportPdf";
import { buildShiftNotesPdf, shiftNotesFileName } from "../src/pdf/shiftNotesPdf";
import { progressNoteName } from "../src/data/shiftNotes";
import { metrics } from "../src/domain";
import { siteLocationFrom } from "../src/data/siteAddress";
import { createEvergreenSeed, DEMO_AGENCY_CODE } from "../src/data/seed";
import { DEMO_PASSWORD } from "../src/data/types";

const OUT = join(process.cwd(), "demo-prints");

function folder(name: string) {
  return name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/(^-|-$)/g, "");
}

async function save(dir: string, name: string, bytes: Uint8Array | ArrayBuffer) {
  await mkdir(dir, { recursive: true });
  const path = join(dir, name);
  await writeFile(path, Buffer.from(bytes));
  return path;
}

async function saveBlob(dir: string, name: string, blob: Blob) {
  return save(dir, name, new Uint8Array(await blob.arrayBuffer()));
}

async function saveDoc(dir: string, name: string, doc: { output: (type: "arraybuffer") => ArrayBuffer }) {
  return save(dir, name, doc.output("arraybuffer"));
}

async function trySave(label: string, write: () => Promise<string>, written: string[], skipped: string[]) {
  try {
    written.push(await write());
  } catch (err) {
    skipped.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function main() {
  const store = new MemoryStore(structuredClone(createEvergreenSeed()));
  const api = new LocalApi(store);
  const session = await api.signIn({
    agencyCode: DEMO_AGENCY_CODE,
    username: "sarah.mitchell",
    password: DEMO_PASSWORD,
  });
  const workspace = await api.loadWorkspace(session);
  const today = todayIso();
  const month = monthKeyFrom(today);
  const from = addDaysIso(today, -13);
  const written: string[] = [];
  const skipped: string[] = [];
  const state = store.db.agencies.find((row) => row.id === session.agencyId)?.stateCode ?? "MO";

  const agencyDir = join(OUT, "agency");
  await trySave("compliance report", async () => {
    const card = metrics(workspace.requirements);
    const doc = buildComplianceReportPdf({
      agencyName: session.agencyName,
      reportDate: new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
      asOfDate: today,
      siteFilter: "All sites",
      score: card.score,
      total: card.total,
      done: card.done,
      overdue: card.overdue,
      dueSoon: card.dueSoon,
      review: card.review,
      requirements: workspace.requirements,
      demoMode: true,
      logoDataUrl: workspace.branding.logoUrl,
    });
    return saveDoc(agencyDir, complianceReportPdfName(session.agencyName, today), doc);
  }, written, skipped);

  for (const packet of workspace.packets) {
    await trySave(`acknowledgment ${packet.individual.fullName}`, async () => {
      const site = store.db.sites.find((row) => row.id === packet.site.id);
      const doc = buildAcknowledgmentPdf(
        session.agencyName,
        packet,
        workspace.branding.logoUrl,
        siteLocationFrom(site, state),
      );
      return saveDoc(agencyDir, `acknowledgment-${folder(packet.individual.fullName)}.pdf`, doc);
    }, written, skipped);
  }

  for (const site of workspace.sites) {
    const dir = join(OUT, folder(site.name));
    const people = workspace.individuals.filter((person) => person.siteId === site.id);
    const siteRow = store.db.sites.find((row) => row.id === site.id);
    const location = siteLocationFrom(siteRow, state);

    await trySave(`mileage ${site.name}`, async () => {
      const ids = people.map((person) => person.id);
      const trips = await api.listMileageTrips(site.id, month);
      const summary = await api.getMileageMonthlySummary(site.id, month, ids);
      const doc = buildMileageMonthPdf({
        agencyName: session.agencyName,
        siteName: site.name,
        monthKey: month,
        people: people.map((person) => ({ id: person.id, name: person.name })),
        trips,
        totalMiles: summary.totalMiles,
        milesByIndividualId: Object.fromEntries(summary.individualTotals.map((row) => [row.individualId, row.miles])),
        siteLocation: location,
      });
      return saveDoc(dir, mileageMonthFileName(site.name, month), doc);
    }, written, skipped);

    for (const kind of ["drills", "safety"] as const) {
      await trySave(`${kind} ${site.name}`, async () => {
        const file = await api.downloadMonthlyCheck({ kind, id: site.id, monthKey: month });
        return saveBlob(dir, file.name, file.blob);
      }, written, skipped);
    }
    await trySave(`drill schedule ${site.name}`, async () => {
      const file = await api.downloadDrillSchedule({ siteId: site.id, year: Number(today.slice(0, 4)) });
      return saveBlob(dir, file.name, file.blob);
    }, written, skipped);
    await trySave(`checklists ${site.name}`, async () => {
      const file = await api.downloadHmChecklists({ siteId: site.id, monthKey: null });
      return saveBlob(dir, file.name, file.blob);
    }, written, skipped);
    await trySave(`service logs ${site.name}`, async () => {
      const file = await api.downloadServiceLogs({ siteId: site.id, monthKey: null });
      return saveBlob(dir, file.name, file.blob);
    }, written, skipped);
    for (const checklist of store.db.weeklyChecklists.filter((row) => row.siteId === site.id && row.status === "submitted")) {
      await trySave(`weekly checklist ${site.name} ${checklist.weekOf}`, async () => {
        const file = await api.exportWeeklyChecklistPdf(checklist.id);
        return saveBlob(dir, file.name, file.blob);
      }, written, skipped);
      await trySave(`service log ${site.name} ${checklist.weekOf}`, async () => {
        const file = await api.exportWeeklyServiceLogPdf(checklist.id);
        return saveBlob(dir, file.name, file.blob);
      }, written, skipped);
    }
    await trySave(`site review ${site.name}`, async () => {
      const file = await api.downloadSiteReviewPdf(site.id);
      return saveBlob(dir, file.name, file.blob);
    }, written, skipped);
    await trySave(`pre-survey ${site.name}`, async () => {
      const file = await api.downloadPreSurveyPdf(site.id);
      return saveBlob(dir, file.name, file.blob);
    }, written, skipped);

    const audits = await api.listQaAudits({ siteId: site.id });
    for (const audit of audits.filter((row) => row.status === "finalized")) {
      await trySave(`qa ${site.name}`, async () => {
        const full = await api.getQaAudit(audit.id);
        const items = await api.getQaAuditItems(audit.id);
        if (!full) throw new Error("Audit missing.");
        const doc = buildQaAuditPdf({
          agencyName: session.agencyName,
          siteName: site.name,
          audit: full,
          items,
          logoDataUrl: workspace.branding.logoUrl,
          siteLocation: location,
        });
        return saveDoc(dir, qaFileName(site.name, full.year, full.quarter), doc);
      }, written, skipped);
    }
  }

  for (const person of workspace.individuals) {
    const dir = join(OUT, folder(person.name));
    const stack = workspace.planStacks.find((row) => row.individualId === person.id);
    const profile = stack?.profile ?? person.profile;
    if (profile) {
      await trySave(`profile ${person.name}`, async () => {
        const generatedAt = new Date().toISOString();
        const summary = pcspTaskSummary([...(stack?.required ?? []), ...(stack?.checked ?? [])]);
        const managers = workspace.staff.filter(
          (member) =>
            ["house_manager", "program_manager"].includes(member.roleKey) &&
            member.siteId === person.siteId,
        );
        const doc = buildIndividualProfilePdf({
          agencyName: session.agencyName,
          legalName: profile.legalName.trim() || person.name,
          goesBy: profile.goesBy,
          dmhId: profile.dmhId,
          siteName: person.site,
          dateOfBirth: person.dateOfBirth,
          pcspActive: summary.active,
          pcspCompleted: summary.completed,
          pcspTasks: summary.tasks,
          diagnosis: profile.diagnosis,
          medications: (stack?.medications ?? []).map((med) => ({
            name: med.name,
            strength: med.strength,
            kind: med.kind,
          })),
          agencyContacts: managers.map((member) => ({ name: member.name, role: `${member.role} · ${person.site}` })),
          guardians: profile.guardians,
          providers: profile.providerContacts,
          generatedByName: session.fullName,
          generatedAt,
          logoDataUrl: workspace.branding.logoUrl,
        });
        return saveDoc(dir, individualProfileFileName(person.name, generatedAt), doc);
      }, written, skipped);
    }

    await trySave(`isp notes ${person.name}`, async () => {
      const isp = await api.getIspData(person.id);
      const notes = isp.notes.filter((note) => note.noteDate >= from && note.noteDate <= today);
      const levelLabels: Record<string, { shortLabel: string; caption: string }> = {};
      for (const method of isp.scoringMethods) {
        for (const level of method.levels) {
          levelLabels[level.id] = { shortLabel: level.shortLabel, caption: level.caption };
        }
      }
      const program = isp.programs.find((row) => notes.some((note) => note.programId === row.id)) ?? isp.programs[0];
      const doc = buildShiftNotesPdf({
        agencyName: session.agencyName,
        individualName: progressNoteName(profile?.legalName.trim() || person.name),
        dateOfBirth: person.dateOfBirth,
        siteName: person.site,
        programName: program?.name ?? notes[0]?.programName ?? "ISP program",
        from,
        to: today,
        notes,
        levelLabels,
        generatedByName: session.fullName,
        generatedAt: new Date().toISOString(),
        logoDataUrl: workspace.branding.logoUrl,
      });
      return saveDoc(dir, shiftNotesFileName(person.name, from, today), doc);
    }, written, skipped);

    await trySave(`equipment ${person.name}`, async () => {
      const file = await api.downloadMonthlyCheck({ kind: "equipment", id: person.id, monthKey: month });
      return saveBlob(dir, file.name, file.blob);
    }, written, skipped);

    for (const appointment of store.db.appointments.filter(
      (row) => row.individualId === person.id && !row.deletedAt && row.visitComments.trim(),
    )) {
      if (!profile) continue;
      await trySave(`consultation ${person.name} ${appointment.startsOn}`, async () => {
        const doc = buildConsultationPacketPdf({
          agencyName: session.agencyName,
          individualName: person.name,
          dateOfBirth: person.dateOfBirth,
          siteName: person.site,
          programName: workspace.sites.find((row) => row.id === person.siteId)?.program ?? "",
          profile,
          appointment,
          medications: stack?.medications ?? [],
          generatedByName: session.fullName,
          generatedAt: new Date().toISOString(),
          logoDataUrl: workspace.branding.logoUrl,
        });
        return saveDoc(dir, consultationPacketFileName(person.name, appointment.startsOn), doc);
      }, written, skipped);
    }

    for (const checklist of store.db.trainingChecklists.filter((row) => row.individualId === person.id)) {
      await trySave(`training ${checklist.staffName} ${person.name}`, async () => {
        const file = await api.getChartFile({ type: "training", id: checklist.id });
        if (!file) throw new Error("Training sheet missing.");
        return saveBlob(dir, file.name, file.blob);
      }, written, skipped);
    }

    const docs = store.db.documents.filter((row) => row.individualId === person.id);
    const versions = store.db.versions
      .filter((row) => docs.some((doc) => doc.id === row.documentId))
      .sort((a, b) => b.effectiveOn.localeCompare(a.effectiveOn));
    const latest = versions[0];
    if (latest) {
      await trySave(`care plan ${person.name}`, async () => {
        const file = await api.getChartFile({ type: "version", id: latest.id });
        if (!file) throw new Error("Care plan missing.");
        return saveBlob(dir, file.name, file.blob);
      }, written, skipped);
    }

    for (const item of store.db.obligations.filter((row) => row.individualId === person.id && row.delegationForm && row.enabled)) {
      await trySave(`delegation ${person.name}`, async () => {
        const file = await api.getDelegationPdf({ obligationId: item.id });
        return saveBlob(dir, file.name, file.blob);
      }, written, skipped);
    }
  }

  const lines = [
    `Evergreen Care print packet · ${today}`,
    `${written.length} files`,
    ...written.map((path) => path.replace(process.cwd() + "/", "")),
    "",
    skipped.length ? "Skipped" : "Nothing skipped",
    ...skipped,
  ];
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "index.txt"), lines.join("\n"));
  console.log(lines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
