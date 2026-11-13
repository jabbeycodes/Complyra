/**
 * PCSP documents mount + gating (2026-11-12).
 *
 * The upload card and extraction review page lived unmounted while their
 * pageVisible gates, permission keys, and notification routes already
 * existed. These tests pin the mount in App.tsx and the role gates so the
 * screens cannot silently detach again:
 *  - "Document upload" follows documents.upload (admin/PM/HM templates).
 *  - "Extraction review" follows documents.review (admin/PM/RN templates).
 *  - The documents.ts selectors agree with pageVisible for every role.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canReviewDocuments, canUploadDocuments } from "./documents";
import { pageVisible } from "../../data/status";
import { ROLE_TEMPLATE_BY_KEY, type RoleKey } from "../../data/permissions";
import type { AppRole, SessionUser } from "../../data/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const APP_ROLE: Record<RoleKey, AppRole> = {
  administrator: "administrator",
  program_manager: "manager",
  house_manager: "manager",
  dsp: "dsp",
  nurse: "nurse",
  hr: "hr",
  auditor: "auditor",
};

/** Mirrors sign-in: the session carries the role template's permission map. */
function session(roleKey: RoleKey): SessionUser {
  return {
    userId: "u1",
    email: "user@example.com",
    username: "user",
    fullName: "Test User",
    jobTitle: "Staff",
    role: APP_ROLE[roleKey],
    roleKey,
    agencyId: "a1",
    agencyName: "Evergreen Care",
    agencyCode: "EVERGREEN-MO",
    siteId: null,
    mustChangePassword: false,
    expiresOn: null,
    permissions: { ...ROLE_TEMPLATE_BY_KEY[roleKey].permissions },
    platformAdmin: false,
    agencyStatus: "active",
  };
}

const UPLOAD_ROLES: RoleKey[] = ["administrator", "program_manager", "nurse", "house_manager"];
const REVIEW_ROLES: RoleKey[] = ["administrator", "program_manager", "nurse"];
const NO_ACCESS_ROLES: RoleKey[] = ["dsp", "auditor", "hr"];

test("pageVisible: Document upload follows documents.upload by role template", () => {
  for (const role of UPLOAD_ROLES) {
    assert.equal(pageVisible(session(role), "Document upload"), true, role);
  }
  for (const role of [...NO_ACCESS_ROLES]) {
    assert.equal(pageVisible(session(role), "Document upload"), false, role);
  }
});

test("pageVisible: Extraction review follows documents.review by role template", () => {
  for (const role of REVIEW_ROLES) {
    assert.equal(pageVisible(session(role), "Extraction review"), true, role);
  }
  // House managers may upload but never review.
  assert.equal(pageVisible(session("house_manager"), "Extraction review"), false);
  for (const role of NO_ACCESS_ROLES) {
    assert.equal(pageVisible(session(role), "Extraction review"), false, role);
  }
});

test("documents selectors agree with pageVisible for every role", () => {
  for (const role of [...UPLOAD_ROLES, ...NO_ACCESS_ROLES]) {
    const s = session(role);
    assert.equal(canUploadDocuments(s), pageVisible(s, "Document upload"), role);
    assert.equal(canReviewDocuments(s), pageVisible(s, "Extraction review"), role);
  }
  assert.equal(canUploadDocuments(null), false);
  assert.equal(canReviewDocuments(null), false);
});

test("App.tsx mounts the upload card and the extraction review page", () => {
  const app = readFileSync(join(root, "src", "App.tsx"), "utf8");
  // Nav entries (pageVisible hides them from roles without the keys).
  assert.match(app, /\["Document upload",/);
  assert.match(app, /\["Extraction review",/);
  // Render blocks wired to the flow state.
  assert.match(app, /page === "Document upload" && \(\s*<DocumentUploadCard onUploaded=/);
  assert.match(app, /page === "Extraction review" && \(\s*<ExtractionReviewPage/);
  assert.match(app, /initialUploadId=\{extractionUploadId\}/);
  assert.match(app, /onSelectUpload=\{setExtractionUploadId\}/);
});
