import type { RefObject } from "react";
import { Building2, ChevronRight, FileText, Search, Users } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
} from "@ui-sdk/react/command";
import type { DirectoryHit } from "../data/search";
import type { Requirement } from "../domain";
import { formatDate } from "../components";
import "./GlobalSearch.css";

type IndividualHit = Extract<DirectoryHit, { kind: "individual" }>;
type StaffHit = Extract<DirectoryHit, { kind: "staff" }>;
type SiteHit = Extract<DirectoryHit, { kind: "site" }>;

/**
 * The topbar global search, on @ui-sdk/react's Command
 * (UI SDK slice 10b). The hand-rolled version was a plain input
 * plus a results div: no listbox semantics, no arrow-key
 * navigation, no aria-expanded/activedescendant wiring. This
 * wrapper keeps the house markup and classes — the Command root
 * IS the `.global-search` container, the panel keeps
 * `.search-results`, headings keep `.search-heading`, and rows
 * render as real buttons — and lets the primitive own the
 * keyboard model.
 *
 * App keeps every piece of state and data: the query, the open
 * flag, the input ref, the hit lists (already scoped and ranked
 * by src/data/search.ts before they arrive here), and the four
 * selection actions arrive as props, with the same bodies the
 * old onClick handlers had.
 *
 * Two contract choices are deliberate:
 *
 * - filter={false}: the documented mode for results filtered
 *   elsewhere. The SDK never re-filters or re-ranks the hits it
 *   is given, so the result set and order stay exactly what
 *   search.ts produced for the caller's scope.
 * - Escape is intercepted. The SDK's Escape clears the query;
 *   the old input's Escape closed the panel and kept the query.
 *   The wrapper vetoes the escape-key query change and closes
 *   the panel instead, reproducing the old transition exactly.
 */
export default function GlobalSearch({
  inputRef,
  query,
  onQueryChange,
  open,
  onOpenChange,
  directoryHits,
  requirementHits,
  onSelectIndividual,
  onSelectStaff,
  onSelectSite,
  onSelectRequirement,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQueryChange: (next: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Directory hits, pre-scoped and pre-ranked by the caller. */
  directoryHits: DirectoryHit[];
  /** Requirement hits, pre-scoped and pre-ranked by the caller. */
  requirementHits: Requirement[];
  onSelectIndividual: (hit: IndividualHit) => void;
  onSelectStaff: (hit: StaffHit) => void;
  onSelectSite: (hit: SiteHit) => void;
  onSelectRequirement: (hit: Requirement) => void;
}) {
  const individuals = directoryHits.filter(
    (h): h is IndividualHit => h.kind === "individual",
  );
  const staff = directoryHits.filter(
    (h): h is StaffHit => h.kind === "staff",
  );
  const sites = directoryHits.filter((h): h is SiteHit => h.kind === "site");
  const hasHits = directoryHits.length > 0 || requirementHits.length > 0;
  return (
    <Command
      className="global-search"
      filter={false}
      query={query}
      onQueryChange={(next, details) => {
        if (details.reason === "escape-key") {
          details.cancel();
          onOpenChange(false);
          return;
        }
        onQueryChange(next);
        if (details.reason === "input-change") {
          onOpenChange(true);
        }
      }}
      onClick={() => inputRef.current?.focus()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          onOpenChange(false);
        }
      }}
    >
      <Search size={16} aria-hidden="true" />
      <CommandInput
        ref={inputRef}
        placeholder="Search anything…"
        aria-label="Search people, homes, and requirements"
        onFocus={() => onOpenChange(true)}
      />
      <kbd>⌘ K</kbd>
      {open && query && (
        <div className="search-results">
          <CommandList>
              {individuals.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel className="search-heading">
                    Individuals
                  </CommandGroupLabel>
                  {individuals.map((h) => (
                    <CommandItem
                      key={`individual-${h.id}`}
                      value={`individual-${h.id}`}
                      render={<button type="button" />}
                      onSelect={() => onSelectIndividual(h)}
                    >
                      <Users size={17} />
                      <span>
                        <strong>{h.name}</strong>
                        <small>{h.site}</small>
                      </span>
                      <ChevronRight size={15} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {staff.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel className="search-heading">
                    Staff
                  </CommandGroupLabel>
                  {staff.map((h) => (
                    <CommandItem
                      key={`staff-${h.id}`}
                      value={`staff-${h.id}`}
                      render={<button type="button" />}
                      onSelect={() => onSelectStaff(h)}
                    >
                      <Users size={17} />
                      <span>
                        <strong>{h.name}</strong>
                        <small>{`${h.role}, ${h.site}`}</small>
                      </span>
                      <ChevronRight size={15} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {sites.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel className="search-heading">
                    Homes
                  </CommandGroupLabel>
                  {sites.map((h) => (
                    <CommandItem
                      key={`site-${h.id}`}
                      value={`site-${h.id}`}
                      render={<button type="button" />}
                      onSelect={() => onSelectSite(h)}
                    >
                      <Building2 size={17} />
                      <span>
                        <strong>{h.name}</strong>
                        <small>Home</small>
                      </span>
                      <ChevronRight size={15} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {requirementHits.length > 0 && (
                <CommandGroup>
                  <CommandGroupLabel className="search-heading">
                    Requirements and records
                  </CommandGroupLabel>
                  {requirementHits.map((r) => (
                    <CommandItem
                      key={r.id}
                      value={`requirement-${r.id}`}
                      render={<button type="button" />}
                      onSelect={() => onSelectRequirement(r)}
                    >
                      <FileText size={17} />
                      <span>
                        <strong>{r.title}</strong>
                        <small>
                          {r.person}, {r.site}
                        </small>
                        <small className="search-meta">
                          {r.category}, {r.status}, due {formatDate(r.due)}, page {r.page}
                        </small>
                      </span>
                      <ChevronRight size={15} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
          </CommandList>
          {!hasHits && (
            <CommandEmpty>
              No matching records. Try a name or site.
            </CommandEmpty>
          )}
        </div>
      )}
    </Command>
  );
}
