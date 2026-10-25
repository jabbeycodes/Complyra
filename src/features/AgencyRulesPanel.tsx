/**
 * Agency rules. The Complyrer operator (Platform console) can change every
 * setting and its lock. An agency administrator (Settings) can change the
 * ones left unlocked. Changes take an effective time (now or later, never
 * backdated) and a reason; history is kept. Rules live in src/data/rules.ts
 * and the database functions in 20260926120000_rule_settings.sql.
 *
 * Overtime lines are live (open-shift pickups, weekly-hour flags, approaching
 * notices). The other categories are saved now and read as those checks connect.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import { History, Lock, LockOpen, Save, X } from "lucide-react";
import {
  RULE_CATALOG,
  RULE_CATEGORY_LABELS,
  formatRuleValue,
  parseRuleInput,
  validateRuleValue,
  type EffectiveRule,
  type RuleCategory,
  type RuleDefinition,
  type RuleLock,
  type RuleValueRow,
} from "../data/rules";
import { createRulesStore, type RulesStore } from "../data/rulesStore";
import type { PendingAgency, SessionUser } from "../data/types";

function localDateTimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

const SOURCE_LABEL: Record<EffectiveRule["source"], string> = {
  default: "Platform default",
  agency: "Set for this agency",
  site: "Set for a site",
};

export function AgencyRulesPanel({
  agencies,
  store,
  onSaved,
  audience = "operator",
}: {
  agencies: PendingAgency[];
  store: RulesStore;
  onSaved?: (message: string) => void;
  /** Operator can lock settings. Agency administrators only edit unlocked ones. */
  audience?: "operator" | "agency";
}) {
  const [agencyId, setAgencyId] = useState(agencies[0]?.id ?? "");
  const [effective, setEffective] = useState<EffectiveRule[]>([]);
  const [history, setHistory] = useState<RuleValueRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState<string | null>(null);
  const [draftValue, setDraftValue] = useState<string | boolean>("");
  const [draftWhen, setDraftWhen] = useState(localDateTimeValue(new Date()));
  const [draftReason, setDraftReason] = useState("");
  const [draftLock, setDraftLock] = useState<RuleLock | "">("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!agencyId && agencies[0]) setAgencyId(agencies[0].id);
  }, [agencies, agencyId]);

  const load = () => {
    if (!agencyId) return;
    setLoading(true);
    setError("");
    Promise.all([store.effectiveRules(agencyId), store.history(agencyId)])
      .then(([e, h]) => {
        setEffective(e);
        setHistory(h);
        setLoading(false);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Could not load settings.");
        setLoading(false);
      });
  };
  useEffect(load, [agencyId, store]);

  const grouped = useMemo(() => {
    const byCategory = new Map<RuleCategory, RuleDefinition[]>();
    for (const d of RULE_CATALOG) {
      byCategory.set(d.category, [...(byCategory.get(d.category) ?? []), d]);
    }
    return [...byCategory.entries()].map(([category, defs]) => ({
      category,
      defs: defs.sort((a, b) => a.sortOrder - b.sortOrder),
    }));
  }, []);

  const changed = effective.filter((e) => e.source !== "default").length;
  const agencyName = agencies.find((a) => a.id === agencyId)?.name ?? "";

  const startEdit = (d: RuleDefinition) => {
    const current = effective.find((e) => e.key === d.key);
    const value = current?.value ?? d.platformDefault;
    setEditing(d.key);
    setDraftValue(d.valueType === "boolean" ? Boolean(value) : Array.isArray(value) ? value.join(", ") : String(value));
    setDraftWhen(localDateTimeValue(new Date()));
    setDraftReason("");
    setDraftLock("");
    setError("");
  };

  const save = async (d: RuleDefinition) => {
    setBusy(true);
    setError("");
    try {
      const current = effective.find((e) => e.key === d.key);
      const parsed = parseRuleInput(d, draftValue);
      if (parsed === null) throw new Error(`Enter a value for ${d.label}.`);
      const valueChanged = JSON.stringify(parsed) !== JSON.stringify(current?.value ?? d.platformDefault);
      const lockChanged = draftLock !== "" && draftLock !== (current?.lock ?? d.defaultLock);
      if (!valueChanged && !lockChanged) throw new Error("Nothing changed.");
      if (valueChanged) {
        const problem = validateRuleValue(d, parsed);
        if (problem) throw new Error(problem);
      }
      const when = new Date(draftWhen);
      await store.setRule({
        agencyId,
        key: d.key,
        value: valueChanged ? parsed : null,
        reason: draftReason,
        effectiveFrom: Number.isFinite(when.getTime()) ? when.toISOString() : undefined,
        lock: lockChanged ? (draftLock as RuleLock) : null,
      });
      setEditing(null);
      const future = when.getTime() > Date.now() + 60_000;
      onSaved?.(
        future
          ? `${d.label} for ${agencyName} changes on ${fmtWhen(when.toISOString())}.`
          : `${d.label} updated for ${agencyName}.`,
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the setting.");
    } finally {
      setBusy(false);
    }
  };

  if (agencies.length === 0) {
    return (
      <section className="panel">
        <h2>Agency rules</h2>
        <p className="muted">No agencies yet.</p>
      </section>
    );
  }

  return (
    <section className="panel" aria-label="Agency rules">
      <h2>Agency rules</h2>
      <p className="muted">
        {audience === "operator" ? (
          <>
            Every rule is a setting you can change per agency. Changes apply from the time you choose (never backdated),
            need a reason, and keep their history. <Lock size={13} aria-hidden /> Locked settings can only be changed by
            Complyrer; <LockOpen size={13} aria-hidden /> unlocked ones the agency administrator can change too.
          </>
        ) : (
          <>
            Settings Complyrer has unlocked for your agency. Changes apply from the time you choose (never backdated),
            need a reason, and keep their history. Locked settings stay as Complyrer set them.
          </>
        )}
      </p>
      <p className="muted">
        Overtime settings apply now to open-shift pickups, weekly-hour flags, and approaching-overtime notices.
      </p>
      {audience === "operator" && (
      <label className="form-label" style={{ maxWidth: 420 }}>
        Agency
        <select id="rules-agency" value={agencyId} onChange={(e) => { setAgencyId(e.target.value); setEditing(null); }}>
          {agencies.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name} · {a.agencyCode}
            </option>
          ))}
        </select>
      </label>
      )}
      <p className="muted" aria-live="polite">
        {loading ? "Loading settings…" : `${changed} of ${RULE_CATALOG.length} settings differ from the platform defaults.`}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {grouped.map(({ category, defs }) => (
        <div key={category} style={{ marginTop: 18 }}>
          <h3>{RULE_CATEGORY_LABELS[category]}</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Setting</th>
                  <th>Default</th>
                  <th>Current</th>
                  <th>Lock</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {defs.map((d) => {
                  const current = effective.find((e) => e.key === d.key);
                  const rows = history.filter((h) => h.key === d.key);
                  const upcoming = rows.filter((h) => h.value !== null && h.effectiveFrom > new Date().toISOString());
                  const isEditing = editing === d.key;
                  const lockedToOperator = (current?.lock ?? d.defaultLock) === "operator";
                  const canChange = audience === "operator" || !lockedToOperator;
                  return (
                    <Fragment key={d.key}>
                      <tr>
                        <td>
                          <strong>{d.label}</strong>
                          {d.help && <div className="muted">{d.help}</div>}
                        </td>
                        <td>{formatRuleValue(d, d.platformDefault)}</td>
                        <td>
                          <strong>{formatRuleValue(d, current?.value ?? d.platformDefault)}</strong>
                          <div className="muted">{SOURCE_LABEL[current?.source ?? "default"]}</div>
                          {upcoming.map((u) => (
                            <div className="muted" key={u.id}>
                              Changes to {formatRuleValue(d, u.value)} on {fmtWhen(u.effectiveFrom)}
                            </div>
                          ))}
                        </td>
                        <td>
                          {(current?.lock ?? d.defaultLock) === "operator" ? (
                            <span title="Only Complyrer can change this"><Lock size={14} aria-hidden /> Complyrer</span>
                          ) : (
                            <span title="The agency administrator can change this"><LockOpen size={14} aria-hidden /> Agency</span>
                          )}
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          {canChange ? (
                            <button className="button" type="button" onClick={() => startEdit(d)} aria-label={`Change ${d.label}`}>
                              Change
                            </button>
                          ) : (
                            <span className="muted">Set by Complyrer</span>
                          )}{" "}
                          {rows.length > 0 && (
                            <button
                              className="button"
                              type="button"
                              onClick={() => setShowHistory(showHistory === d.key ? null : d.key)}
                              aria-label={`History for ${d.label}`}
                            >
                              <History size={14} aria-hidden /> {rows.length}
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={5}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
                              <label className="form-label">
                                New value{d.unit ? ` (${d.unit})` : ""}
                                {d.valueType === "boolean" ? (
                                  <select id={`rule-${d.key}-value`} value={String(draftValue)} onChange={(e) => setDraftValue(e.target.value === "true")}>
                                    <option value="true">On</option>
                                    <option value="false">Off</option>
                                  </select>
                                ) : d.valueType === "enum" ? (
                                  <select id={`rule-${d.key}-value`} value={String(draftValue)} onChange={(e) => setDraftValue(e.target.value)}>
                                    {(d.allowedValues ?? []).map((v) => (
                                      <option key={v} value={v}>{v.replace(/^\w/, (c) => c.toUpperCase())}</option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    id={`rule-${d.key}-value`}
                                    value={String(draftValue)}
                                    inputMode="decimal"
                                    placeholder={d.valueType === "number_list" ? "e.g. 30, 14, 7" : ""}
                                    onChange={(e) => setDraftValue(e.target.value)}
                                  />
                                )}
                              </label>
                              <label className="form-label">
                                Takes effect
                                <input id={`rule-${d.key}-when`} type="datetime-local" value={draftWhen} onChange={(e) => setDraftWhen(e.target.value)} />
                              </label>
                              {audience === "operator" && (
                              <label className="form-label">
                                Who can change it
                                <select id={`rule-${d.key}-lock`} value={draftLock} onChange={(e) => setDraftLock(e.target.value as RuleLock | "")}>
                                  <option value="">Keep as is</option>
                                  <option value="operator">Only Complyrer</option>
                                  <option value="agency">Agency administrator too</option>
                                </select>
                              </label>
                              )}
                              <label className="form-label" style={{ flex: "1 1 240px" }}>
                                Reason
                                <input id={`rule-${d.key}-reason`} value={draftReason} placeholder="e.g. Agency contract allows 45 hours" onChange={(e) => setDraftReason(e.target.value)} />
                              </label>
                              <button className="button primary" type="button" disabled={busy} onClick={() => save(d)}>
                                <Save size={14} aria-hidden /> Save
                              </button>
                              <button className="button" type="button" onClick={() => setEditing(null)}>
                                <X size={14} aria-hidden /> Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                      {showHistory === d.key && (
                        <tr>
                          <td colSpan={5}>
                            <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
                              {rows.map((h) => (
                                <li key={h.id}>
                                  {fmtWhen(h.createdAt)} · {h.setByName || "Someone"}
                                  {h.setAsOperator ? " (Complyrer)" : ""}:{" "}
                                  {h.value !== null ? `set to ${formatRuleValue(d, h.value)}` : ""}
                                  {h.value !== null && h.lock ? " and " : ""}
                                  {h.lock ? (h.lock === "operator" ? "locked to Complyrer" : "unlocked for the agency") : ""}
                                  {h.effectiveFrom > h.createdAt ? `, effective ${fmtWhen(h.effectiveFrom)}` : ""} · “{h.reason}”
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}

/** Settings page for an agency administrator. Locked rows stay read-only. */
export function AgencyAdminRules({
  session,
  onSaved,
}: {
  session: SessionUser;
  onSaved?: (message: string) => void;
}) {
  const store = useMemo(
    () =>
      createRulesStore({
        userId: session.userId,
        fullName: session.fullName,
        isOperator: Boolean(session.platformAdmin),
        adminOfAgencyId: session.agencyId,
        memberOfAgencyIds: [session.agencyId],
      }),
    [session.userId, session.fullName, session.agencyId, session.platformAdmin],
  );
  const agency: PendingAgency = {
    id: session.agencyId,
    name: session.agencyName,
    agencyCode: session.agencyCode,
    stateCode: "",
    provisionedBy: "self",
    status: "active",
  };
  return <AgencyRulesPanel agencies={[agency]} store={store} onSaved={onSaved} audience="agency" />;
}
