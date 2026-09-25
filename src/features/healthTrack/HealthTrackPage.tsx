import { useEffect, useMemo, useState } from "react";
import { CircleCheck, Download, Eye, Plus, Printer, Trash2, TriangleAlert } from "lucide-react";
import { Badge, Empty, formatDate, PageHeading } from "../../components";
import { useData } from "../../data/DataProvider";
import { individualsAtSite, lockedSiteIdFor } from "../../data/dashboard";
import { openPrintable } from "../../data/openFile";
import {
  BLOOD_SUGAR_CONTEXTS,
  BLOOD_SUGAR_CONTEXT_LABELS,
  BODY_LOCATIONS,
  BOWEL_CONSISTENCIES,
  BOWEL_CONSISTENCY_LABELS,
  HEALTH_TRACK_KIND_LABELS,
  HEALTH_TRACK_SECTIONS,
  HEALTH_REVISION_ACTION_LABELS,
  MEAL_TYPES,
  MENSES_FLOWS,
  PORTIONS_EATEN,
  PORTION_LABELS,
  SKIN_OBSERVATIONS,
  SKIN_OBSERVATION_LABELS,
  STOOL_AMOUNTS,
  canRecordHealthTrack,
  canReviewHealthTrack,
  canSeeHealthTrack,
  dayKeyOf,
  detectHealthAlert,
  isMeaningfulNote,
  sortHealthEntriesDesc,
  summarizeHealthDay,
  summarizeHealthWeek,
  validateHealthTrackInput,
  type BloodSugarContext,
  type BowelConsistency,
  type HealthTrackDetails,
  type HealthTrackEntry,
  type HealthTrackKind,
  type HealthTrackRevision,
  type HealthTrackSectionKey,
  type MealType,
  type MensesFlow,
  type PortionEaten,
  type SkinObservation,
  type StoolAmount,
} from "../../data/healthTrack";
import { buildHealthLogHtml, healthEntryDetailRows, healthLogFileName } from "./printHealthLog";

const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

const FLOW_LABELS: Record<MensesFlow, string> = {
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

const AMOUNT_LABELS: Record<StoolAmount, string> = {
  small: "Small",
  moderate: "Moderate",
  large: "Large",
};

function todayLocalIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate(),
  ).padStart(2, "0")}`;
}

function addDaysIso(dateIso: string, days: number): string {
  const [y, m, d] = dateIso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(
    dt.getDate(),
  ).padStart(2, "0")}`;
}

function nowLocalInput(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(
    now.getHours(),
  )}:${pad(now.getMinutes())}`;
}

function formatDateTime(iso: string): string {
  const day = dayKeyOf(iso);
  const time = iso.length > 13 ? iso.slice(11, 16) : "";
  return time ? `${day} · ${time}` : day;
}

type FormFields = Record<string, string | boolean>;

function blankFields(kind: HealthTrackKind): FormFields {
  const base: FormFields = {
    occurredAt: nowLocalInput(),
    mealType: "breakfast",
    portion: "all",
    items: "",
    appetiteNote: "",
    fluidType: "Water",
    ounces: "",
    amount: "moderate",
    consistency: "formed",
    color: "",
    blood: false,
    pain: false,
    notes: "",
    continent: true,
    description: "",
    bodyLocation: "Other",
    observation: "redness",
    size: "",
    worsening: false,
    followUpDate: "",
    tempF: "",
    bpSystolic: "",
    bpDiastolic: "",
    pulse: "",
    respirations: "",
    o2Sat: "",
    weightLb: "",
    durationMinutes: "",
    triggers: "",
    postEventState: "",
    startDate: todayLocalIso(),
    endDate: "",
    flow: "moderate",
    symptoms: "",
    readingMgDl: "",
    context: "before_meal",
  };
  void kind;
  return base;
}

function buildDetails(kind: HealthTrackKind, f: FormFields): HealthTrackDetails {
  const text = (v: string | boolean) => (typeof v === "string" ? v.trim() : "");
  const opt = (v: string | boolean) => {
    const t = text(v);
    return t === "" ? undefined : t;
  };
  const num = (v: string | boolean): number | undefined => {
    const t = text(v);
    return t === "" ? undefined : Number(t);
  };
  switch (kind) {
    case "meal":
      return {
        mealType: f.mealType as MealType,
        portion: f.portion as PortionEaten,
        items: text(f.items),
        appetiteNote: opt(f.appetiteNote),
      };
    case "fluid":
      return { fluidType: text(f.fluidType), ounces: Number(text(f.ounces)) };
    case "bowel":
      return {
        amount: f.amount as StoolAmount,
        consistency: f.consistency as BowelConsistency,
        color: text(f.color),
        blood: f.blood === true,
        pain: f.pain === true,
        notes: opt(f.notes),
      };
    case "bladder":
      return {
        continent: f.continent === true,
        amount: f.amount as StoolAmount,
        notes: opt(f.notes),
      };
    case "emesis":
      return { amount: f.amount as StoolAmount, description: opt(f.description) };
    case "skin":
      return {
        bodyLocation: text(f.bodyLocation) || "Other",
        observation: f.observation as SkinObservation,
        size: opt(f.size),
        description: text(f.description),
        followUpDate: opt(f.followUpDate),
        worsening: f.worsening === true,
      };
    case "vitals":
      return {
        tempF: num(f.tempF),
        bpSystolic: num(f.bpSystolic),
        bpDiastolic: num(f.bpDiastolic),
        pulse: num(f.pulse),
        respirations: num(f.respirations),
        o2Sat: num(f.o2Sat),
        weightLb: num(f.weightLb),
      };
    case "seizure":
      return {
        durationMinutes: num(f.durationMinutes),
        description: text(f.description),
        triggers: opt(f.triggers),
        postEventState: opt(f.postEventState),
      };
    case "menses":
      return {
        startDate: text(f.startDate),
        endDate: opt(f.endDate),
        flow: f.flow as MensesFlow,
        symptoms: opt(f.symptoms),
      };
    case "blood_sugar":
      return {
        readingMgDl: Number(text(f.readingMgDl)),
        context: f.context as BloodSugarContext,
        symptoms: opt(f.symptoms),
      };
  }
}

/* ------------------------------------------------------------------ */
/* Correction form: pre-fill fields from an existing entry's details    */
/* ------------------------------------------------------------------ */

function fieldsFromDetails(kind: HealthTrackKind, details: HealthTrackDetails): FormFields {
  const base = blankFields(kind);
  const d = details as unknown as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  switch (kind) {
    case "meal":
      return {
        ...base,
        mealType: str(d.mealType) || "breakfast",
        portion: str(d.portion) || "all",
        items: str(d.items),
        appetiteNote: str(d.appetiteNote),
      };
    case "fluid":
      return { ...base, fluidType: str(d.fluidType) || "Water", ounces: str(d.ounces) };
    case "bowel":
      return {
        ...base,
        amount: str(d.amount) || "moderate",
        consistency: str(d.consistency) || "formed",
        color: str(d.color),
        blood: d.blood === true,
        pain: d.pain === true,
        notes: str(d.notes),
      };
    case "bladder":
      return {
        ...base,
        continent: d.continent !== false,
        amount: str(d.amount) || "moderate",
        notes: str(d.notes),
      };
    case "emesis":
      return { ...base, amount: str(d.amount) || "moderate", description: str(d.description) };
    case "skin":
      return {
        ...base,
        bodyLocation: str(d.bodyLocation) || "Other",
        observation: str(d.observation) || "redness",
        size: str(d.size),
        description: str(d.description),
        followUpDate: str(d.followUpDate),
        worsening: d.worsening === true,
      };
    case "vitals":
      return {
        ...base,
        tempF: str(d.tempF),
        bpSystolic: str(d.bpSystolic),
        bpDiastolic: str(d.bpDiastolic),
        pulse: str(d.pulse),
        respirations: str(d.respirations),
        o2Sat: str(d.o2Sat),
        weightLb: str(d.weightLb),
      };
    case "seizure":
      return {
        ...base,
        durationMinutes: str(d.durationMinutes),
        description: str(d.description),
        triggers: str(d.triggers),
        postEventState: str(d.postEventState),
      };
    case "menses":
      return {
        ...base,
        startDate: str(d.startDate) || todayLocalIso(),
        endDate: str(d.endDate),
        flow: str(d.flow) || "moderate",
        symptoms: str(d.symptoms),
      };
    case "blood_sugar":
      return {
        ...base,
        readingMgDl: str(d.readingMgDl),
        context: str(d.context) || "before_meal",
        symptoms: str(d.symptoms),
      };
  }
}

/* ------------------------------------------------------------------ */
/* Quick-add form: one component, fields switch by kind                 */
/* ------------------------------------------------------------------ */

function QuickAddForm({
  individualId,
  section,
  onSaved,
  editing,
}: {
  individualId: string;
  section: HealthTrackSectionKey;
  onSaved: () => void;
  /** When set, the form corrects this entry instead of adding a new one. */
  editing?: HealthTrackEntry | null;
}) {
  const { api } = useData();
  const kinds = useMemo(
    () =>
      editing
        ? [editing.kind]
        : (HEALTH_TRACK_SECTIONS.find((s) => s.key === section)?.kinds ??
          []) as HealthTrackKind[],
    [section, editing],
  );
  const [kind, setKind] = useState<HealthTrackKind>(editing?.kind ?? kinds[0] ?? "meal");
  const [fields, setFields] = useState<FormFields>(() => {
    if (editing) {
      const initial = fieldsFromDetails(editing.kind, editing.details);
      // Pre-fill the recorded time (datetime-local wants "YYYY-MM-DDTHH:MM").
      initial.occurredAt = editing.occurredAt.slice(0, 16);
      return initial;
    }
    return blankFields(kinds[0] ?? "meal");
  });
  const [photo, setPhoto] = useState<File | null>(null);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveNote, setSaveNote] = useState<{ flagged: boolean; text: string } | null>(null);

  useEffect(() => {
    if (editing) return;
    const first = kinds[0] ?? "meal";
    setKind(first);
    setFields(blankFields(first));
    setPhoto(null);
    setReason("");
    setErrors([]);
    setSaveNote(null);
  }, [kinds, editing]);

  function set(field: string, value: string | boolean) {
    setFields((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors([]);
    setSaveNote(null);
    const details = buildDetails(kind, fields);
    const problems = validateHealthTrackInput(kind, details);
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
    if (editing && !isMeaningfulNote(reason)) {
      setErrors(["Say why you are correcting this entry."]);
      return;
    }
    setSaving(true);
    try {
      // Store the local wall-clock time the staff entered, not a UTC-shifted
      // instant: care logs are calendar-day records, and `dayKeyOf` slices the
      // date prefix. Converting through `toISOString()` would push evening
      // entries in western timezones onto the next calendar day.
      const localInput =
        typeof fields.occurredAt === "string" && fields.occurredAt
          ? fields.occurredAt
          : nowLocalInput();
      const occurredAt =
        localInput.length === 16 ? `${localInput}:00` : localInput;
      let savedEntry: HealthTrackEntry;
      if (editing) {
        // Keep an already-attached skin photo across corrections (a new
        // upload replaces it below).
        if (kind === "skin" && !photo) {
          const existingPhotoId = (editing.details as { photoId?: string }).photoId;
          if (existingPhotoId) {
            (details as HealthTrackDetails & { photoId?: string }).photoId = existingPhotoId;
          }
        }
        savedEntry = await api.updateHealthEntry(editing.id, {
          occurredAt,
          details,
          reason: reason.trim(),
        });
      } else {
        savedEntry = await api.addHealthEntry({ individualId, kind, occurredAt, details });
      }
      // Skin photos upload AFTER the entry is saved, then attach to it; if
      // the attach fails the upload is deleted so no orphaned PHI remains.
      if (kind === "skin" && photo) {
        const photoId = await api.uploadHealthPhoto(individualId, photo);
        try {
          await api.attachHealthPhoto(savedEntry.id, photoId);
        } catch (attachErr) {
          await api.deleteHealthPhoto(photoId).catch(() => undefined);
          throw attachErr;
        }
      }
      const alert = detectHealthAlert(kind, details);
      setSaveNote(
        alert.flagged
          ? { flagged: true, text: `Saved — flagged for review: ${alert.reason}` }
          : { flagged: false, text: "Saved." },
      );
      setFields(blankFields(kind));
      setPhoto(null);
      setReason("");
      onSaved();
    } catch (err) {
      setErrors([(err as Error).message]);
    } finally {
      setSaving(false);
    }
  }

  const input = (field: string, type = "text", extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type={type}
      value={typeof fields[field] === "string" ? (fields[field] as string) : ""}
      onChange={(e) => set(field, e.target.value)}
      {...extra}
    />
  );

  return (
    <form className="delegation-editor" onSubmit={handleSubmit}>
      {editing && (
        <p className="delegation-small" role="status">
          Correcting the {HEALTH_TRACK_KIND_LABELS[editing.kind].toLowerCase()} entry from{" "}
          {formatDateTime(editing.occurredAt)}. The original stays in the history.
        </p>
      )}
      {kinds.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Entry type">
          {kinds.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              className={kind === k ? "selected" : ""}
              onClick={() => {
                setKind(k);
                setFields(blankFields(k));
                setPhoto(null);
                setReason("");
                setErrors([]);
              }}
            >
              {HEALTH_TRACK_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      )}
      <div className="delegation-grid3">
        <label className="form-label">
          Date &amp; time it happened
          <input
            type="datetime-local"
            aria-label="Date and time it happened"
            value={typeof fields.occurredAt === "string" ? fields.occurredAt : ""}
            onChange={(e) => set("occurredAt", e.target.value)}
            required
          />
        </label>
      </div>

      {kind === "meal" && (
        <>
          <div className="delegation-grid3">
            <label className="form-label">
              Meal
              <select value={fields.mealType as string} onChange={(e) => set("mealType", e.target.value)}>
                {MEAL_TYPES.map((m) => (
                  <option key={m} value={m}>{MEAL_TYPE_LABELS[m]}</option>
                ))}
              </select>
            </label>
            <fieldset className="form-label">
              <legend>Portion eaten</legend>
              {PORTIONS_EATEN.map((p) => (
                <label key={p} className="radio-inline">
                  <input
                    type="radio"
                    name="portion"
                    checked={fields.portion === p}
                    onChange={() => set("portion", p)}
                  />{" "}
                  {PORTION_LABELS[p]}
                </label>
              ))}
            </fieldset>
          </div>
          <label className="form-label">
            What was served / eaten
            <textarea value={fields.items as string} onChange={(e) => set("items", e.target.value)} rows={2} />
          </label>
          <label className="form-label">
            Appetite note (optional)
            <input value={fields.appetiteNote as string} onChange={(e) => set("appetiteNote", e.target.value)} />
          </label>
        </>
      )}

      {kind === "fluid" && (
        <div className="delegation-grid3">
          <label className="form-label">
            Drink
            <input value={fields.fluidType as string} onChange={(e) => set("fluidType", e.target.value)} />
          </label>
          <label className="form-label">
            Ounces
            {input("ounces", "number", { min: 0, step: "0.5" })}
          </label>
        </div>
      )}

      {kind === "bowel" && (
        <>
          <div className="delegation-grid3">
            <label className="form-label">
              Amount
              <select value={fields.amount as string} onChange={(e) => set("amount", e.target.value)}>
                {STOOL_AMOUNTS.map((a) => (
                  <option key={a} value={a}>{AMOUNT_LABELS[a]}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Consistency
              <select value={fields.consistency as string} onChange={(e) => set("consistency", e.target.value)}>
                {BOWEL_CONSISTENCIES.map((c) => (
                  <option key={c} value={c}>{BOWEL_CONSISTENCY_LABELS[c]}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Color
              <input value={fields.color as string} onChange={(e) => set("color", e.target.value)} placeholder="e.g. brown" />
            </label>
          </div>
          <div className="delegation-grid3">
            <label className="check-inline">
              <input type="checkbox" checked={fields.blood === true} onChange={(e) => set("blood", e.target.checked)} />{" "}
              Blood seen in stool
            </label>
            <label className="check-inline">
              <input type="checkbox" checked={fields.pain === true} onChange={(e) => set("pain", e.target.checked)} />{" "}
              Pain or straining
            </label>
          </div>
          <label className="form-label">
            Notes (optional)
            <textarea value={fields.notes as string} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </label>
        </>
      )}

      {kind === "bladder" && (
        <>
          <div className="delegation-grid3">
            <fieldset className="form-label">
              <legend>Continent</legend>
              <label className="radio-inline">
                <input type="radio" name="continent" checked={fields.continent === true} onChange={() => set("continent", true)} /> Yes
              </label>
              <label className="radio-inline">
                <input type="radio" name="continent" checked={fields.continent === false} onChange={() => set("continent", false)} /> No
              </label>
            </fieldset>
            <label className="form-label">
              Amount
              <select value={fields.amount as string} onChange={(e) => set("amount", e.target.value)}>
                {STOOL_AMOUNTS.map((a) => (
                  <option key={a} value={a}>{AMOUNT_LABELS[a]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-label">
            Notes (optional)
            <textarea value={fields.notes as string} onChange={(e) => set("notes", e.target.value)} rows={2} />
          </label>
        </>
      )}

      {kind === "emesis" && (
        <>
          <div className="delegation-grid3">
            <label className="form-label">
              Amount
              <select value={fields.amount as string} onChange={(e) => set("amount", e.target.value)}>
                {STOOL_AMOUNTS.map((a) => (
                  <option key={a} value={a}>{AMOUNT_LABELS[a]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-label">
            Description (optional)
            <textarea value={fields.description as string} onChange={(e) => set("description", e.target.value)} rows={2} />
          </label>
        </>
      )}

      {kind === "skin" && (
        <>
          <div className="delegation-grid3">
            <label className="form-label">
              Body location
              <select value={fields.bodyLocation as string} onChange={(e) => set("bodyLocation", e.target.value)}>
                {BODY_LOCATIONS.map((loc) => (
                  <option key={loc} value={loc}>{loc}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Observation
              <select value={fields.observation as string} onChange={(e) => set("observation", e.target.value)}>
                {SKIN_OBSERVATIONS.map((o) => (
                  <option key={o} value={o}>{SKIN_OBSERVATION_LABELS[o]}</option>
                ))}
              </select>
            </label>
            <label className="form-label">
              Size (optional)
              <input value={fields.size as string} onChange={(e) => set("size", e.target.value)} placeholder="e.g. about the size of a quarter" />
            </label>
          </div>
          <label className="form-label">
            Description
            <textarea value={fields.description as string} onChange={(e) => set("description", e.target.value)} rows={2} />
          </label>
          <div className="delegation-grid3">
            <fieldset className="form-label">
              <legend>New or getting worse</legend>
              <label className="radio-inline">
                <input type="radio" name="worsening" checked={fields.worsening === true} onChange={() => set("worsening", true)} /> Yes
              </label>
              <label className="radio-inline">
                <input type="radio" name="worsening" checked={fields.worsening === false} onChange={() => set("worsening", false)} /> No
              </label>
            </fieldset>
            <label className="form-label">
              Follow-up date (optional)
              {input("followUpDate", "date")}
            </label>
            <label className="form-label">
              Photo (optional)
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
              />
            </label>
          </div>
        </>
      )}

      {kind === "vitals" && (
        <div className="delegation-grid3">
          <label className="form-label">Temperature (°F){input("tempF", "number", { step: "0.1" })}</label>
          <label className="form-label">BP systolic{input("bpSystolic", "number")}</label>
          <label className="form-label">BP diastolic{input("bpDiastolic", "number")}</label>
          <label className="form-label">Pulse (bpm){input("pulse", "number")}</label>
          <label className="form-label">Respirations (/min){input("respirations", "number")}</label>
          <label className="form-label">O2 saturation (%){input("o2Sat", "number")}</label>
          <label className="form-label">Weight (lb){input("weightLb", "number", { step: "0.1" })}</label>
        </div>
      )}

      {kind === "seizure" && (
        <>
          <div className="delegation-grid3">
            <label className="form-label">
              Duration (minutes, optional)
              {input("durationMinutes", "number", { min: 0, step: "0.5" })}
            </label>
          </div>
          <label className="form-label">
            What the seizure looked like
            <textarea value={fields.description as string} onChange={(e) => set("description", e.target.value)} rows={2} />
          </label>
          <label className="form-label">
            Possible triggers (optional)
            <input value={fields.triggers as string} onChange={(e) => set("triggers", e.target.value)} />
          </label>
          <label className="form-label">
            After the seizure (optional)
            <input value={fields.postEventState as string} onChange={(e) => set("postEventState", e.target.value)} />
          </label>
        </>
      )}

      {kind === "menses" && (
        <>
          <div className="delegation-grid3">
            <label className="form-label">
              Start date
              {input("startDate", "date")}
            </label>
            <label className="form-label">
              End date (optional)
              {input("endDate", "date")}
            </label>
            <label className="form-label">
              Flow
              <select value={fields.flow as string} onChange={(e) => set("flow", e.target.value)}>
                {MENSES_FLOWS.map((f) => (
                  <option key={f} value={f}>{FLOW_LABELS[f]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-label">
            Symptoms (optional)
            <textarea value={fields.symptoms as string} onChange={(e) => set("symptoms", e.target.value)} rows={2} />
          </label>
        </>
      )}

      {kind === "blood_sugar" && (
        <>
          <div className="delegation-grid3">
            <label className="form-label">
              Reading (mg/dL)
              {input("readingMgDl", "number")}
            </label>
            <label className="form-label">
              Context
              <select value={fields.context as string} onChange={(e) => set("context", e.target.value)}>
                {BLOOD_SUGAR_CONTEXTS.map((c) => (
                  <option key={c} value={c}>{BLOOD_SUGAR_CONTEXT_LABELS[c]}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="form-label">
            Symptoms (optional)
            <textarea value={fields.symptoms as string} onChange={(e) => set("symptoms", e.target.value)} rows={2} />
          </label>
        </>
      )}

      {errors.length > 0 && (
        <div className="form-error" role="alert">
          {errors.map((err, i) => (
            <div key={i}>{err}</div>
          ))}
        </div>
      )}
      {editing && (
        <label className="form-label">
          Reason for correction (required)
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. wrong temperature typed"
            maxLength={280}
          />
        </label>
      )}
      {saveNote && (
        <p className={saveNote.flagged ? "delegation-warn" : "delegation-small"} role="status">
          {saveNote.flagged ? <TriangleAlert size={14} /> : <CircleCheck size={14} />}{" "}
          {saveNote.text}
        </p>
      )}
      <button className="button primary" type="submit" disabled={saving}>
        {saving ? "Saving…" : editing ? "Save correction" : `Save ${HEALTH_TRACK_KIND_LABELS[kind].toLowerCase()} entry`}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Entry card                                                          */
/* ------------------------------------------------------------------ */

function HealthEntryCard({
  entry,
  canRecord,
  canReview,
  onChanged,
  onCorrect,
}: {
  entry: HealthTrackEntry;
  canRecord: boolean;
  canReview: boolean;
  onChanged: () => void;
  onCorrect: (entry: HealthTrackEntry) => void;
}) {
  const { api } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState<HealthTrackRevision[] | null>(null);
  const photoId = (entry.details as HealthTrackDetails & { photoId?: string }).photoId;

  async function handleVoid() {
    const reason = window.prompt("Why are you voiding this entry? (required)");
    if (reason === null) return;
    if (!isMeaningfulNote(reason)) {
      setError("Say why you are voiding this entry.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.voidHealthEntry(entry.id, reason.trim());
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleReview() {
    const note = window.prompt("Add a review note (required):");
    if (note === null) return;
    setBusy(true);
    setError("");
    try {
      await api.markHealthEntryReviewed(entry.id, note);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleRetryAlerts() {
    setBusy(true);
    setError("");
    try {
      await api.retryHealthAlerts(entry.id);
      onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleHistory() {
    if (showHistory) {
      setShowHistory(false);
      return;
    }
    setError("");
    try {
      const rows = await api.listHealthEntryRevisions(entry.id);
      setRevisions(rows);
      setShowHistory(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleViewPhoto() {
    setError("");
    try {
      const file = await api.getHealthPhoto(photoId!);
      if (!file) {
        setError("Photo not found.");
        return;
      }
      const url = URL.createObjectURL(file.blob);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const deliveryFailed =
    entry.alertDelivery === "failed" || entry.alertDelivery === "partial";

  return (
    <article className="health-entry">
      <header className="health-entry-head">
        <div>
          <strong>{HEALTH_TRACK_KIND_LABELS[entry.kind]}</strong>
          <span className="stack-help"> {formatDateTime(entry.occurredAt)}</span>
        </div>
        <div className="health-entry-badges">
          {entry.flagForNurse && <Badge status="Flagged for review" />}
          {entry.nurseReviewedAt ? (
            <Badge status="Reviewed" />
          ) : (
            entry.flagForNurse && <Badge status="Needs review" />
          )}
        </div>
      </header>
      <dl className="health-entry-details">
        {healthEntryDetailRows(entry.kind, entry.details).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {entry.flagForNurse && entry.flagReason && (
        <p className="delegation-warn">
          <TriangleAlert size={14} /> Flagged for review: {entry.flagReason}
        </p>
      )}
      {entry.alertDelivery && entry.alertDelivery !== "ok" && (
        <p className={`health-alert-status health-alert-status--${entry.alertDelivery}`}>
          <TriangleAlert size={14} />{" "}
          {entry.alertDelivery === "failed"
            ? "Alerts failed to send — the house manager, program manager, and nurse were not notified."
            : entry.alertDelivery === "partial"
              ? "Some alerts failed to send."
              : "Alerts are being sent…"}
          {entry.alertDeliveryError ? ` ${entry.alertDeliveryError}` : ""}
        </p>
      )}
      {entry.nurseReviewedAt && (
        <p className="stack-help">
          Reviewed{entry.nurseReviewedBy ? ` by ${entry.nurseReviewedBy}` : ""} on{" "}
          {formatDate(entry.nurseReviewedAt)}
          {entry.nurseNote ? ` — ${entry.nurseNote}` : ""}
        </p>
      )}
      <p className="stack-help">
        Recorded by {entry.recordedByName} on {formatDate(entry.createdAt)}.
      </p>
      {showHistory && revisions && (
        <div className="health-history" aria-label="Entry history">
          <h4>History</h4>
          <ol>
            {revisions.map((revision) => (
              <li key={revision.id}>
                <strong>{HEALTH_REVISION_ACTION_LABELS[revision.action]}</strong>
                {" by "}
                {revision.actorName || "unknown"}
                {" on "}
                {formatDateTime(revision.createdAt)}
                {revision.reason ? ` — ${revision.reason}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
      {error && <p className="form-error">{error}</p>}
      <div className="health-entry-actions">
        {photoId && (
          <button className="button" onClick={handleViewPhoto} disabled={busy}>
            <Eye size={14} /> View photo
          </button>
        )}
        {canReview && entry.flagForNurse && !entry.nurseReviewedAt && (
          <button className="button" onClick={handleReview} disabled={busy}>
            Mark reviewed
          </button>
        )}
        {canRecord && deliveryFailed && (
          <button className="button" onClick={handleRetryAlerts} disabled={busy}>
            Retry alerts
          </button>
        )}
        {canRecord && (
          <button className="button" onClick={() => onCorrect(entry)} disabled={busy}>
            Correct
          </button>
        )}
        <button className="button" onClick={toggleHistory} disabled={busy}>
          {showHistory ? "Hide history" : "History"}
        </button>
        {canRecord && (
          <button className="button" onClick={handleVoid} disabled={busy}>
            <Trash2 size={14} /> Void
          </button>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function HealthTrackPage({
  section,
  individualId,
  onSectionChange,
  onIndividualChange,
}: {
  section: HealthTrackSectionKey;
  individualId: string | null;
  onSectionChange: (s: HealthTrackSectionKey) => void;
  onIndividualChange: (id: string | null) => void;
}) {
  const { api, session, workspace, refresh } = useData();
  const [tab, setTab] = useState<HealthTrackSectionKey | "review">(section);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<HealthTrackEntry[]>([]);
  const [creating, setCreating] = useState(false);
  const [editingEntry, setEditingEntry] = useState<HealthTrackEntry | null>(null);
  const [from, setFrom] = useState(() => addDaysIso(todayLocalIso(), -6));
  const [to, setTo] = useState(() => todayLocalIso());
  const [summaryDate, setSummaryDate] = useState(() => todayLocalIso());
  const [printing, setPrinting] = useState(false);

  // Session-gated values are derived defensively so every hook below stays
  // unconditional; the early return comes after all hooks.
  const lockedSiteId = session ? lockedSiteIdFor(session) : null;
  const [siteId, setSiteId] = useState<string>(lockedSiteId ?? "");
  const canRecord = session ? canRecordHealthTrack(session) : false;
  const canReview = session ? canReviewHealthTrack(session) : false;
  const visible = session ? canSeeHealthTrack(session) : false;

  const sites = workspace?.sites ?? [];
  const selectedSite = sites.find((s) => s.id === siteId);
  const people = useMemo(
    () => individualsAtSite(workspace?.individuals ?? [], selectedSite),
    [workspace?.individuals, selectedSite],
  );
  const person = workspace?.individuals.find((p) => p.id === individualId);

  // If the session (and its locked site) resolves after first render.
  useEffect(() => {
    if (lockedSiteId && !siteId) setSiteId(lockedSiteId);
  }, [lockedSiteId, siteId]);
  // When an individual is preselected (opening from the chart shortcut or a
  // health alert deep link) but no site is chosen yet, adopt that person's
  // site so agency-wide roles see them in the Individual dropdown. Guarded on
  // an empty siteId so a later manual site change is never overridden.
  useEffect(() => {
    if (!lockedSiteId && !siteId && person?.siteId) {
      setSiteId(person.siteId);
    }
  }, [lockedSiteId, siteId, person]);
  useEffect(() => {
    if (individualId && people.length > 0 && !people.some((p) => p.id === individualId)) {
      onIndividualChange(null);
    }
  }, [individualId, people, onIndividualChange]);

  useEffect(() => {
    setTab(section);
  }, [section]);

  useEffect(() => {
    if (!session || !individualId) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .listHealthEntries({
        individualId,
        from,
        to,
        ...(tab === "review" ? { needsNurseReview: true } : {}),
      })
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [api, session, individualId, from, to, tab]);

  async function reload() {
    setError("");
    setEditingEntry(null);
    await refresh();
    if (!session || !individualId) return;
    try {
      const rows = await api.listHealthEntries({
        individualId,
        from,
        to,
        ...(tab === "review" ? { needsNurseReview: true } : {}),
      });
      setEntries(rows);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const sectionKinds = useMemo(
    () =>
      (HEALTH_TRACK_SECTIONS.find((s) => s.key === section)?.kinds ??
        []) as HealthTrackKind[],
    [section],
  );

  const visibleEntries = useMemo(() => {
    const list = tab === "review" ? entries : entries.filter((e) => sectionKinds.includes(e.kind));
    return sortHealthEntriesDesc(list);
  }, [entries, tab, sectionKinds]);

  const grouped = useMemo(() => {
    const map = new Map<string, HealthTrackEntry[]>();
    for (const entry of visibleEntries) {
      const day = dayKeyOf(entry.occurredAt);
      const list = map.get(day) ?? [];
      list.push(entry);
      map.set(day, list);
    }
    return [...map.entries()];
  }, [visibleEntries]);

  const daySummary = useMemo(
    () => (individualId ? summarizeHealthDay(entries, summaryDate) : null),
    [entries, individualId, summaryDate],
  );
  const weekSummary = useMemo(
    () =>
      individualId ? summarizeHealthWeek(entries, addDaysIso(summaryDate, -6)) : [],
    [entries, individualId, summaryDate],
  );

  if (!session || !visible) return null;
  const activeSession = session;

  async function handlePrint(mode: "download" | "print") {
    if (!person) return;
    setPrinting(true);
    setError("");
    try {
      const html = buildHealthLogHtml({
        agencyName: activeSession.agencyName,
        individualName: person.name,
        from,
        to,
        entries: sortHealthEntriesDesc(entries),
      });
      await openPrintable(
        healthLogFileName(person.name),
        new Blob([html], { type: "text/html" }),
        mode,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPrinting(false);
    }
  }

  return (
    <div data-tour="health-track">
      <PageHeading
        title="Health Track"
        description="Daily health logging — meals, fluids, elimination, skin checks, vitals, seizures, menses, and blood sugar."
      />
      {error && <p className="form-error">{error}</p>}

      <div className="tabs" role="tablist" aria-label="Health Track sections">
        {HEALTH_TRACK_SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={tab === s.key}
            className={tab === s.key ? "selected" : ""}
            onClick={() => {
              setTab(s.key);
              onSectionChange(s.key);
            }}
          >
            {s.label}
          </button>
        ))}
        {canReview && (
          <button
            type="button"
            role="tab"
            aria-selected={tab === "review"}
            className={tab === "review" ? "selected" : ""}
            onClick={() => setTab("review")}
          >
            Needs review
          </button>
        )}
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>Individual</h2>
        </div>
        <div className="delegation-grid3">
          <label className="form-label">
            Program site
            <select
              aria-label="Program site"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              disabled={Boolean(lockedSiteId)}
            >
              {!lockedSiteId && <option value="">Select a site…</option>}
              {(lockedSiteId ? sites.filter((s) => s.id === lockedSiteId) : sites).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Individual
            <select
              aria-label="Individual"
              value={individualId ?? ""}
              onChange={(e) => onIndividualChange(e.target.value || null)}
              disabled={!siteId}
            >
              <option value="">{siteId ? "Select…" : "Choose a site first"}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <div className="form-label">
            <span>Date range</span>
            <div className="health-range">
              <input
                type="date"
                aria-label="From date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
              <span aria-hidden="true">–</span>
              <input
                type="date"
                aria-label="To date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
              />
            </div>
          </div>
        </div>
      </section>

      {!individualId ? (
        <Empty title="Choose an individual to see their health track." />
      ) : (
        <>
          {daySummary && (
            <section className="panel" aria-label="Day summary">
              <div className="panel-heading">
                <h2>Day summary</h2>
                <input
                  type="date"
                  aria-label="Summary date"
                  value={summaryDate}
                  onChange={(e) => setSummaryDate(e.target.value)}
                />
              </div>
              <dl className="health-summary-strip">
                <div><dt>Entries</dt><dd>{daySummary.entriesCount}</dd></div>
                <div><dt>Meals logged</dt><dd>{daySummary.mealsLogged}</dd></div>
                <div><dt>Meals refused</dt><dd>{daySummary.mealsRefused}</dd></div>
                <div><dt>Fluid ounces</dt><dd>{daySummary.fluidsOz}</dd></div>
                <div><dt>Bowel movements</dt><dd>{daySummary.bmCount}</dd></div>
                <div><dt>Flagged</dt><dd>{daySummary.flaggedCount}</dd></div>
              </dl>
            </section>
          )}

          <section className="panel" aria-label="Seven day summary">
            <div className="panel-heading">
              <h2>Last 7 days</h2>
            </div>
            <div className="table-scroll">
              <table className="delegation-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Entries</th>
                    <th>Meals</th>
                    <th>Meals refused</th>
                    <th>Fluid oz</th>
                    <th>BMs</th>
                    <th>Flagged</th>
                  </tr>
                </thead>
                <tbody>
                  {weekSummary.map((day) => (
                    <tr key={day.date}>
                      <td>{formatDate(day.date)}</td>
                      <td>{day.entriesCount}</td>
                      <td>{day.mealsLogged}</td>
                      <td>{day.mealsRefused}</td>
                      <td>{day.fluidsOz}</td>
                      <td>{day.bmCount}</td>
                      <td>{day.flaggedCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h2>
                {tab === "review"
                  ? "Needs review"
                  : HEALTH_TRACK_SECTIONS.find((s) => s.key === section)?.label}
              </h2>
              <div className="panel-actions">
                {canRecord && tab !== "review" && (
                  <button className="button" onClick={() => setCreating((v) => !v)}>
                    <Plus size={16} /> {creating ? "Cancel" : "Add entry"}
                  </button>
                )}
                <button className="button" onClick={() => handlePrint("download")} disabled={printing}>
                  <Download size={16} /> Download log
                </button>
                <button className="button" onClick={() => handlePrint("print")} disabled={printing}>
                  <Printer size={16} /> Print log
                </button>
              </div>
            </div>
            {creating && canRecord && tab !== "review" && (
              <QuickAddForm
                individualId={individualId}
                section={section}
                onSaved={() => {
                  setCreating(false);
                  void reload();
                }}
              />
            )}
            {editingEntry && canRecord && (
              <QuickAddForm
                individualId={individualId}
                section={section}
                editing={editingEntry}
                onSaved={() => {
                  setEditingEntry(null);
                  void reload();
                }}
              />
            )}
            {loading ? (
              <p className="muted">Loading entries…</p>
            ) : grouped.length === 0 ? (
              <Empty
                title={
                  tab === "review"
                    ? "Nothing waiting for review."
                    : "No entries in this range."
                }
              />
            ) : (
              grouped.map(([day, dayEntries]) => (
                <div key={day} className="health-day-group">
                  <h3 className="health-day-heading">{formatDate(day)}</h3>
                  {dayEntries.map((entry) => (
                    <HealthEntryCard
                      key={entry.id}
                      entry={entry}
                      canRecord={canRecord}
                      canReview={canReview}
                      onChanged={() => void reload()}
                      onCorrect={(toCorrect) => {
                        setCreating(false);
                        setEditingEntry(toCorrect);
                      }}
                    />
                  ))}
                </div>
              ))
            )}
          </section>
        </>
      )}
    </div>
  );
}
