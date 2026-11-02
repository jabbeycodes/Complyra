import { useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { WorkspaceIndividual } from "./types";

/** Initials avatar in the person's own workspace color (solid, no gradient). */
export function PersonAvatar({
  person,
  size = 44,
}: {
  person: Pick<WorkspaceIndividual, "name" | "initials" | "color" | "photoUrl">;
  size?: number;
}) {
  if (person.photoUrl) {
    return (
      <img
        className="msh-avatar"
        src={person.photoUrl}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="msh-avatar msh-avatar-initials"
      aria-hidden="true"
      style={{ width: size, height: size, background: person.color }}
    >
      {person.initials}
    </span>
  );
}

/**
 * Scoped people picker shared by the MAR and ISP flows: the Individuals of
 * the home picked in the shell, with search when the list is long.
 */
export default function MobilePeopleList({
  people,
  onPick,
  emptyText = "No Individuals at this home.",
  trailingFor,
}: {
  people: WorkspaceIndividual[];
  onPick: (person: WorkspaceIndividual) => void;
  emptyText?: string;
  /**
   * Optional right-hand content per row (the Personal Spending
   * chooser's per-person balance). Callers own its styling; money
   * amounts must use a non-truncating class (see .msh-row-amount).
   */
  trailingFor?: (person: WorkspaceIndividual) => ReactNode;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((person) => person.name.toLowerCase().includes(q));
  }, [people, query]);

  return (
    <div className="msh-people">
      {people.length > 6 && (
        <label className="msh-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Individuals"
            aria-label="Search Individuals"
          />
        </label>
      )}
      {filtered.length === 0 && <p className="msh-empty">{emptyText}</p>}
      <div className="msh-list">
        {filtered.map((person) => (
          <button
            key={person.id}
            type="button"
            className="msh-row"
            onClick={() => onPick(person)}
          >
            <PersonAvatar person={person} />
            <span className="msh-row-main">
              <strong>{person.name}</strong>
              <small>{person.site}</small>
            </span>
            {trailingFor?.(person)}
            <span className="msh-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
