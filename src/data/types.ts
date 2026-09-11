import type { Category, Status } from "../domain";

export type AppRole =
  | "administrator"
  | "compliance_admin"
  | "manager"
  | "dsp";

export type DocumentKind = "pcsp" | "isp" | "policy" | "other";
export type ReviewStatus = "pending_review" | "active" | "archived";
export type PacketStatus = "open" | "archived";

export interface Agency {
  id: string;
  name: string;
  agencyCode: string;
}

export interface Program {
  id: string;
  agencyId: string;
  name: string;
}

export interface SiteRecord {
  id: string;
  agencyId: string;
  programId: string;
  name: string;
  address: string;
}

export interface Profile {
  id: string;
  fullName: string;
  email: string;
  jobTitle: string;
  username: string;
  homeAgencyId: string;
  mustChangePassword: boolean;
}

export interface Membership {
  id: string;
  agencyId: string;
  userId: string;
  role: AppRole;
  siteId: string | null;
}

export interface IndividualRecord {
  id: string;
  agencyId: string;
  siteId: string;
  fullName: string;
  dateOfBirth: string;
}

export interface StaffAssignment {
  id: string;
  agencyId: string;
  userId: string;
  individualId: string | null;
  siteId: string | null;
  startsOn: string;
  endsOn: string | null;
}

export interface DocumentRecord {
  id: string;
  agencyId: string;
  individualId: string;
  title: string;
  kind: DocumentKind;
}

export interface DocumentVersion {
  id: string;
  agencyId: string;
  documentId: string;
  versionLabel: string;
  status: ReviewStatus;
  storagePath: string | null;
  contentHash: string | null;
  pageCount: number;
  effectiveOn: string;
  expiresOn: string | null;
  createdBy: string | null;
}

export interface RequirementRecord {
  id: string;
  agencyId: string;
  documentVersionId: string | null;
  individualId: string | null;
  siteId: string;
  title: string;
  category: Category;
  ownerUserId: string | null;
  dueOn: string;
  frequency: string;
  sourcePage: number;
  status: Status;
  evidenceNote: string;
  completedAt?: string;
}

export interface AcknowledgmentPacket {
  id: string;
  agencyId: string;
  individualId: string;
  documentVersionId: string;
  whatAcknowledging: string;
  startsOn: string;
  endsOn: string | null;
  status: PacketStatus;
}

export interface AcknowledgmentRow {
  id: string;
  agencyId: string;
  packetId: string;
  userId: string;
  staffName: string;
  addedManually: boolean;
  addReason: string | null;
  openedAt: string | null;
  signedAt: string | null;
  signatureName: string | null;
  signatureMark: string | null;
}

export interface AuditEvent {
  id: string;
  agencyId: string;
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  detail: string;
  createdAt: string;
}

export interface SessionUser {
  userId: string;
  email: string;
  username: string;
  fullName: string;
  jobTitle: string;
  role: AppRole;
  agencyId: string;
  agencyName: string;
  agencyCode: string;
  siteId: string | null;
  mustChangePassword: boolean;
}

export interface LoginInput {
  agencyCode: string;
  username: string;
  password: string;
}

export interface InviteMemberInput {
  fullName: string;
  username: string;
  tempPassword: string;
  role: AppRole;
  jobTitle?: string;
  siteId?: string | null;
}

export interface InviteMemberResult {
  username: string;
  agencyCode: string;
  fullName: string;
  role: AppRole;
}

export interface PacketDetail {
  packet: AcknowledgmentPacket;
  individual: IndividualRecord;
  site: SiteRecord;
  version: DocumentVersion;
  document: DocumentRecord;
  rows: AcknowledgmentRow[];
}

export interface UploadDocumentInput {
  individualId: string;
  title?: string;
  kind?: DocumentKind;
  file: File;
  pageCount: number;
  effectiveOn: string;
  expiresOn?: string;
  requirementTitle?: string;
  category?: Category;
  ownerUserId?: string;
  dueOn?: string;
  frequency?: string;
  sourcePage?: number;
}

export const DEMO_PASSWORD = "Evergreen!demo1";

export const USERNAME_PATTERN = /^[a-z0-9.]{3,40}$/;

export const LOGIN_FAILED_MESSAGE =
  "That agency code, username, or password is not recognized.";

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeAgencyCode(value: string) {
  return value.trim().toUpperCase();
}
