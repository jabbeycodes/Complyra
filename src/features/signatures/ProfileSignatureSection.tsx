import { useEffect, useState } from "react";
import { PenLine } from "lucide-react";
import { useData } from "../../data/DataProvider";
import type { AdoptedSignature } from "../../data/types";
import SignatureAdoption from "./SignatureAdoption";
import { formatSignatureDate } from "./signatureUtils";

/**
 * "Electronic signature" section of the profile modal: shows the adopted
 * signature + initials and offers re-adoption (consent required again).
 */
export default function ProfileSignatureSection() {
  const { api } = useData();
  const [adopted, setAdopted] = useState<AdoptedSignature | null>(null);
  const [sigUrl, setSigUrl] = useState<string | null>(null);
  const [iniUrl, setIniUrl] = useState<string | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const row = await api.getMySignature();
      setAdopted(row);
      if (row) {
        const [sig, ini] = await Promise.all([
          api.getSignatureImageUrl(row.signaturePath),
          api.getSignatureImageUrl(row.initialsPath),
        ]);
        setSigUrl(sig);
        setIniUrl(ini);
      } else {
        setSigUrl(null);
        setIniUrl(null);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="profile-signature" aria-label="Electronic signature">
      <h3>Electronic signature</h3>
      {error && <p className="form-error">{error}</p>}
      {loading ? (
        <p className="muted">Loading…</p>
      ) : !adopted ? (
        <>
          <p className="muted">
            You have not adopted an electronic signature yet. Adopt once to
            sign delegation forms, training sheets, and checklists as yourself.
          </p>
          <button
            type="button"
            className="button"
            onClick={() => setAdopting(true)}
          >
            <PenLine size={16} /> Adopt signature
          </button>
        </>
      ) : (
        <>
          <div className="profile-signature-images">
            <figure>
              {sigUrl && <img src={sigUrl} alt="Your adopted signature" />}
              <figcaption>Signature</figcaption>
            </figure>
            <figure>
              {iniUrl && <img src={iniUrl} alt="Your adopted initials" />}
              <figcaption>Initials</figcaption>
            </figure>
          </div>
          <p className="muted">
            Adopted {formatSignatureDate(adopted.adoptedAt)} · consent v
            {adopted.consentTextVersion}
          </p>
          <button
            type="button"
            className="button"
            onClick={() => setAdopting(true)}
          >
            <PenLine size={16} /> Re-adopt signature
          </button>
        </>
      )}
      {adopting && (
        <SignatureAdoption
          onClose={() => setAdopting(false)}
          onAdopted={() => {
            setAdopting(false);
            void load();
          }}
        />
      )}
    </section>
  );
}
