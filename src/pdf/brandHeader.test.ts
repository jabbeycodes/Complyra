import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

/**
 * Founder rule (2026-11-02): every form/document the platform generates must
 * carry the generating agency's branding — agency logo when one is set,
 * agency name always — alongside the Complyrer mark. For PDFs the shared
 * pattern lives in this folder's brandHeader.ts (ReportBrand +
 * startBrandedDoc / drawBrandHeader + stampRecordMark). This pin fails CI
 * if a future PDF builder lands in src/pdf/ without referencing it, so an
 * unbranded generator cannot slip in silently.
 */
const pdfDir = fileURLToPath(new URL(".", import.meta.url));

// Intentional exceptions. Do not add a builder here without a founder-level
// reason — branding is the default, not the exception.
const EXCEPTIONS: Record<string, string> = {
  // The rights + consent packet builders are being rebuilt with branding by
  // the packet reformat wave; the consent drawer additionally runs inside
  // Supabase edge functions, where this module's jsPDF header cannot be
  // shared directly.
  "rightsPacketPdf.ts": "branding owned by the packet reformat wave",
  "consentPacketPdf.ts":
    "branding owned by the packet reformat wave; shared drawer also runs in edge functions",
};

test("every PDF builder module in src/pdf references the shared brandHeader pattern", () => {
  const builders = readdirSync(pdfDir).filter(
    (name) => name.endsWith("Pdf.ts") && name !== "brandHeader.ts",
  );
  assert.ok(builders.length > 0, "expected to find PDF builder modules");
  for (const name of builders) {
    if (name in EXCEPTIONS) continue;
    const source = readFileSync(join(pdfDir, name), "utf8");
    assert.match(
      source,
      /from "\.\/brandHeader"/,
      `${name} does not reference ./brandHeader — generated PDFs must use the shared branding pattern (agency logo when set, agency name always, Complyrer mark). If this builder is a genuine exception, record why in EXCEPTIONS in brandHeader.test.ts.`,
    );
  }
});
