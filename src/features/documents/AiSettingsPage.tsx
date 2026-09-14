/**
 * AiSettingsPage — agency administrators only.
 *
 * Shows the AI model in use (editable, saved per agency), the Gemini API
 * key status ("Verified <date>" / "Not verified" — the value itself
 * is NEVER displayed or editable here), and a "Verify key" button that asks
 * the server to run a minimal models-list check.
 *
 * Key values are provisioned outside this UI: via the Secure Vault or as
 * the Supabase function secret GEMINI_API_KEY. This page never accepts a
 * key value.
 */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";
import { Empty, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import {
  AI_BAA_REQUIRED_COPY,
  aiKeyStatusLabel,
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
          description="Model and key status for AI document processing."
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

  async function verifyKey() {
    setVerifying(true);
    setError("");
    setMessage("");
    try {
      const result = await docs.verifyAiKey();
      if (result.ok) {
        setSettings((s) =>
          s ? { ...s, keyStatus: "verified", lastVerifiedAt: result.lastVerifiedAt } : s,
        );
        setMessage(
          result.lastVerifiedAt
            ? `Key verified ${result.lastVerifiedAt.slice(0, 10)}.`
            : "Key verified.",
        );
      } else {
        setError(result.error ?? "The key check failed. Check the key and try again.");
      }
    } catch (err) {
      setError((err as Error).message ?? "The key check failed.");
    } finally {
      setVerifying(false);
    }
  }

  const keyVerified = settings?.keyStatus === "verified";

  return (
    <>
      <PageHeading
        eyebrow="AGENCY SETTINGS."
        title="AI settings."
        description="Model and key status for AI document processing."
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
              <h2>Gemini API key</h2>
              <p>The key value is never shown or typed here.</p>
            </div>
            <p className="doc-key-status">
              <span className={`doc-key-dot ${keyVerified ? "set" : "unset"}`} aria-hidden />
              <KeyRound size={16} aria-hidden />
              {aiKeyStatusLabel(settings)}
            </p>
            <div className="doc-item-actions">
              <button className="button" onClick={verifyKey} disabled={verifying}>
                <RefreshCw size={16} /> {verifying ? "Verifying…" : "Verify key"}
              </button>
            </div>
            <p className="doc-hint" style={{ marginTop: 12 }}>
              Key values are set outside Complyrer — via the Secure Vault or as
              the Supabase function secret <code>GEMINI_API_KEY</code> — and are
              never typed into this page. "Verify key" asks the server to run a
              minimal models-list check against the stored key.
            </p>
          </section>
        </>
      )}
    </>
  );
}
