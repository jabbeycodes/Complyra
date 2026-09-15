import { useEffect, useMemo, useState } from "react";
import { FileText, UserPlus } from "lucide-react";
import { useData } from "../data/DataProvider";
import { todayIso } from "../data/chart";

type Mode = "pcsp" | "manual";

export default function AddIndividualForm({
  initialSiteId,
  onCreated,
}: {
  initialSiteId?: string | null;
  onCreated?: (name: string, uploaded: boolean, siteName: string) => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const lockedSiteId =
    session?.roleKey === "house_manager" ? session.siteId : null;
  const sites = workspace?.sites ?? [];
  const [mode, setMode] = useState<Mode>("pcsp");
  const [fullName, setFullName] = useState("");
  const [goesBy, setGoesBy] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [dmhId, setDmhId] = useState("");
  const [siteId, setSiteId] = useState(lockedSiteId ?? initialSiteId ?? "");
  const [enrolledOn, setEnrolledOn] = useState(todayIso());
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState("12");
  const [effectiveOn, setEffectiveOn] = useState("2026-09-12");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedSite = useMemo(
    () => sites.find((site) => site.id === siteId),
    [sites, siteId],
  );

  useEffect(() => {
    const next = lockedSiteId ?? initialSiteId ?? "";
    if (next) setSiteId(next);
  }, [lockedSiteId, initialSiteId]);

  return (
    <form
      className="setup-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (mode === "pcsp" && !file) {
          setError("Choose the PCSP PDF, or add this Individual by hand.");
          return;
        }
        setBusy(true);
        setError("");
        try {
          const created = await api.createIndividual({
            fullName,
            dateOfBirth,
            siteId,
            goesBy,
            dmhId,
            enrolledOn,
            file: mode === "pcsp" ? file ?? undefined : undefined,
            pageCount: Number(pageCount) || 1,
            effectiveOn,
          });
          await refresh();
          onCreated?.(
            created.name,
            mode === "pcsp",
            selectedSite?.name ?? "this site",
          );
        } catch (err) {
          setError((err as Error).message);
          setBusy(false);
        }
      }}
    >
      <p className="form-help">
        Start from a PCSP when you have one. Or add the Individual now and
        attach the plan later.
      </p>
      <div className="choice-row" role="tablist" aria-label="How to add this Individual">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "pcsp"}
          className={`choice-card ${mode === "pcsp" ? "active" : ""}`}
          onClick={() => setMode("pcsp")}
        >
          <FileText size={20} />
          <strong>Upload a PCSP</strong>
          <span>Creates the Individual and a plan draft for review.</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "manual"}
          className={`choice-card ${mode === "manual" ? "active" : ""}`}
          onClick={() => setMode("manual")}
        >
          <UserPlus size={20} />
          <strong>Add by hand</strong>
          <span>Name, date of birth, and site. No file required.</span>
        </button>
      </div>
      <label className="form-label">
        Legal name
        <input
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="e.g. Corey Williams"
          required
        />
      </label>
      <div className="form-two">
        <label className="form-label">
          Goes by
          <input
            value={goesBy}
            onChange={(e) => setGoesBy(e.target.value)}
            placeholder="Preferred name"
          />
        </label>
        <label className="form-label">
          Date of birth
          <input
            type="date"
            value={dateOfBirth}
            onChange={(e) => setDateOfBirth(e.target.value)}
            required
          />
        </label>
      </div>
      <div className="form-two">
        <label className="form-label">
          Program site
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            disabled={Boolean(lockedSiteId)}
            required
          >
            {!lockedSiteId && <option value="">Select a program site…</option>}
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-label">
          Enrollment date
          <input
            type="date"
            value={enrolledOn}
            onChange={(e) => setEnrolledOn(e.target.value)}
          />
        </label>
      </div>
      <label className="form-label">
        DMH ID (optional)
        <input
          value={dmhId}
          onChange={(e) => setDmhId(e.target.value)}
          placeholder="If known"
        />
      </label>
      {selectedSite && (
        <p className="quiet-note">
          {selectedSite.name} · {selectedSite.program || "Program site"}
        </p>
      )}
      {mode === "pcsp" && (
        <>
          <label className="upload-zone">
            <FileText size={22} />
            <strong>{file ? file.name : "Choose the PCSP PDF"}</strong>
            <span>PDF up to 10 MB · fictional files only in this preview</span>
            <input
              aria-label="Choose PCSP PDF"
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => {
                const chosen = e.target.files?.[0];
                if (!chosen) return;
                if (
                  !chosen.name.toLowerCase().endsWith(".pdf") ||
                  chosen.size > 10 * 1024 * 1024
                ) {
                  setError("Choose a PDF smaller than 10 MB.");
                  setFile(null);
                  e.target.value = "";
                  return;
                }
                setFile(chosen);
                setError("");
              }}
            />
          </label>
          <div className="form-two">
            <label className="form-label">
              Plan effective date
              <input
                type="date"
                value={effectiveOn}
                onChange={(e) => setEffectiveOn(e.target.value)}
                required
              />
            </label>
            <label className="form-label">
              Page count
              <input
                type="number"
                min="1"
                max="9999"
                value={pageCount}
                onChange={(e) => setPageCount(e.target.value)}
                required
              />
            </label>
          </div>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" type="submit" disabled={busy}>
        {mode === "pcsp"
          ? "Add Individual and send plan for review"
          : "Add Individual"}
      </button>
    </form>
  );
}
