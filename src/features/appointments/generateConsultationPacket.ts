import type { Appointment } from "../../data/appointments";
import type { Medication } from "../../data/chart";
import type { WorkspaceView } from "../../data/localApi";
import { openPrintable } from "../../data/openFile";
import type { IndividualProfile } from "../../data/planStack";
import type { SessionUser } from "../../data/types";
import {
  buildConsultationPacketPdf,
  consultationPacketFileName,
} from "../../pdf/consultationPacketPdf";

export async function generateConsultationPacket(input: {
  recordGenerated: (appointmentId: string) => Promise<void>;
  session: SessionUser;
  workspace: WorkspaceView;
  person: { name: string; dateOfBirth: string; site: string; siteId: string };
  profile: IndividualProfile;
  appointment: Appointment;
  medications: Medication[];
  mode: "download" | "print";
}) {
  const generatedAt = new Date().toISOString();
  await input.recordGenerated(input.appointment.id);
  const site = input.workspace.sites.find((row) => row.id === input.person.siteId);
  const doc = buildConsultationPacketPdf({
    agencyName: input.session.agencyName,
    individualName: input.person.name,
    dateOfBirth: input.person.dateOfBirth,
    siteName: input.person.site,
    programName: site?.program ?? "",
    profile: input.profile,
    appointment: input.appointment,
    medications: input.medications,
    generatedByName: input.session.fullName,
    generatedAt,
    logoDataUrl: input.workspace.branding.logoUrl ?? null,
  });
  await openPrintable(
    consultationPacketFileName(input.person.name, input.appointment.startsOn),
    doc.output("blob") as Blob,
    input.mode,
  );
}
