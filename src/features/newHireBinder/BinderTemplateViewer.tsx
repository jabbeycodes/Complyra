/**
 * Binder template viewer (Wave 4D, 2026-11-06).
 *
 * The read-only sibling of BinderTemplateEditor: HR works every binder
 * the templates produce and needs to see exactly what a complete
 * binder requires, but editing stays with administrators and program
 * managers (canEditBinderTemplates / the hr_binder_templates write
 * policy). This component renders the full template contents — every
 * section, every item, its kind and whether it is required — with no
 * edit affordances at all: no inputs, no reorder or remove controls,
 * no save. Template switching is navigation, not editing.
 *
 * The snapshot rule still applies and is stated on screen: an issued
 * binder keeps the template snapshot it was opened with.
 */
import { useEffect, useState } from "react";
import type { HrStore } from "../../data/hrStore";
import {
  isRequiredBinderItem,
  type BinderItemKind,
  type BinderTemplate,
  type BinderTemplateLibrary,
} from "../../data/newHireBinder";

const KIND_LABELS: Record<BinderItemKind, string> = {
  document: "Wallet document — uploaded, HR verifies",
  certificate: "Certificate — linked to certificates of record",
  acknowledgment: "Acknowledgment — linked to a signed HR document",
  training: "Training — linked to the staff training checklist",
  profile: "Profile — satisfied by staff profile data",
  records: "Records — performance file pointer (never counted)",
};

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

interface TemplateChoice {
  id: string;
  name: string;
  meta: string;
  template: BinderTemplate;
}

export function BinderTemplateViewer({ store }: { store: HrStore }) {
  const [library, setLibrary] = useState<BinderTemplateLibrary | null>(null);
  const [selectedId, setSelectedId] = useState("default");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const lib = await store.listBinderTemplates();
        if (cancelled) return;
        setLibrary(lib);
      } catch (err) {
        if (cancelled) return;
        setError(errMessage(err, "Could not load the binder templates."));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [store]);

  const choices: TemplateChoice[] = library
    ? [
        {
          id: "default",
          name: "Agency default",
          meta: "For every role without a preset",
          template: library.defaultTemplate,
        },
        ...library.presets.map((preset) => ({
          id: preset.key,
          name: preset.name,
          meta: `Preset for the ${preset.name} role`,
          template: preset.template,
        })),
      ]
    : [];
  const selected =
    choices.find((choice) => choice.id === selectedId) ?? choices[0];

  return (
    <div className="binder-template-viewer">
      <p className="hub-sub">
        Read-only — template editing is limited to administrators and
        program managers. A binder keeps the snapshot of its template
        taken the day it was opened, so what you see here is what new
        binders will require.
      </p>
      {error && (
        <div className="hub-error" role="alert">
          {error}
        </div>
      )}
      {!library && !error && <p>Loading templates…</p>}
      {library && selected && (
        <>
          <div className="binder-board-views" role="group" aria-label="Templates">
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                className={`hub-btn${choice.id === selected.id ? " primary" : ""}`}
                onClick={() => setSelectedId(choice.id)}
              >
                {choice.name}
              </button>
            ))}
          </div>
          <p className="hub-sub">{selected.meta}</p>
          {selected.template.sections.map((section) => (
            <section key={section.key} className="binder-template-section">
              <h3>{section.title}</h3>
              <ul>
                {section.items.map((item) => (
                  <li key={item.key}>
                    <strong>{item.label}</strong> — {KIND_LABELS[item.kind]} ·{" "}
                    {isRequiredBinderItem(item) ? "Required" : "Optional"}
                    {item.matchKeys.length > 0
                      ? ` · Matches: ${item.matchKeys.join(", ")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
