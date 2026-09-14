/**
 * DocumentUploadCard — admin/DPM uploads a PCSP (or annual physician order).
 *
 * Flow: pick individual + document type + file (PDF/DOCX) -> the browser
 * extracts plain text client-side (PHI minimization: only TEXT is sent for
 * AI processing) -> raw bytes are stored in the `pcsp-documents` bucket and
 * the `extract-pcsp` edge function runs server-side -> progress stepper
 * (Uploading -> Extracting -> Ready for review) -> hands off to the
 * Extraction review queue.
 *
 * Blocked with the BAA notice when the agency's `ai_processing_enabled` is
 * off. Nothing here is visible to staff — review happens first.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FileUp,
  ShieldAlert,
} from "lucide-react";
import { Badge, Empty, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  AI_BAA_REQUIRED_COPY,
  DOCUMENT_TYPES,
  canUploadDocuments,
  documentTypeLabel,
  getDocumentsApi,
  uploadStatusLabel,
  type AiSettings,
  type DocumentType,
  type UploadStatus,
} from "./documents";
import {
  bytesToBase64,
  extractTextFromBytes,
  readFileBytes,
  validateUploadFile,
} from "./extractText";

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const STEPS: { key: UploadStatus; label: string }[] = [
  { key: "uploading", label: "Uploading" },
  { key: "extracting", label: "Extracting" },
  { key: "ready_for_review", label: "Ready for review" },
];

function stepIndex(phase: string): number {
  if (phase === "uploading") return 0;
  if (phase === "extracting") return 1;
  if (phase === "done") return 3;
  return -1;
}

export default function DocumentUploadCard({
  onUploaded,
}: {
  /** Called with the new upload id once extraction is ready for review. */
  onUploaded: (uploadId: string) => void;
}) {
  const { api, session, workspace } = useData();
  const docs = useMemo(
    () =>
      getDocumentsApi(api, {
        resolveIndividualName: (id) =>
          workspace?.individuals.find((p) => p.id === id)?.name,
      }),
    [api, workspace],
  );

  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [individualId, setIndividualId] = useState("");
  const [docType, setDocType] = useState<DocumentType>("pcsp");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<
    "idle" | "reading" | "uploading" | "extracting" | "done" | "error"
  >("idle");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let cancelled = false;
    docs
      .getAiSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
      })
      .catch((err) => {
        if (!cancelled)
          setSettingsError(
            (err as Error).message ?? "Could not load AI settings.",
          );
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canUploadDocuments(session)) {
    return (
      <>
        <PageHeading
          eyebrow="AI DOCUMENT INTAKE."
          title="Upload a plan document."
          description="Turn a PCSP or physician order into reviewable, trackable items."
        />
        <section className="panel">
          <Empty
            title="No access"
            text="Document upload is limited to administrators and program managers."
          />
        </section>
      </>
    );
  }

  const aiDisabled = settings !== null && !settings.aiProcessingEnabled;

  async function pollUntilReady(uploadId: string) {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      const extraction = await docs.getExtraction(uploadId);
      const status = extraction?.status;
      if (status === "ready_for_review") return;
      if (status === "approved" || status === "rejected") return;
      if (Date.now() > deadline) {
        throw new Error(
          "The extraction is taking longer than expected. It is still running — check the Extraction review queue in a minute.",
        );
      }
    }
  }

  async function handleSubmit() {
    setError("");
    setNote("");
    if (!individualId) {
      setError("Choose the individual this document belongs to.");
      return;
    }
    if (!file) {
      setError("Choose a PDF or DOCX file to upload.");
      return;
    }
    const validation = validateUploadFile({
      name: file.name,
      size: file.size,
      type: file.type,
    });
    if (!validation.ok) {
      setError(validation.error);
      return;
    }
    try {
      setPhase("reading");
      const bytes = await readFileBytes(file);
      // Client-side extraction: only TEXT leaves the browser for AI.
      const extracted = await extractTextFromBytes(bytes, validation.kind);
      if (extracted.truncated) {
        setNote(
          `The document text was longer than the processing limit, so only the first ${extracted.text.length.toLocaleString()} characters were sent for AI extraction. The full file is retained in storage.`,
        );
      }
      setPhase("uploading");
      const { uploadId } = await docs.uploadDocument({
        individualId,
        documentType: docType,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        fileBytesBase64: bytesToBase64(bytes),
        extractedText: extracted.text,
        extractedCharCount: extracted.charCount,
        textTruncated: extracted.truncated,
      });
      setPhase("extracting");
      await pollUntilReady(uploadId);
      setPhase("done");
      onUploaded(uploadId);
    } catch (err) {
      setPhase("error");
      setError((err as Error).message ?? "The upload failed. Try again.");
    }
  }

  const busy = phase === "reading" || phase === "uploading" || phase === "extracting";
  const currentStep = stepIndex(phase);
  const individuals = workspace?.individuals ?? [];

  return (
    <>
      <PageHeading
        eyebrow="AI DOCUMENT INTAKE."
        title="Upload a plan document."
        description="The AI reads the document and proposes trackable items. A person reviews everything before anything is tracked."
      />
      {settingsError && (
        <section className="panel">
          <div className="doc-error" role="alert">
            <AlertTriangle size={18} />
            <span>{settingsError}</span>
          </div>
        </section>
      )}
      {aiDisabled && (
        <section className="panel">
          <div className="doc-notice" role="alert">
            <ShieldAlert size={20} />
            <span>
              <strong>AI processing is disabled.</strong> {AI_BAA_REQUIRED_COPY}
            </span>
          </div>
        </section>
      )}
      {!aiDisabled && !settingsError && (
        <section className="panel">
          <ol className="doc-steps" aria-label="Upload progress">
            {STEPS.map((step, i) => {
              const state =
                currentStep > i || phase === "done"
                  ? "done"
                  : currentStep === i
                    ? "current"
                    : "";
              const Icon =
                state === "done" ? CheckCircle2 : step.key === "extracting" ? Cpu : FileUp;
              return (
                <li key={step.key} className={`doc-step ${state}`} aria-current={state === "current" ? "step" : undefined}>
                  <Icon size={16} aria-hidden />
                  {uploadStatusLabel(step.key)}
                </li>
              );
            })}
          </ol>

          {phase === "done" ? (
            <div className="doc-notice" style={{ background: "#dafbe1", borderColor: "#9edcb0", color: "#1a7f37" }}>
              <CheckCircle2 size={20} />
              <span>
                <strong>Extraction is ready for review.</strong> Nothing is
                tracked or visible to staff until a reviewer approves it.{" "}
                {note}
              </span>
            </div>
          ) : (
            <div className="doc-form">
              <label>
                Individual
                <select
                  value={individualId}
                  onChange={(e) => setIndividualId(e.target.value)}
                  disabled={busy}
                >
                  <option value="">Select…</option>
                  {individuals.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Document type
                <select
                  value={docType}
                  onChange={(e) => setDocType(e.target.value as DocumentType)}
                  disabled={busy}
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                File (PDF or DOCX, up to 15 MB)
                <input
                  type="file"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  disabled={busy}
                />
              </label>
              <p className="doc-hint">
                The document text is extracted in your browser — only the text
                is sent for AI processing. The original file is stored securely
                for retention.
              </p>
              {error && (
                <div className="doc-error" role="alert">
                  <AlertTriangle size={18} />
                  <span>{error}</span>
                </div>
              )}
              {note && <p className="doc-hint">{note}</p>}
              <div>
                <button
                  className="button primary"
                  onClick={handleSubmit}
                  disabled={busy}
                >
                  <FileUp size={16} />
                  {phase === "reading"
                    ? "Reading document…"
                    : phase === "uploading"
                      ? "Uploading…"
                      : phase === "extracting"
                        ? "Extracting…"
                        : `Upload ${documentTypeLabel(docType).split(" (")[0]}`}
                </button>
              </div>
            </div>
          )}
          {phase === "idle" && individuals.length === 0 && (
            <p className="doc-hint" style={{ marginTop: 12 }}>
              <Badge status="No individuals found" /> Add an individual before
              uploading a plan document.
            </p>
          )}
        </section>
      )}
    </>
  );
}
