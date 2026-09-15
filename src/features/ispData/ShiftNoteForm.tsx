import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { Empty, Modal } from "../../components";
import { useData } from "../../data/DataProvider";
import { can } from "../../data/status";
import { useIspApi } from "./ispApi";
import {
  auditEchoChecklist,
  computeDueAt,
  validateIspNote,
} from "../../data/ispData";
import type { IspValidationIssue } from "../../data/ispData";
import SignatureAdoption from "../signatures/SignatureAdoption";
import type { AdoptedSignature } from "../../data/types";
import type {
  IspGoal,
  IspNote,
  IspNoteDetail,
  IspObjective,
  IspShiftPattern,
  IspTrackable,
  IspTrackableScoreInput,
  SubmitIspNoteInput,
} from "../../data/types";
import "./ispData.css";

const AMENDABLE_FIELDS = [
  { key: "serviceTitle", label: "Service title" },
  { key: "setting", label: "Setting" },
  { key: "timeIn", label: "Time in" },
  { key: "timeOut", label: "Time out" },
  { key: "servicesProvided", label: "Services provided" },
  { key: "individualResponse", label: "Individual response" },
] as const;

function addDaysIso(dateIso: string, days: number): string {
  const d = new Date(`${dateIso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

interface DraftScores {
  [trackableId: string]: IspTrackableScoreInput;
}

function emptyScores(): DraftScores {
  return {};
}

export default function ShiftNoteForm({
  siteId,
  individualId,
  individualName,
  individualDob,
  onSubmitted,
}: {
  siteId: string;
  individualId: string;
  individualName: string;
  individualDob: string;
  onSubmitted: (note: IspNote) => void;
}) {
  const isp = useIspApi();
  const { api, session } = useData();
  const [patterns, setPatterns] = useState<IspShiftPattern[]>([]);
  const [trackables, setTrackables] = useState<IspTrackable[]>([]);
  const [goals, setGoals] = useState<IspGoal[]>([]);
  const [objectives, setObjectives] = useState<IspObjective[]>([]);
  const [graceMinutes, setGraceMinutes] = useState(0);
  const [adopted, setAdopted] = useState<AdoptedSignature | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [workDate, setWorkDate] = useState(todayIso());
  const [shiftPatternId, setShiftPatternId] = useState("");
  const [serviceTitle, setServiceTitle] = useState("");
  const [setting, setSetting] = useState("");
  const [timeIn, setTimeIn] = useState("");
  const [timeOut, setTimeOut] = useState("");
  const [servicesProvided, setServicesProvided] = useState("");
  const [individualResponse, setIndividualResponse] = useState("");
  const [selectedObjectives, setSelectedObjectives] = useState<string[]>([]);
  const [scores, setScores] = useState<DraftScores>(emptyScores());
  const [lateReason, setLateReason] = useState("");
  const [issues, setIssues] = useState<IspValidationIssue[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [dueAt, setDueAt] = useState<string | null>(null);

  // Amendment state
  const [recentNotes, setRecentNotes] = useState<IspNote[]>([]);
  const [amendNoteId, setAmendNoteId] = useState("");
  const [amendDetail, setAmendDetail] = useState<IspNoteDetail | null>(null);
  const [amendValues, setAmendValues] = useState<Record<string, string>>({});
  const [amendReason, setAmendReason] = useState("");
  const [amendError, setAmendError] = useState("");
  const [amendBusy, setAmendBusy] = useState(false);
  const [amendSaved, setAmendSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError("");
      try {
        const [pats, trk, settings, sig, goalsRows] = await Promise.all([
          isp.ispListShiftPatterns(siteId),
          isp.ispListMyTrackables(individualId),
          isp.ispGetNoteSettings(),
          api.getMySignature(),
          isp.ispListGoals(individualId),
        ]);
        if (cancelled) return;
        setPatterns(pats.filter((p) => p.active));
        setTrackables(trk.filter((t) => t.active));
        setGraceMinutes(settings.noteGraceMinutes);
        setAdopted(sig);
        setGoals(goalsRows);
        const objs: IspObjective[] = [];
        for (const g of goalsRows) {
          const rows = await isp.ispListObjectives(g.id);
          objs.push(...rows.filter((o) => o.status === "active"));
        }
        if (cancelled) return;
        setObjectives(objs);
        const notes = await isp.ispListNotes({ individualId, siteId });
        if (cancelled) return;
        setRecentNotes(notes.slice(0, 20));
      } catch (err) {
        if (!cancelled)
          setLoadError(
            err instanceof Error ? err.message : "Could not load note setup.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, individualId]);

  // Default: link every active objective on the plan.
  useEffect(() => {
    if (selectedObjectives.length === 0 && objectives.length > 0) {
      setSelectedObjectives(objectives.map((o) => o.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectives]);

  // Resolve the due-at for the chosen date/shift so late entries self-label.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDueAt(null);
      try {
        if (shiftPatternId) {
          const pattern = patterns.find((p) => p.id === shiftPatternId);
          if (pattern) {
            let endDate = workDate;
            if (pattern.endTime <= pattern.startTime) {
              endDate = addDaysIso(workDate, 1); // overnight shift
            }
            setDueAt(computeDueAt(endDate, pattern.endTime, graceMinutes));
            return;
          }
        }
        const expectations = await isp.ispListExpectations({
          siteId,
          individualId,
          fromDate: workDate,
          toDate: workDate,
        });
        const exp = expectations.find(
          (e) => !shiftPatternId || e.shiftPatternId === shiftPatternId,
        );
        if (!cancelled && exp) setDueAt(exp.dueAt);
      } catch {
        if (!cancelled) setDueAt(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workDate, shiftPatternId, patterns, graceMinutes, siteId, individualId]);

  const isLate = dueAt !== null && new Date() > new Date(dueAt);

  const requiredTrackables = useMemo(
    () => trackables.filter((t) => selectedObjectives.includes(t.objectiveId)),
    [trackables, selectedObjectives],
  );

  const objectiveById = useMemo(
    () => new Map(objectives.map((o) => [o.id, o])),
    [objectives],
  );

  const goalById = useMemo(
    () => new Map(goals.map((g) => [g.id, g])),
    [goals],
  );

  const draftDetail = useMemo<IspNoteDetail>(() => {
    const noteScores = requiredTrackables.map((t, i) => {
      const s = scores[t.id] ?? {};
      return {
        id: `draft-${i}`,
        noteId: "draft",
        trackableId: t.id,
        scoreYesNo: s.yesNo ?? null,
        scoreCount: s.count ?? null,
        scoreRating: s.rating ?? null,
        scorePercentage: s.percentage ?? null,
        scoreText: s.text ?? null,
        comment: s.comment ?? null,
      };
    });
    return {
      note: {
        id: "draft",
        agencyId: "",
        individualId,
        siteId,
        assignmentId: null,
        expectationId: null,
        workDate,
        shiftPatternId: shiftPatternId || null,
        serviceTitle,
        setting,
        timeIn,
        timeOut,
        servicesProvided,
        individualResponse,
        authorUserId: session?.userId ?? "",
        authorName: session?.fullName ?? "",
        authorTitle: session?.jobTitle ?? "",
        signatureMark: adopted ? adopted.signaturePath : null,
        signatureEventId: null,
        status: isLate ? "late" : "draft",
        submittedAt: null,
        createdAt: "",
      },
      scores: noteScores,
      amendments: [],
      expectation: null,
      individualName,
      shiftName: patterns.find((p) => p.id === shiftPatternId)?.name ?? null,
    };
  }, [
    workDate,
    shiftPatternId,
    serviceTitle,
    setting,
    timeIn,
    timeOut,
    servicesProvided,
    individualResponse,
    session,
    adopted,
    isLate,
    requiredTrackables,
    scores,
    patterns,
    individualId,
    siteId,
    individualName,
  ]);

  const echo = useMemo(() => auditEchoChecklist(draftDetail), [draftDetail]);

  function setScore(trackableId: string, patch: Partial<IspTrackableScoreInput>) {
    setScores((prev) => {
      const { trackableId: _cur, ...current } = prev[trackableId] ?? {};
      const { trackableId: _patch, ...rest } = patch;
      return {
        ...prev,
        [trackableId]: { trackableId, ...current, ...rest },
      };
    });
  }

  function buildInput(): SubmitIspNoteInput {
    const services =
      isLate && lateReason.trim()
        ? `Late entry reason: ${lateReason.trim()}\n\n${servicesProvided}`
        : servicesProvided;
    return {
      individualId,
      siteId,
      workDate,
      shiftPatternId: shiftPatternId || null,
      serviceTitle,
      setting,
      timeIn,
      timeOut,
      servicesProvided: services,
      individualResponse,
      objectiveIds: selectedObjectives,
      scores: requiredTrackables.map((t) => {
        const { trackableId: _tid, ...rest } = scores[t.id] ?? {};
        return { ...rest, trackableId: t.id };
      }),
      signatureMark: adopted ? adopted.signaturePath : "",
    };
  }

  async function handleSubmit() {
    setFormError("");
    if (!adopted) {
      setFormError("Adopt your signature before submitting a note.");
      return;
    }
    if (isLate && !lateReason.trim()) {
      setFormError(
        "This entry is past its due time — a late-entry reason is required.",
      );
      return;
    }
    const input = buildInput();
    const found = validateIspNote(input, {
      individualName,
      individualDob,
      requiredTrackables: requiredTrackables.map((t) => ({
        id: t.id,
        name: t.name,
        measurementMethod: t.measurementMethod,
        ratingMin: t.ratingMin,
        ratingMax: t.ratingMax,
      })),
    });
    setIssues(found);
    if (found.length > 0) {
      setFormError(
        `${found.length} item${found.length === 1 ? "" : "s"} need attention before this note can be submitted.`,
      );
      return;
    }
    setBusy(true);
    try {
      const note = await isp.ispSubmitNote(input);
      onSubmitted(note);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Could not submit the note.",
      );
    } finally {
      setBusy(false);
    }
  }

  function toggleObjective(id: string) {
    setSelectedObjectives((prev) =>
      prev.includes(id) ? prev.filter((o) => o !== id) : [...prev, id],
    );
  }

  async function loadAmendment(noteId: string) {
    setAmendNoteId(noteId);
    setAmendDetail(null);
    setAmendSaved(false);
    setAmendError("");
    if (!noteId) return;
    try {
      const detail = await isp.ispGetNote(noteId);
      setAmendDetail(detail);
      const values: Record<string, string> = {};
      for (const f of AMENDABLE_FIELDS) {
        values[f.key] = String(detail.note[f.key] ?? "");
      }
      setAmendValues(values);
    } catch (err) {
      setAmendError(
        err instanceof Error ? err.message : "Could not load the note.",
      );
    }
  }

  async function handleAmend() {
    if (!amendDetail) return;
    setAmendError("");
    if (!amendReason.trim()) {
      setAmendError("An amendment reason is required.");
      return;
    }
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of AMENDABLE_FIELDS) {
      const from = amendDetail.note[f.key];
      const to = amendValues[f.key] ?? "";
      if (String(from ?? "") !== String(to)) {
        changes[f.key] = { from, to };
      }
    }
    if (Object.keys(changes).length === 0) {
      setAmendError("Change at least one field to file an amendment.");
      return;
    }
    setAmendBusy(true);
    try {
      await isp.ispAmendNote({
        noteId: amendDetail.note.id,
        reason: amendReason.trim(),
        changes,
      });
      setAmendSaved(true);
      setAmendReason("");
      const refreshed = await isp.ispGetNote(amendDetail.note.id);
      setAmendDetail(refreshed);
    } catch (err) {
      setAmendError(
        err instanceof Error ? err.message : "Could not save the amendment.",
      );
    } finally {
      setAmendBusy(false);
    }
  }

  if (loading) return <div className="isp-panel">Loading note setup…</div>;
  if (loadError)
    return (
      <div className="isp-panel">
        <Empty title="Could not load" text={loadError} />
      </div>
    );

  const canRecord = session && can(session, "isp.record_notes");

  return (
    <div className="isp-wrap">
      {!canRecord && (
        <div className="isp-late-banner">
          Your role does not include note recording. Talk to your program
          manager if you believe this is wrong.
        </div>
      )}
      <div className="isp-note-layout">
        <div className="isp-panel">
          <h3>Record shift note — {individualName}</h3>
          <p className="isp-sub">
            Author {session?.fullName} ({session?.jobTitle}). Staff name and
            title come from your sign-in — they are never typed.
          </p>

          {isLate && (
            <div
              className="isp-late-banner"
              role="alert"
              style={{ marginBottom: 16 }}
            >
              This entry is past its due time. It will be filed as a late
              entry, and a reason is required.
            </div>
          )}

          <div className="isp-form-grid">
            <div className="isp-field">
              <span>
                <label htmlFor="isp-work-date">Service date</label>
              </span>
              <input
                id="isp-work-date"
                type="date"
                value={workDate}
                onChange={(e) => setWorkDate(e.target.value)}
                disabled={!canRecord}
              />
            </div>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-shift">Shift</label>
              </span>
              <select
                id="isp-shift"
                value={shiftPatternId}
                onChange={(e) => setShiftPatternId(e.target.value)}
                disabled={!canRecord}
              >
                <option value="">No shift pattern</option>
                {patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.startTime}–{p.endTime})
                  </option>
                ))}
              </select>
            </div>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-title">Service title</label>
              </span>
              <input
                id="isp-title"
                type="text"
                value={serviceTitle}
                onChange={(e) => setServiceTitle(e.target.value)}
                placeholder="e.g. Community integration outing"
                disabled={!canRecord}
              />
            </div>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-setting">Setting</label>
              </span>
              <input
                id="isp-setting"
                type="text"
                value={setting}
                onChange={(e) => setSetting(e.target.value)}
                placeholder="e.g. Home, day program, community"
                disabled={!canRecord}
              />
            </div>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-time-in">Time in</label>
              </span>
              <input
                id="isp-time-in"
                type="time"
                value={timeIn}
                onChange={(e) => setTimeIn(e.target.value)}
                disabled={!canRecord}
              />
            </div>
            <div className="isp-field">
              <span>
                <label htmlFor="isp-time-out">Time out</label>
              </span>
              <input
                id="isp-time-out"
                type="time"
                value={timeOut}
                onChange={(e) => setTimeOut(e.target.value)}
                disabled={!canRecord}
              />
            </div>
            <div className="isp-field isp-full">
              <span>
                <label htmlFor="isp-services">Services provided</label>
              </span>
              <textarea
                id="isp-services"
                value={servicesProvided}
                onChange={(e) => setServicesProvided(e.target.value)}
                placeholder="Describe what you did during the service, in enough detail that someone reading later understands the visit."
                disabled={!canRecord}
              />
            </div>
            <div className="isp-field isp-full">
              <span>
                <label htmlFor="isp-response">Individual response</label>
              </span>
              <textarea
                id="isp-response"
                value={individualResponse}
                onChange={(e) => setIndividualResponse(e.target.value)}
                placeholder="Describe what the individual did or said — not just a one-word label."
                disabled={!canRecord}
              />
            </div>
            {isLate && (
              <div className="isp-field isp-full">
                <span>
                  <label htmlFor="isp-late-reason">
                    Late-entry reason (required)
                  </label>
                </span>
                <textarea
                  id="isp-late-reason"
                  value={lateReason}
                  onChange={(e) => setLateReason(e.target.value)}
                  placeholder="Why is this note being entered after its due time?"
                  disabled={!canRecord}
                />
              </div>
            )}
          </div>

          <h3 style={{ marginTop: 24 }}>Linked objectives</h3>
          <p className="isp-sub">
            At least one objective is required. Trackables under unchecked
            objectives are not scored on this note.
          </p>
          {objectives.length === 0 ? (
            <Empty
              title="No objectives yet"
              text="The plan for this individual has no active objectives. A DPM can build them under Plan setup."
            />
          ) : (
            <div className="isp-list">
              {objectives.map((o) => (
                <label key={o.id} className="isp-trackable">
                  <span className="isp-sig-row">
                    <input
                      type="checkbox"
                      checked={selectedObjectives.includes(o.id)}
                      onChange={() => toggleObjective(o.id)}
                      disabled={!canRecord}
                      style={{ width: 22, height: 22 }}
                      aria-label={`Link objective ${o.title}`}
                    />
                    <span className="isp-t-name">{o.title}</span>
                    <span className="isp-badge">
                      {goalById.get(o.goalId)?.title ?? "Goal"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <h3 style={{ marginTop: 24 }}>Trackable scores</h3>
          <p className="isp-sub">
            Score each required trackable for this shift using its measurement
            method.
          </p>
          {requiredTrackables.length === 0 ? (
            <Empty
              title="Nothing to score"
              text="No active trackables under the linked objectives."
            />
          ) : (
            <div className="isp-list">
              {requiredTrackables.map((t) => (
                <TrackableInput
                  key={t.id}
                  trackable={t}
                  objectiveTitle={objectiveById.get(t.objectiveId)?.title}
                  value={scores[t.id] ?? { trackableId: t.id }}
                  onChange={(patch) => setScore(t.id, patch)}
                  disabled={!canRecord}
                />
              ))}
            </div>
          )}

          <h3 style={{ marginTop: 24 }}>Signature</h3>
          {adopted ? (
            <p className="isp-sig-stamp">
              ✓ {session?.fullName} — adopted e-signature on file (adopted{" "}
              {new Date(adopted.adoptedAt).toLocaleDateString()}).
            </p>
          ) : (
            <div className="isp-sig-row">
              <button
                type="button"
                className="isp-btn clay"
                onClick={() => setAdopting(true)}
              >
                Adopt your signature
              </button>
              <span className="isp-hint">
                Notes must carry your adopted signature (P.8.7).
              </span>
            </div>
          )}

          {formError && (
            <p role="alert" style={{ color: "#93382a", fontWeight: 700 }}>
              {formError}
            </p>
          )}
          {issues.length > 0 && (
            <ul style={{ color: "#93382a" }}>
              {issues.map((i) => (
                <li key={`${i.checkId}-${i.field}`}>
                  <strong>{i.checkId}</strong> — {i.message}
                </li>
              ))}
            </ul>
          )}

          <div className="isp-btn-row">
            <button
              type="button"
              className="isp-btn primary"
              onClick={handleSubmit}
              disabled={busy || !canRecord}
            >
              {busy
                ? "Submitting…"
                : isLate
                  ? "Submit late note"
                  : "Submit note"}
            </button>
          </div>
        </div>

        <aside className="isp-audit-echo" aria-label="Audit echo checklist">
          <h4>Audit echo</h4>
          <p style={{ margin: 0, fontSize: 14, color: "#4a4036" }}>
            Live read of how this draft holds up against the DMH note checks.
          </p>
          <ul>
            {echo.map((c) => (
              <li key={c.checkId}>
                <span
                  className={`isp-check ${c.pass ? "pass" : "fail"}`}
                  aria-label={c.pass ? "Passing" : "Failing"}
                >
                  {c.pass ? <Check size={14} /> : <X size={14} />}
                </span>
                <span>
                  <span className="isp-check-id">{c.checkId}</span> — {c.label}
                  <span className="isp-check-hint">{c.hint}</span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </div>

      <div className="isp-panel">
        <h3>Amend a submitted note</h3>
        <p className="isp-sub">
          Submitted notes are locked. Corrections go through an amendment —
          the original note is preserved and the change is logged with your
          reason.
        </p>
        <div className="isp-picker-row">
          <label>
            Note
            <select
              value={amendNoteId}
              onChange={(e) => void loadAmendment(e.target.value)}
            >
              <option value="">Choose a note…</option>
              {recentNotes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.workDate} · {n.serviceTitle || "(no title)"} ·{" "}
                  {n.status}
                </option>
              ))}
            </select>
          </label>
        </div>

        {amendDetail && (
          <div style={{ marginTop: 16 }}>
            <div className="isp-form-grid">
              {AMENDABLE_FIELDS.map((f) => (
                <div className="isp-field" key={f.key}>
                  <span>
                    <label htmlFor={`amend-${f.key}`}>{f.label}</label>
                  </span>
                  {f.key === "timeIn" || f.key === "timeOut" ? (
                    <input
                      id={`amend-${f.key}`}
                      type="time"
                      value={amendValues[f.key] ?? ""}
                      onChange={(e) =>
                        setAmendValues((v) => ({
                          ...v,
                          [f.key]: e.target.value,
                        }))
                      }
                    />
                  ) : (
                    <textarea
                      id={`amend-${f.key}`}
                      value={amendValues[f.key] ?? ""}
                      onChange={(e) =>
                        setAmendValues((v) => ({
                          ...v,
                          [f.key]: e.target.value,
                        }))
                      }
                    />
                  )}
                  <span className="isp-hint">
                    Original:{" "}
                    {String(amendDetail.note[f.key] ?? "") || "(blank)"}
                  </span>
                </div>
              ))}
              <div className="isp-field isp-full">
                <span>
                  <label htmlFor="amend-reason">
                    Amendment reason (required)
                  </label>
                </span>
                <textarea
                  id="amend-reason"
                  value={amendReason}
                  onChange={(e) => setAmendReason(e.target.value)}
                  placeholder="Why is this correction needed?"
                />
              </div>
            </div>
            {amendError && (
              <p role="alert" style={{ color: "#93382a", fontWeight: 700 }}>
                {amendError}
              </p>
            )}
            {amendSaved && (
              <p style={{ color: "#3f5c3b", fontWeight: 700 }}>
                Amendment saved. The original note is unchanged.
              </p>
            )}
            <div className="isp-btn-row">
              <button
                type="button"
                className="isp-btn clay"
                onClick={handleAmend}
                disabled={amendBusy}
              >
                {amendBusy ? "Saving…" : "File amendment"}
              </button>
            </div>

            {amendDetail.amendments.length > 0 && (
              <>
                <h4 style={{ marginTop: 20 }}>Amendment history</h4>
                <div className="isp-list">
                  {amendDetail.amendments.map((a) => (
                    <div className="isp-amendment" key={a.id}>
                      <div>
                        <strong>
                          {new Date(a.createdAt).toLocaleString()}
                        </strong>{" "}
                        — {a.reason}
                      </div>
                      {Object.entries(a.changes).map(([field, change]) => (
                        <div className="isp-diff" key={field}>
                          <span>{field}:</span>
                          <span className="isp-from">
                            {String(change.from ?? "") || "(blank)"}
                          </span>
                          <span>→</span>
                          <span className="isp-to">
                            {String(change.to ?? "") || "(blank)"}
                          </span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {adopting && (
        <Modal title="Adopt your signature" onClose={() => setAdopting(false)}>
          <SignatureAdoption
            onClose={() => setAdopting(false)}
            onAdopted={() => {
              setAdopting(false);
              void api.getMySignature().then(setAdopted);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function TrackableInput({
  trackable,
  objectiveTitle,
  value,
  onChange,
  disabled,
}: {
  trackable: IspTrackable;
  objectiveTitle?: string;
  value: IspTrackableScoreInput;
  onChange: (patch: Partial<IspTrackableScoreInput>) => void;
  disabled?: boolean;
}) {
  const methodLabel: Record<IspTrackable["measurementMethod"], string> = {
    yes_no: "Yes / No",
    count: "Count",
    rating_scale: "Rating scale",
    narrative: "Narrative",
    percentage: "Percentage",
  };
  return (
    <fieldset className="isp-trackable">
      <span className="isp-t-name">
        {trackable.name}{" "}
        <span className="isp-badge">{methodLabel[trackable.measurementMethod]}</span>
      </span>
      {objectiveTitle && (
        <span className="isp-t-prompt">Objective: {objectiveTitle}</span>
      )}
      {trackable.prompt && (
        <span className="isp-t-prompt">{trackable.prompt}</span>
      )}

      {trackable.measurementMethod === "yes_no" && (
        <div className="isp-segmented" role="group" aria-label={trackable.name}>
          <button
            type="button"
            aria-pressed={value.yesNo === true}
            onClick={() => onChange({ yesNo: true })}
            disabled={disabled}
          >
            Yes
          </button>
          <button
            type="button"
            aria-pressed={value.yesNo === false}
            onClick={() => onChange({ yesNo: false })}
            disabled={disabled}
          >
            No
          </button>
        </div>
      )}

      {trackable.measurementMethod === "count" && (
        <div className="isp-field">
          <span>
            <label htmlFor={`count-${trackable.id}`}>Count (0 or more)</label>
          </span>
          <input
            id={`count-${trackable.id}`}
            type="number"
            min={0}
            step={1}
            value={value.count ?? ""}
            onChange={(e) =>
              onChange({
                count: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            disabled={disabled}
          />
        </div>
      )}

      {trackable.measurementMethod === "rating_scale" && (
        <div className="isp-field">
          <span>
            <label htmlFor={`rating-${trackable.id}`}>
              Rating ({trackable.ratingMin ?? "?"}–{trackable.ratingMax ?? "?"})
              {trackable.ratingLabels
                ? ` — ${Object.entries(trackable.ratingLabels)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(", ")}`
                : ""}
            </label>
          </span>
          <input
            id={`rating-${trackable.id}`}
            type="number"
            min={trackable.ratingMin ?? undefined}
            max={trackable.ratingMax ?? undefined}
            step={1}
            value={value.rating ?? ""}
            onChange={(e) =>
              onChange({
                rating: e.target.value === "" ? null : Number(e.target.value),
              })
            }
            disabled={disabled}
          />
        </div>
      )}

      {trackable.measurementMethod === "narrative" && (
        <div className="isp-field">
          <span>
            <label htmlFor={`text-${trackable.id}`}>Narrative</label>
          </span>
          <textarea
            id={`text-${trackable.id}`}
            value={value.text ?? ""}
            onChange={(e) => onChange({ text: e.target.value || null })}
            disabled={disabled}
          />
        </div>
      )}

      {trackable.measurementMethod === "percentage" && (
        <div className="isp-field">
          <span>
            <label htmlFor={`pct-${trackable.id}`}>Percentage (0–100)</label>
          </span>
          <input
            id={`pct-${trackable.id}`}
            type="number"
            min={0}
            max={100}
            step={1}
            value={value.percentage ?? ""}
            onChange={(e) =>
              onChange({
                percentage:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
            disabled={disabled}
          />
        </div>
      )}

      <div className="isp-field">
        <span>
          <label htmlFor={`comment-${trackable.id}`}>
            Comment (optional — note a refusal here)
          </label>
        </span>
        <input
          id={`comment-${trackable.id}`}
          type="text"
          value={value.comment ?? ""}
          onChange={(e) => onChange({ comment: e.target.value || null })}
          disabled={disabled}
        />
      </div>
    </fieldset>
  );
}
