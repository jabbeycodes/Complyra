/**
 * E-signature primitives shared by the data layer (LocalApi + HostedApi) and
 * the signature UI. The hash/canonicalization contract below MUST be mirrored
 * by the `apply-signature` edge function (Deno) byte-for-byte:
 *
 *   documentHash = sha256Hex(canonicalJson(payload))
 *
 * where canonicalJson is a recursive key-sorted JSON.stringify with no
 * whitespace, and sha256Hex is lowercase hex of the SHA-256 digest. The hash
 * covers the canonical document PAYLOAD only (not documentType/documentId/
 * fieldName) — those travel as separate event columns.
 */

/** Current ESIGN/UETA consent text version. Bumped whenever the text changes. */
export const ESIGN_CONSENT_VERSION = "2026-09-13-v1";

export const ESIGN_CONSENT_TEXT =
  "I agree to use electronic records and signatures in Complyrer. I understand that my electronic signature and initials have the same legal effect as my handwritten signature, and I consent to do business electronically. I understand I may withdraw this consent by contacting my administrator.";

/** Max adopted/uploaded signature image size (task constraint). */
export const SIGNATURE_MAX_BYTES = 200 * 1024;

/** Marker stored in legacy signatureMark columns for adopted-signature signings. */
export const ADOPTED_SIGNATURE_MARK = "adopted-signature";

/** Recursively key-sorted JSON stringify. Arrays keep their order. */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const parts = keys.map(
      (key) =>
        `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    );
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** SHA-256 hex digest via WebCrypto (available in browsers and Node 19+). */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * The exact hash bound to a signature event. The document payload is the
 * signable CONTENT of the document (no signature fields, no volatile
 * timestamps) so the seal can recompute it from the live document later.
 * Per the signature contract, the hash is over the canonical payload only —
 * not the envelope fields.
 */
export async function signatureDocumentHash(
  _documentType: string,
  _documentId: string,
  _fieldName: string,
  payload: object,
): Promise<string> {
  void _documentType;
  void _documentId;
  void _fieldName;
  return sha256Hex(canonicalJson(payload));
}

/** "Mary Jane" -> "MJ"; "Madonna" -> "MA"; "" -> "". */
export function suggestInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Handwriting-ish system font stacks offered by the "Type" adoption method. */
export const TYPED_SIGNATURE_FONTS: Array<{ label: string; stack: string }> = [
  {
    label: "Script",
    stack: `"Brush Script MT", "Segoe Script", "Apple Chancery", cursive`,
  },
  {
    label: "Casual",
    stack: `"Segoe Print", "Bradley Hand", "Chalkboard SE", cursive`,
  },
  {
    label: "Classic",
    stack: `"Snell Roundhand", "Apple Chancery", "Brush Script MT", cursive`,
  },
  {
    label: "Flourish",
    stack: `"Edwardian Script ITC", "Brush Script MT", "Segoe Script", cursive`,
  },
  {
    label: "Formal italic",
    stack: `"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif`,
  },
];

/**
 * Render typed text as a signature PNG (browser only — needs a canvas).
 * Long names shrink to fit the canvas.
 */
export function renderTypedSignature(name: string, fontStack: string): string {
  if (typeof document === "undefined") {
    throw new Error("Typed signatures need a browser canvas.");
  }
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Type your name first.");
  const width = 520;
  const height = 160;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not render the signature.");
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#2b2620";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let size = 64;
  const italic = fontStack.includes("serif") ? "italic " : "";
  do {
    ctx.font = `${italic}${size}px ${fontStack}`;
    if (ctx.measureText(trimmed).width <= width - 32 || size <= 20) break;
    size -= 4;
  } while (size > 16);
  ctx.fillText(trimmed, width / 2, height / 2 + 4);
  return canvas.toDataURL("image/png");
}

/** Decode a PNG data URL to a Blob (browser + Node). */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!match) throw new Error("Expected a PNG data URL.");
  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: "image/png" });
}

/** Decoded byte size of a base64 data URL. */
export function dataUrlByteSize(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export function isPngDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" && value.startsWith("data:image/png;base64,")
  );
}

/** Shared adoption validation (defense in depth — the DB NOT NULL is the real gate). */
export function assertAdoptableSignature(
  label: string,
  dataUrl: string,
): void {
  if (!isPngDataUrl(dataUrl)) {
    throw new Error(`${label} must be a PNG image.`);
  }
  if (dataUrlByteSize(dataUrl) > SIGNATURE_MAX_BYTES) {
    throw new Error(`${label} must be 200 KB or smaller.`);
  }
}

/** True when every pixel of the canvas is fully transparent. */
export function isBlankCanvas(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return true;
  const { width, height } = canvas;
  if (width === 0 || height === 0) return true;
  const data = ctx.getImageData(0, 0, width, height).data;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 0) return false;
  }
  return true;
}

/** Convert an uploaded PNG/JPG file to a normalized PNG data URL (browser only). */
export async function fileToSignaturePng(file: File): Promise<string> {
  if (!["image/png", "image/jpeg"].includes(file.type)) {
    throw new Error("Upload a PNG or JPG image.");
  }
  if (file.size > SIGNATURE_MAX_BYTES) {
    throw new Error("That image is over 200 KB — use a smaller one.");
  }
  if (typeof document === "undefined" || typeof createImageBitmap === "undefined") {
    throw new Error("Image upload needs a browser.");
  }
  const bitmap = await createImageBitmap(file);
  const maxW = 520;
  const maxH = 200;
  const scale = Math.min(1, maxW / bitmap.width, maxH / bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read that image.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (typeof bitmap.close === "function") bitmap.close();
  const dataUrl = canvas.toDataURL("image/png");
  assertAdoptableSignature("Signature image", dataUrl);
  return dataUrl;
}

/** Format an ISO timestamp as "Sep 13, 2026" for lock/seal messages. */
export function formatSignatureDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return iso.slice(0, 10);
  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
