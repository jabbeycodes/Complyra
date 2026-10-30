/**
 * Binder template editor (New Hire Binder build 2, 2026-10-30).
 *
 * HR/admin edit the agency default template and the role presets
 * (Direct Support Professional, House Manager, Nurse) in one editor:
 * sections and items can be added, renamed, reordered, marked required
 * or optional, and removed.
 *
 * THE SNAPSHOT RULE, stated in the UI and enforced by the model: a
 * binder is a snapshot of its template taken the day it was opened.
 * Edits here apply only to binders opened from now on — an issued
 * binder never changes under its owner.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Check, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { HrStore } from "../../data/hrStore";
import {
  BINDER_TEMPLATE_PRESETS,
  DEFAULT_BINDER_TEMPLATE,
  cloneBinderTemplate,
  isRequiredBinderItem,
  mintBinderKey,
  validateBinderTemplate,
  type BinderItemKind,
  type BinderTemplate,
  type BinderTemplateItem,
  type BinderTemplateLibrary,
} from "../../data/newHireBinder";

const KIND_OPTIONS: Array<{ value: BinderItemKind; label: string }> = [
  { value: "document", label: "Wallet document — uploaded, HR verifies" },
  { value: "certificate", label: "Certificate — linked to certificates of record" },
  { value: "acknowledgment", label: "Acknowledgment — linked to a signed HR document" },
  { value: "training", label: "Training — linked to the staff training checklist" },
  { value: "profile", label: "Profile — satisfied by staff profile data" },
  { value: "records", label: "Records — performance file pointer (never counted)" },
];

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface TemplateChoice {
  id: string;
  name: string;
  meta: string;
  differences: string | null;
  starter: BinderTemplate;
}

export function BinderTemplateEditor({ store }: { store: HrStore }) {
  const [library, setLibrary] = useState<BinderTemplateLibrary | null>(null);
  const [selectedId, setSelectedId] = useState("default");
  const [draft, setDraft] = useState<BinderTemplate | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const choices: TemplateChoice[] = useMemo(() => {
    if (!library) return [];
    return [
      {
        id: "default",
        name: "Agency default",
        meta: "For every role without a preset",
        differences: null,
        starter: DEFAULT_BINDER_TEMPLATE,
      },
      ...library.presets.map((preset) => ({
        id: preset.key,
        name: preset.name,
        meta: `Preset for the ${preset.name} role`,
        differences: preset.differences,
        starter:
          BINDER_TEMPLATE_PRESETS.find((p) => p.key === preset.key)?.template ??
          preset.template,
      })),
    ];
  }, [library]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await store.listBinderTemplates();
        if (cancelled) return;
        setLibrary(lib);
        setDraft(
          cloneBinderTemplate(
            selectedId === "default"
              ? lib.defaultTemplate
              : (lib.presets.find((p) => p.key === selectedId)?.template ??
                lib.defaultTemplate),
          ),
        );
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load the binder templates."));
      }
    })();
    return () => {
      cancelled = true;
    };
    // selectedId is handled by pickTemplate below; reloads follow saves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, reloadKey]);

  const pickTemplate = (id: string) => {
    if (!library) return;
    setSelectedId(id);
    setError("");
    setNotice("");
    setDraft(
      cloneBinderTemplate(
        id === "default"
          ? library.defaultTemplate
          : (library.presets.find((p) => p.key === id)?.template ??
            library.defaultTemplate),
      ),
    );
  };

  const choice = choices.find((c) => c.id === selectedId);

  const mutate = (fn: (draft: BinderTemplate) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = cloneBinderTemplate(prev);
      fn(next);
      return next;
    });
    setNotice("");
  };

  const move = <T,>(list: T[], idx: number, dir: -1 | 1): T[] => {
    const target = idx + dir;
    if (target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
  };

  const addSection = () => {
    const title = newSectionTitle.trim();
    if (!title || !draft) return;
    mutate((d) => {
      const taken = new Set(d.sections.map((s) => s.key));
      d.sections.push({
        key: mintBinderKey(title, taken),
        title,
        items: [
          {
            key: mintBinderKey(
              "New document",
              new Set(d.sections.flatMap((s) => s.items.map((i) => i.key))),
            ),
            label: "New document",
            kind: "document",
            matchKeys: [],
          },
        ],
      });
    });
    setNewSectionTitle("");
  };

  const addItem = (sectionIdx: number, label: string, kind: BinderItemKind) => {
    mutate((d) => {
      const taken = new Set(d.sections.flatMap((s) => s.items.map((i) => i.key)));
      const item: BinderTemplateItem = {
        key: mintBinderKey(label, taken),
        label,
        kind,
        // Linked kinds start by matching their own label; HR refines.
        matchKeys: kind === "certificate" || kind === "acknowledgment" ? [label] : [],
      };
      d.sections[sectionIdx].items.push(item);
    });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      validateBinderTemplate(draft);
      await store.saveBinderTemplate(selectedId, draft);
      setNotice(
        "Template saved. It applies to binders opened from now on — binders already issued keep their snapshot.",
      );
      setReloadKey((k) => k + 1);
    } catch (err) {
      setError(errMessage(err, "Could not save the template."));
    } finally {
      setBusy(false);
    }
  };

  const resetToStarter = () => {
    if (!choice) return;
    setDraft(cloneBinderTemplate(choice.starter));
    setError("");
    setNotice("Starter restored in the editor — Save to make it the template.");
  };

  if (!library || !draft) {
    return error ? (
      <div className="hub-error" role="alert">
        {error}
      </div>
    ) : (
      <p>Loading templates…</p>
    );
  }

  const draftItems = draft.sections.flatMap((s) => s.items);
  const requiredCount = draftItems.filter(isRequiredBinderItem).length;

  return (
    <div className="binder-editor">
      <p className="binder-editor-note">
        <strong>Snapshot rule:</strong> a binder copies its template on the
        day it is opened. Editing a template here changes only binders
        opened from now on — binders already issued never change.
      </p>

      <div className="hub-chip-row binder-editor-picker" role="group" aria-label="Choose a template">
        {choices.map((c) => {
          const tpl =
            c.id === selectedId
              ? draft
              : c.id === "default"
                ? library.defaultTemplate
                : library.presets.find((p) => p.key === c.id)?.template;
          const count = tpl ? tpl.sections.flatMap((s) => s.items).length : 0;
          return (
            <button
              key={c.id}
              className={`hub-chip${c.id === selectedId ? " selected" : ""}`}
              onClick={() => pickTemplate(c.id)}
            >
              {c.name} · {count} items
            </button>
          );
        })}
      </div>

      <div className="binder-editor-head">
        <div>
          <h3>{choice?.name}</h3>
          <p className="hub-sub">
            {choice?.meta} — {draftItems.length} items, {requiredCount} required,{" "}
            {draftItems.length - requiredCount} optional. Optional items are
            tracked but never count against a binder's completeness.
          </p>
          {choice?.differences && (
            <p className="hub-sub">
              <em>Starter differences:</em> {choice.differences}
            </p>
          )}
        </div>
        <button className="hub-btn" onClick={resetToStarter} disabled={busy}>
          <RotateCcw size={15} /> Reset to starter
        </button>
      </div>

      {error && (
        <div className="hub-error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <p className="binder-editor-saved" role="status">
          <Check size={15} /> {notice}
        </p>
      )}

      {draft.sections.map((section, sIdx) => (
        <div className="binder-editor-section" key={section.key}>
          <div className="binder-editor-section-head">
            <input
              className="binder-editor-title"
              value={section.title}
              aria-label="Section title"
              onChange={(e) =>
                mutate((d) => {
                  d.sections[sIdx].title = e.target.value;
                })
              }
            />
            <span className="binder-editor-controls">
              <button
                className="hub-btn"
                aria-label={`Move section ${section.title} up`}
                disabled={sIdx === 0}
                onClick={() =>
                  mutate((d) => {
                    d.sections = move(d.sections, sIdx, -1);
                  })
                }
              >
                <ArrowUp size={15} />
              </button>
              <button
                className="hub-btn"
                aria-label={`Move section ${section.title} down`}
                disabled={sIdx === draft.sections.length - 1}
                onClick={() =>
                  mutate((d) => {
                    d.sections = move(d.sections, sIdx, 1);
                  })
                }
              >
                <ArrowDown size={15} />
              </button>
              <button
                className="hub-btn danger"
                aria-label={`Remove section ${section.title}`}
                onClick={() =>
                  mutate((d) => {
                    d.sections.splice(sIdx, 1);
                  })
                }
              >
                <Trash2 size={15} />
              </button>
            </span>
          </div>
          <p className="binder-editor-section-note">
            Removing this section affects future binders only.
          </p>

          {section.items.map((item, iIdx) => (
            <div className="binder-editor-item" key={item.key}>
              <div className="binder-editor-item-row">
                <input
                  className="binder-editor-label"
                  value={item.label}
                  aria-label="Item label"
                  onChange={(e) =>
                    mutate((d) => {
                      d.sections[sIdx].items[iIdx].label = e.target.value;
                    })
                  }
                />
                <label className="binder-editor-required">
                  <input
                    type="checkbox"
                    checked={isRequiredBinderItem(item)}
                    onChange={(e) =>
                      mutate((d) => {
                        d.sections[sIdx].items[iIdx].required = e.target.checked;
                      })
                    }
                  />
                  Required
                </label>
                <span className="binder-editor-controls">
                  <button
                    className="hub-btn"
                    aria-label={`Move ${item.label} up`}
                    disabled={iIdx === 0}
                    onClick={() =>
                      mutate((d) => {
                        d.sections[sIdx].items = move(d.sections[sIdx].items, iIdx, -1);
                      })
                    }
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    className="hub-btn"
                    aria-label={`Move ${item.label} down`}
                    disabled={iIdx === section.items.length - 1}
                    onClick={() =>
                      mutate((d) => {
                        d.sections[sIdx].items = move(d.sections[sIdx].items, iIdx, 1);
                      })
                    }
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    className="hub-btn danger"
                    aria-label={`Remove ${item.label}`}
                    onClick={() =>
                      mutate((d) => {
                        d.sections[sIdx].items.splice(iIdx, 1);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </span>
              </div>
              <div className="binder-editor-item-row">
                <label className="binder-editor-kind">
                  Kind
                  <select
                    value={item.kind}
                    onChange={(e) =>
                      mutate((d) => {
                        const target = d.sections[sIdx].items[iIdx];
                        target.kind = e.target.value as BinderItemKind;
                        if (
                          (target.kind === "certificate" ||
                            target.kind === "acknowledgment") &&
                          target.matchKeys.length === 0
                        ) {
                          target.matchKeys = [target.label];
                        }
                      })
                    }
                  >
                    {KIND_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                {(item.kind === "certificate" || item.kind === "acknowledgment") && (
                  <label className="binder-editor-match">
                    Matches records named
                    <input
                      value={item.matchKeys.join(", ")}
                      placeholder="Names this item matches, comma-separated"
                      onChange={(e) =>
                        mutate((d) => {
                          d.sections[sIdx].items[iIdx].matchKeys = e.target.value
                            .split(",")
                            .map((k) => k.trim())
                            .filter(Boolean);
                        })
                      }
                    />
                  </label>
                )}
                {item.kind === "document" && (
                  <label className="binder-editor-required">
                    <input
                      type="checkbox"
                      checked={!!item.withObtainedDate}
                      onChange={(e) =>
                        mutate((d) => {
                          d.sections[sIdx].items[iIdx].withObtainedDate =
                            e.target.checked;
                        })
                      }
                    />
                    Carries an “obtained on” date
                  </label>
                )}
              </div>
            </div>
          ))}

          <AddItemForm
            onAdd={(label, kind) => addItem(sIdx, label, kind)}
          />
        </div>
      ))}

      <div className="binder-editor-add-section">
        <input
          value={newSectionTitle}
          placeholder="New section title"
          aria-label="New section title"
          onChange={(e) => setNewSectionTitle(e.target.value)}
        />
        <button className="hub-btn" onClick={addSection} disabled={!newSectionTitle.trim()}>
          <Plus size={15} /> Add section
        </button>
      </div>

      <div className="binder-editor-footer">
        <button className="hub-btn primary" onClick={save} disabled={busy}>
          <Check size={16} /> Save template
        </button>
        <span className="hub-sub">
          Saving applies to binders opened from now on. Issued binders are
          snapshots and do not change.
        </span>
      </div>
    </div>
  );
}

function AddItemForm({
  onAdd,
}: {
  onAdd: (label: string, kind: BinderItemKind) => void;
}) {
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<BinderItemKind>("document");
  return (
    <div className="binder-editor-add-item">
      <input
        value={label}
        placeholder="New item label"
        aria-label="New item label"
        onChange={(e) => setLabel(e.target.value)}
      />
      <select
        value={kind}
        aria-label="New item kind"
        onChange={(e) => setKind(e.target.value as BinderItemKind)}
      >
        {KIND_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        className="hub-btn"
        disabled={!label.trim()}
        onClick={() => {
          onAdd(label.trim(), kind);
          setLabel("");
        }}
      >
        <Plus size={15} /> Add item
      </button>
    </div>
  );
}
