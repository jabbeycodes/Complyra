import { todayIso, daysBetween } from "./chart";

// LIFEPATH-P4 (certificates): pure certificate expiry logic shared by the
// local/hosted APIs and the HR UI. No side effects, easy to unit test.

/** Well-known certificate kinds HR tracks (CPR, CPI, PBS, L1MA) — free text allowed. */
export const CERTIFICATE_KINDS = ["CPR", "CPI", "PBS", "L1MA"] as const;

export const CERTIFICATE_MAX_BYTES = 10 * 1024 * 1024;

/** Whole days from `today` until `expiresOn` (ISO yyyy-mm-dd). Negative = expired. */
export function daysRemaining(expiresOn: string, today: string = todayIso()): number {
  return daysBetween(today, expiresOn.slice(0, 10));
}

export type CertExpiryStatus = "ok" | "watch" | "due" | "expired";

/**
 * Color-coded expiry status:
 * ok      = green, more than 90 days left
 * watch   = amber, 31–90 days left
 * due     = red, 30 days or fewer left (but not yet expired)
 * expired = grey, past the renewal date
 */
export function certExpiryStatus(remaining: number): CertExpiryStatus {
  if (remaining < 0) return "expired";
  if (remaining <= 30) return "due";
  if (remaining <= 90) return "watch";
  return "ok";
}

export function certCountdownLabel(remaining: number): string {
  if (remaining < 0) return `Expired ${Math.abs(remaining)}d ago`;
  if (remaining === 0) return "Expires today";
  if (remaining === 1) return "1 day left";
  return `${remaining} days left`;
}

export const CERT_STATUS_CLASS: Record<CertExpiryStatus, string> = {
  ok: "badge on-track",
  watch: "badge due-soon",
  due: "badge overdue",
  expired: "badge expired",
};

export function validateCertificateDates(issuedOn: string, expiresOn: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedOn) || Number.isNaN(Date.parse(issuedOn))) {
    throw new Error("Enter a valid issue date.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresOn) || Number.isNaN(Date.parse(expiresOn))) {
    throw new Error("Enter a valid renewal date.");
  }
  if (expiresOn < issuedOn) {
    throw new Error("The renewal date cannot be before the issue date.");
  }
}

export function validateCertificateFile(file: File): void {
  const okType =
    file.type === "application/pdf" ||
    file.type === "image/png" ||
    file.type === "image/jpeg" ||
    file.name.toLowerCase().endsWith(".pdf");
  if (!okType) {
    throw new Error("Choose a PDF or image scan of the certificate.");
  }
  if (file.size > CERTIFICATE_MAX_BYTES) {
    throw new Error("Choose a certificate file smaller than 10 MB.");
  }
}
