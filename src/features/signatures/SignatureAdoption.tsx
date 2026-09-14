import { useEffect, useRef, useState } from "react";
import { Modal } from "../../components";
import { useData } from "../../data/DataProvider";
import type { SignatureSettings } from "../../data/types";
import SignaturePad from "./SignaturePad";
import {
  ESIGN_CONSENT_TEXT,
  ESIGN_CONSENT_VERSION,
  TYPED_SIGNATURE_FONTS,
  fileToSignaturePng,
  renderTypedSignature,
  suggestInitials,
} from "./signatureUtils";

type Method = "draw" | "type" | "upload";

const METHOD_LABELS: Record<Method, string> = {
  draw: "Draw",
  type: "Type",
  upload: "Upload",
};

/**
 * Adopt-once e-signature screen. Collects a signature AND initials via
 * draw / type / upload (gated by agency settings), plus the ESIGN/UETA
 * consent checkbox. Re-adoption reuses this screen and requires consent again.
 */
export default function SignatureAdoption({
  onClose,
  onAdopted,
}: {
  onClose: () => void;
  onAdopted: () => void;
}) {
  const { api, session } = useData();
  const [settings, setSettings] = useState<SignatureSettings | null>(null);
  const [sigMethod, setSigMethod] = useState<Method>("draw");
  const [iniMethod, setIniMethod] = useState<Method>("draw");
  const [sigDraw, setSigDraw] = useState<string | null>(null);
  const [iniDraw, setIniDraw] = useState<string | null>(null);
  const [sigName, setSigName] = useState(session?.fullName ?? "");
  const [sigFont, setSigFont] = useState(TYPED_SIGNATURE_FONTS[0].stack);
  const [iniText, setIniText] = useState(
    suggestInitials(session?.fullName ?? ""),
  );
  const [iniFont, setIniFont] = useState(TYPED_SIGNATURE_FONTS[0].stack);
  const [sigUpload, setSigUpload] = useState<string | null>(null);
  const [iniUpload, setIniUpload] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sigFileRef = useRef<HTMLInputElement>(null);
  const iniFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await api.getSignatureSettings();
        if (!cancelled) {
          setSettings(loaded);
          const first = firstAllowed(loaded);
          setSigMethod(first);
          setIniMethod(first);
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [api]);

  if (!session) return null;

  const allowed: Method[] = settings
    ? (["draw", "type", "upload"] as Method[]).filter((m) =>
        m === "draw"
          ? settings.allowDraw
          : m === "type"
            ? settings.allowType
            : settings.allowUpload,
      )
    : ["draw", "type", "upload"];

  function firstAllowed(s: SignatureSettings): Method {
    if (s.allowDraw) return "draw";
    if (s.allowType) return "type";
    return "upload";
  }

  const sigReady =
    sigMethod === "draw"
      ? Boolean(sigDraw)
      : sigMethod === "type"
        ? sigName.trim().length > 0
        : Boolean(sigUpload);
  const iniReady =
    iniMethod === "draw"
      ? Boolean(iniDraw)
      : iniMethod === "type"
        ? iniText.trim().length > 0
        : Boolean(iniUpload);
  const canAdopt = sigReady && iniReady && consent && !busy;

  async function handleFile(
    file: File | undefined,
    target: "sig" | "ini",
  ) {
    if (!file) return;
    setError("");
    try {
      const png = await fileToSignaturePng(file);
      if (target === "sig") setSigUpload(png);
      else setIniUpload(png);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function adopt() {
    setError("");
    setBusy(true);
    try {
      const signatureDataUrl =
        sigMethod === "draw"
          ? sigDraw
          : sigMethod === "type"
            ? renderTypedSignature(sigName, sigFont)
            : sigUpload;
      const initialsDataUrl =
        iniMethod === "draw"
          ? iniDraw
          : iniMethod === "type"
            ? renderTypedSignature(iniText, iniFont)
            : iniUpload;
      if (!signatureDataUrl || !initialsDataUrl) {
        throw new Error("Add both your signature and your initials first.");
      }
      await api.adoptSignature({
        signatureDataUrl,
        initialsDataUrl,
        consentTextVersion: ESIGN_CONSENT_VERSION,
        consentGiven: consent,
      });
      onAdopted();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Adopt your electronic signature" onClose={onClose}>
      {error && <p className="form-error">{error}</p>}
      <p className="muted">
        Adopt once — every document you sign in Complyrer will use this
        signature and these initials, always recorded as you,{" "}
        {session.fullName}. You can re-adopt at any time from your profile.
      </p>

      <MethodTabs
        id="sig"
        label="Your signature"
        methods={allowed}
        active={sigMethod}
        onPick={setSigMethod}
      />
      {sigMethod === "draw" && (
        <SignaturePad onChange={setSigDraw} label="Draw your signature" />
      )}
      {sigMethod === "type" && (
        <div className="sig-type">
          <label>
            Type your full name
            <input
              value={sigName}
              onChange={(e) => setSigName(e.target.value)}
              placeholder={session.fullName}
              autoComplete="name"
            />
          </label>
          <fieldset className="sig-fonts">
            <legend>Choose a style</legend>
            {TYPED_SIGNATURE_FONTS.map((font) => (
              <label
                key={font.label}
                className={`sig-font-option ${sigFont === font.stack ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="sig-font"
                  checked={sigFont === font.stack}
                  onChange={() => setSigFont(font.stack)}
                />
                <span className="sig-font-name">{font.label}</span>
                <span
                  className="sig-font-preview"
                  style={{ fontFamily: font.stack }}
                  aria-hidden
                >
                  {sigName.trim() || session.fullName}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      )}
      {sigMethod === "upload" && (
        <div className="sig-upload">
          <input
            ref={sigFileRef}
            type="file"
            accept="image/png,image/jpeg"
            aria-label="Upload a signature image"
            onChange={(e) => void handleFile(e.target.files?.[0], "sig")}
          />
          <p className="muted">PNG or JPG, 200 KB or smaller.</p>
          {sigUpload && (
            <img
              src={sigUpload}
              alt="Uploaded signature preview"
              className="sig-upload-preview"
            />
          )}
        </div>
      )}

      <MethodTabs
        id="ini"
        label="Your initials"
        methods={allowed}
        active={iniMethod}
        onPick={setIniMethod}
      />
      {iniMethod === "draw" && (
        <SignaturePad
          onChange={setIniDraw}
          label="Draw your initials"
          minHeight={120}
        />
      )}
      {iniMethod === "type" && (
        <div className="sig-type">
          <label>
            Initials
            <input
              value={iniText}
              onChange={(e) => setIniText(e.target.value)}
              maxLength={6}
              placeholder={suggestInitials(session.fullName)}
            />
          </label>
          <fieldset className="sig-fonts">
            <legend>Choose a style</legend>
            {TYPED_SIGNATURE_FONTS.map((font) => (
              <label
                key={font.label}
                className={`sig-font-option ${iniFont === font.stack ? "selected" : ""}`}
              >
                <input
                  type="radio"
                  name="ini-font"
                  checked={iniFont === font.stack}
                  onChange={() => setIniFont(font.stack)}
                />
                <span className="sig-font-name">{font.label}</span>
                <span
                  className="sig-font-preview"
                  style={{ fontFamily: font.stack }}
                  aria-hidden
                >
                  {iniText.trim() || suggestInitials(session.fullName)}
                </span>
              </label>
            ))}
          </fieldset>
        </div>
      )}
      {iniMethod === "upload" && (
        <div className="sig-upload">
          <input
            ref={iniFileRef}
            type="file"
            accept="image/png,image/jpeg"
            aria-label="Upload an initials image"
            onChange={(e) => void handleFile(e.target.files?.[0], "ini")}
          />
          <p className="muted">PNG or JPG, 200 KB or smaller.</p>
          {iniUpload && (
            <img
              src={iniUpload}
              alt="Uploaded initials preview"
              className="sig-upload-preview"
            />
          )}
        </div>
      )}

      <label className="sig-consent">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
        />
        <span>{ESIGN_CONSENT_TEXT}</span>
      </label>

      <div className="modal-actions">
        <button type="button" className="button" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="button primary"
          disabled={!canAdopt}
          onClick={() => void adopt()}
        >
          {busy ? "Adopting…" : "Adopt signature"}
        </button>
      </div>
    </Modal>
  );
}

function MethodTabs({
  id,
  label,
  methods,
  active,
  onPick,
}: {
  id: string;
  label: string;
  methods: Method[];
  active: Method;
  onPick: (m: Method) => void;
}) {
  return (
    <div className="sig-method-block">
      <h4 id={`${id}-label`}>{label}</h4>
      <div
        className="sig-methods"
        role="tablist"
        aria-labelledby={`${id}-label`}
      >
        {methods.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={active === m}
            className={active === m ? "active" : ""}
            onClick={() => onPick(m)}
          >
            {METHOD_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  );
}
