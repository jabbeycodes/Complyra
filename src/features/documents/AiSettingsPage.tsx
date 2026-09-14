/**
 * AiSettingsPage — agency administrators only.
 *
 * Shows the AI model in use (editable, saved per agency), the Vertex AI
 * service-account status ("Configured — verified <date>" / "Not configured" —
 * credential material is NEVER displayed or editable here), the GCP project
 * id recorded at verification, and a "Verify service account" button that
 * asks the server to run a minimal generateContent call.
 *
 * Credential values are provisioned outside this UI: the service-account
 * JSON, project id, and location are Supabase function secrets
 * (VERTEX_SERVICE_ACCOUNT_JSON, VERTEX_PROJECT_ID, VERTEX_LOCATION).
 * This page never accepts a credential value.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ServerCog,
  ShieldAlert,
} from "lucide-react";
import { Empty, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  AI_BAA_REQUIRED_COPY,
  aiServiceAccountStatusLabel,
  canManageAiSettings,
  getDocumentsApi,
  type AiSettings,
} from "./documents";

export default function AiSettingsPage() {
  const { api, session } = useData();
  const docs = useMemo(() => getDocumentsApi(api), [api]);

  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    docs
      .getAiSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setModel(s.model);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message ?? "Could not load AI settings.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canManageAiSettings(session)) {
    return (
      <>
        <PageHeading
          eyebrow="AGENCY SETTINGS."
          title="AI settings."
          description="Model and service account status for AI document processing."
        />
        <section className="panel">
          <Empty title="No access" text="AI settings are limited to agency administrators." />
        </section>
      </>
    );
  }

  async function saveModel() {
    if (!model.trim()) {
      setError("Enter a model name.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const updated = await docs.setAiSettings({ model: model.trim() });
      setSettings(updated);
      setMessage("Model saved. New extractions will use it.");
    } catch (err) {
      setError((err as Error).message ?? "Could not save the model.");
    } finally {
      setSaving(false);
    }
  }

  async function verifyServiceAccount() {
    setVerifying(true);
    setError("");
    setMessage("");
    try {
      const result = await docs.verifyAiServiceAccount();
      if (result.ok) {
        setSettings((s) =>
          s
            ? {
                ...s,
                serviceAccountStatus: "configured",
                serviceAccountVerifiedAt: result.serviceAccountVerifiedAt,
                vertexProjectId: result.projectId ?? s.vertexProjectId,
              }
            : s,
        );
        setMessage(
          result.serviceAccountVerifiedAt
            ? `Service account verified ${result.serviceAccountVerifiedAt.slice(0, 10)}.`
            : "Service account verified.",
        );
      } else {
        setError(
          result.error ??
            "The service account check failed. Check the secrets and try again.",
        );
      }
    } catch (err) {
      setError((err as Error).message ?? "The service account check failed.");
    } finally {
      setVerifying(false);
    }
  }

  const serviceAccountConfigured = settings?.serviceAccountStatus === "configured";

  return (
    <>
      <PageHeading
        eyebrow="AGENCY SETTINGS."
        title="AI settings."
        description="Model and service account status for AI document processing."
      />
      {loading && (
        <section className="panel">
          <p className="doc-hint">Loading…</p>
        </section>
      )}
      {error && (
        <section className="panel">
          <div className="doc-error" role="alert">
            <AlertTriangle size={18} />
            <span>{error}</span>
          </div>
        </section>
      )}
      {!loading && settings && (
        <>
          {!settings.aiProcessingEnabled && (
            <section className="panel">
              <div className="doc-notice" role="alert">
                <ShieldAlert size={20} />
                <span>
                  <strong>AI processing is disabled.</strong> {AI_BAA_REQUIRED_COPY}
                </span>
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Document extraction</h2>
              <p>Used when a PCSP or physician order is uploaded.</p>
            </div>
            <div className="doc-form" style={{ marginTop: 0 }}>
              <label>
                AI model
                <input
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  placeholder="e.g. gemini-2.5-flash"
                  aria-label="AI model name"
                />
              </label>
              <div>
                <button className="button primary" onClick={saveModel} disabled={saving}>
                  {saving ? "Saving…" : "Save model"}
                </button>
              </div>
              {message && (
                <p className="doc-hint" style={{ display: "flex", alignItems: "center", gap: 6, color: "#1a7f37" }}>
                  <CheckCircle2 size={14} /> {message}
                </p>
              )}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Vertex AI service account</h2>
              <p>Credential values are never shown or typed here.</p>
            </div>
            <p className="doc-key-status">
              <span className={`doc-key-dot ${serviceAccountConfigured ? "set" : "unset"}`} aria-hidden />
              <ServerCog size={16} aria-hidden />
              {aiServiceAccountStatusLabel(settings)}
            </p>
            <p className="doc-hint" style={{ marginTop: 8 }}>
              Project: {settings.vertexProjectId ?? "—"}
            </p>
            <div className="doc-item-actions">
              <button
                className="button"
                onClick={verifyServiceAccount}
                disabled={verifying}
                style={{ minHeight: 44 }}
              >
                <RefreshCw size={16} /> {verifying ? "Verifying…" : "Verify service account"}
              </button>
            </div>
            <p className="doc-hint" style={{ marginTop: 12 }}>
              The service-account JSON, project id, and location are set
              outside Complyrer as the Supabase function secrets{" "}
              <code>VERTEX_SERVICE_ACCOUNT_JSON</code>,{" "}
              <code>VERTEX_PROJECT_ID</code>, and <code>VERTEX_LOCATION</code>{" "}
              — they are never typed into this page. "Verify service account"
              asks the server to mint an OAuth token and run a minimal Vertex
              AI call. The Google Cloud BAA (IAM &amp; Admin → HIPAA Business
              Associate Addendum) must be accepted before enabling AI
              processing for real PHI. The old Developer API key path is
              removed — delete the <code>GEMINI_API_KEY</code> function secret
              at ship time.
            </p>
          </section>
        </>
      )}
    </>
  );
}
