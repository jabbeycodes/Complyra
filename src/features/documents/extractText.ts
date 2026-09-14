/**
 * Client-side document text extraction (frontend workstream).
 *
 * PHI minimization: PDF/DOCX parsing happens IN THE BROWSER. Only the
 * resulting plain text is sent to the server for AI processing — the raw
 * file bytes go to the `pcsp-documents` storage bucket for retention and are
 * never forwarded to the model.
 *
 * Heavy parsers (pdfjs-dist, mammoth) are loaded lazily via dynamic import
 * so the main bundle stays small. The loader interfaces are injectable so
 * tests can exercise the dispatch/truncation logic without a DOM or the
 * real parsers.
 */

/** Hard cap on bytes accepted for upload (also enforced server-side). */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

/** Hard cap on characters forwarded to the AI model. */
export const MAX_EXTRACT_CHARS = 200_000;

export type DocumentKind = "pdf" | "docx";

/** Detect the document kind from file name / MIME type. Null = unsupported. */
export function detectDocumentKind(
  fileName: string,
  mimeType: string,
): DocumentKind | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") || mimeType === "application/pdf") return "pdf";
  if (
    lower.endsWith(".docx") ||
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  return null;
}

export type FileValidation =
  | { ok: true; kind: DocumentKind }
  | { ok: false; error: string };

/** Validate a picked file before any bytes are read. */
export function validateUploadFile(file: {
  name: string;
  size: number;
  type: string;
}): FileValidation {
  const kind = detectDocumentKind(file.name, file.type);
  if (!kind) {
    return { ok: false, error: "Choose a PDF or DOCX file." };
  }
  if (!file.size || file.size <= 0) {
    return { ok: false, error: "That file is empty." };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, error: "Files must be 15 MB or smaller." };
  }
  return { ok: true, kind };
}

/** Truncate over-long extraction output before it is sent anywhere. */
export function truncateForModel(
  text: string,
  maxChars: number = MAX_EXTRACT_CHARS,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}

/* ------------------------------------------------------------------ */
/* Loader injection                                                    */
/* ------------------------------------------------------------------ */

export interface PdfJsModule {
  getDocument(src: { data: Uint8Array }): {
    promise: Promise<PdfJsDocument>;
  };
  GlobalWorkerOptions: { workerSrc: string };
  version?: string;
}

export interface PdfJsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfJsPage>;
  destroy(): Promise<void> | void;
}

export interface PdfJsPage {
  getTextContent(): Promise<{ items: { str?: string }[] }>;
}

export interface MammothModule {
  extractRawText(input: {
    buffer?: unknown;
    arrayBuffer?: ArrayBuffer;
  }): Promise<{ value: string }>;
}

export interface TextExtractLoaders {
  loadPdfJs(): Promise<PdfJsModule>;
  loadMammoth(): Promise<MammothModule>;
}

async function defaultPdfJsWorkerSrc(
  pdfjs: PdfJsModule,
): Promise<void> {
  try {
    // Vite serves the pdf.js worker as a static asset URL. If the bundler
    // cannot provide it, pdf.js falls back to its fake-worker path.
    const mod = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
    pdfjs.GlobalWorkerOptions.workerSrc = (mod as { default: string }).default;
  } catch {
    /* leave workerSrc unset — pdf.js degrades gracefully */
  }
}

export const defaultLoaders: TextExtractLoaders = {
  async loadPdfJs() {
    const pdfjs = (await import("pdfjs-dist")) as unknown as PdfJsModule;
    await defaultPdfJsWorkerSrc(pdfjs);
    return pdfjs;
  },
  async loadMammoth() {
    return (await import("mammoth")) as unknown as MammothModule;
  },
};

/* ------------------------------------------------------------------ */
/* Extraction                                                          */
/* ------------------------------------------------------------------ */

async function extractPdfText(
  bytes: Uint8Array,
  loaders: TextExtractLoaders,
): Promise<string> {
  const pdfjs = await loaders.loadPdfJs();
  const loadingTask = pdfjs.getDocument({ data: bytes });
  const pdf = await loadingTask.promise;
  try {
    const parts: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const line = content.items
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ");
      if (line.trim()) parts.push(line.trim());
    }
    return parts.join("\n");
  } finally {
    await pdf.destroy();
  }
}

async function extractDocxText(
  bytes: Uint8Array,
  loaders: TextExtractLoaders,
): Promise<string> {
  const mammoth = await loaders.loadMammoth();
  // Node build wants { buffer }; the browser build (Vite resolves mammoth's
  // "browser" field) wants { arrayBuffer }. Pass whichever fits this runtime.
  const input =
    typeof Buffer !== "undefined"
      ? { buffer: Buffer.from(bytes) }
      : {
          arrayBuffer: bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ),
        };
  const result = await mammoth.extractRawText(input);
  return result.value ?? "";
}

export interface ExtractedText {
  kind: DocumentKind;
  text: string;
  charCount: number;
  truncated: boolean;
}

/**
 * Extract plain text from PDF/DOCX bytes. Throws a human-readable error when
 * the document cannot be parsed.
 */
export async function extractTextFromBytes(
  bytes: Uint8Array,
  kind: DocumentKind,
  loaders: TextExtractLoaders = defaultLoaders,
): Promise<ExtractedText> {
  let raw: string;
  try {
    raw = kind === "pdf" ? await extractPdfText(bytes, loaders) : await extractDocxText(bytes, loaders);
  } catch (err) {
    throw new Error(
      `Could not read that ${kind === "pdf" ? "PDF" : "Word document"}: ${(err as Error).message ?? "unknown error"}`,
    );
  }
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!cleaned) {
    throw new Error(
      kind === "pdf"
        ? "No readable text was found in that PDF. It may be a scanned image — try a text-based export."
        : "No readable text was found in that Word document.",
    );
  }
  const { text, truncated } = truncateForModel(cleaned);
  return { kind, text, charCount: cleaned.length, truncated };
}

/** Read a browser File's bytes as a Uint8Array. */
export function readFileBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((buf) => new Uint8Array(buf));
}

/** Base64-encode bytes for the upload payload (chunked to avoid stack limits). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
