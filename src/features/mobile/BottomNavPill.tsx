/**
 * The floating bottom navigation pill — one component, two homes.
 *
 * The mobile shell renders it on its own screens (always expanded, as
 * shipped with the clean redesign); the desktop layout renders it across
 * the regular pages in mobile view via PlatformBottomNav, where it can
 * collapse to a slim remnant on scroll down. Destinations come from the
 * shared role-gated config in bottomNav.ts — an item a role cannot use
 * is never passed in.
 *
 * Collapsed is a remnant, not a disappearance: a slim tappable pill that
 * says what it does ("Navigation", with a raise chevron) and restores the
 * full pill on tap.
 */
import {
  ChevronUp,
  Home,
  LayoutGrid,
  ListTodo,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { BottomNavId, BottomNavItem } from "./bottomNav";

const NAV_ICONS: Record<BottomNavId, LucideIcon> = {
  home: Home,
  tasks: ListTodo,
  people: Users,
  more: LayoutGrid,
};

export default function BottomNavPill({
  items,
  activeId,
  taskCount,
  onSelect,
  collapsed = false,
  onRestore,
}: {
  items: BottomNavItem[];
  activeId: BottomNavId | null;
  taskCount: number;
  onSelect: (id: BottomNavId) => void;
  collapsed?: boolean;
  onRestore?: () => void;
}) {
  if (collapsed) {
    return (
      <button
        type="button"
        className="msh-bottomnav-remnant"
        aria-label="Show navigation"
        onClick={onRestore}
      >
        <ChevronUp size={16} aria-hidden="true" />
        <span>Navigation</span>
      </button>
    );
  }
  return (
    <nav className="msh-bottomnav" aria-label="Mobile">
      {items.map((item) => {
        const Icon = NAV_ICONS[item.id];
        return (
          <button
            key={item.id}
            type="button"
            className={`msh-nav-item${activeId === item.id ? " active" : ""}`}
            aria-label={item.label}
            aria-current={activeId === item.id ? "page" : undefined}
            onClick={() => onSelect(item.id)}
          >
            <span className="msh-nav-icon">
              <Icon size={22} aria-hidden="true" />
              {item.id === "tasks" && taskCount > 0 && (
                <span className="msh-nav-badge">{taskCount}</span>
              )}
            </span>
            <span className="msh-nav-label">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
