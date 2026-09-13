import { test } from "node:test";
import assert from "node:assert/strict";
import {
  certCountdownLabel,
  certExpiryStatus,
  daysRemaining,
  validateCertificateDates,
  validateCertificateFile,
} from "./certificates";

test("daysRemaining counts whole days from today to the renewal date", () => {
  assert.equal(daysRemaining("2026-12-31", "2026-09-13"), 109);
  assert.equal(daysRemaining("2026-09-13", "2026-09-13"), 0);
  assert.equal(daysRemaining("2026-09-01", "2026-09-13"), -12);
});

test("certExpiryStatus color-codes the countdown", () => {
  assert.equal(certExpiryStatus(91), "ok");
  assert.equal(certExpiryStatus(90), "watch");
  assert.equal(certExpiryStatus(31), "watch");
  assert.equal(certExpiryStatus(30), "due");
  assert.equal(certExpiryStatus(1), "due");
  assert.equal(certExpiryStatus(0), "due");
  assert.equal(certExpiryStatus(-1), "expired");
});

test("certCountdownLabel reads naturally", () => {
  assert.equal(certCountdownLabel(120), "120 days left");
  assert.equal(certCountdownLabel(1), "1 day left");
  assert.equal(certCountdownLabel(0), "Expires today");
  assert.equal(certCountdownLabel(-5), "Expired 5d ago");
});

test("validateCertificateDates rejects bad or inverted dates", () => {
  assert.doesNotThrow(() => validateCertificateDates("2025-01-01", "2026-01-01"));
  assert.throws(
    () => validateCertificateDates("2025-01-01", "2024-12-31"),
    /cannot be before the issue date/,
  );
  assert.throws(() => validateCertificateDates("not-a-date", "2026-01-01"), /issue date/);
  assert.throws(() => validateCertificateDates("2025-01-01", "nope"), /renewal date/);
});

function fakeFile(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

test("validateCertificateFile enforces type and 10 MB limit", () => {
  assert.doesNotThrow(() => validateCertificateFile(fakeFile("cpr.pdf", "application/pdf", 1024)));
  assert.doesNotThrow(
    () => validateCertificateFile(fakeFile("scan.png", "image/png", 10 * 1024 * 1024)),
  );
  assert.throws(
    () => validateCertificateFile(fakeFile("notes.txt", "text/plain", 100)),
    /PDF or image/,
  );
  assert.throws(
    () => validateCertificateFile(fakeFile("big.pdf", "application/pdf", 10 * 1024 * 1024 + 1)),
    /10 MB/,
  );
});
