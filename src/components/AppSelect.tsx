import {
  Select,
  SelectContent,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type ListData,
} from "@ui-sdk/react/select";
import { ChevronDown } from "lucide-react";
import "./AppSelect.css";

export type AppSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

// A labelled group of options — the SDK rendering of a native
// <optgroup> (slice 11c, for MobileMar's Record type select). Group
// structure is user-visible semantics, so it is preserved, never
// flattened into the surrounding list.
export type AppSelectGroup = {
  label: string;
  options: (string | AppSelectOption)[];
};

export type AppSelectEntry = string | AppSelectOption | AppSelectGroup;

type AppSelectProps = {
  value: string;
  onChange: (next: string) => void;
  options: AppSelectEntry[];
  ariaLabel?: string;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

function isGroup(entry: AppSelectEntry): entry is AppSelectGroup {
  return typeof entry === "object" && "options" in entry;
}

function normalizeOption(option: string | AppSelectOption): AppSelectOption {
  return typeof option === "string" ? { value: option, label: option } : option;
}

// Shared replacement for native <select> (UI SDK slice 11 pilot). The
// trigger carries the platform's select styling (AppSelect.css); the
// value contract is the native one — a selection commits its string
// value once, and there is no empty state unless a caller adds an
// option for it.
export function AppSelect({
  value,
  onChange,
  options,
  ariaLabel,
  className,
  id,
  name,
  required,
  disabled,
  placeholder,
}: AppSelectProps) {
  const flat: AppSelectOption[] = options.flatMap((entry) =>
    isGroup(entry) ? entry.options.map(normalizeOption) : [normalizeOption(entry)],
  );
  // The root items carry the same structure as data so the trigger can
  // resolve a grouped item's label before the list first opens.
  const items: ListData = options.map((entry) =>
    isGroup(entry)
      ? { type: "group", label: entry.label, items: entry.options.map(normalizeOption) }
      : normalizeOption(entry),
  );
  const renderItem = (option: AppSelectOption) => (
    <SelectItem
      key={option.value}
      value={option.value}
      label={option.label}
      disabled={option.disabled}
      className="app-select-option"
    >
      {option.label}
    </SelectItem>
  );
  return (
    <Select
      items={items}
      value={value}
      onValueChange={(next) => {
        if (next != null) onChange(next);
      }}
      name={name}
      required={required}
      disabled={disabled}
    >
      <SelectTrigger
        id={id}
        className={`app-select-trigger${className ? ` ${className}` : ""}`}
        aria-label={ariaLabel}
      >
        <span className="app-select-value-stack">
          <SelectValue placeholder={placeholder} />
          <span className="app-select-sizer" aria-hidden="true">
            {flat.reduce(
              (longest, o) => (o.label.length > longest.length ? o.label : longest),
              "",
            )}
          </span>
        </span>
        <ChevronDown size={12} aria-hidden="true" />
      </SelectTrigger>
      <SelectContent
        className="app-select-popup"
        onClick={(event) => {
          // A click inside the popup must not become a second click on the
          // trigger. When the select sits inside a <label> (the Employee
          // Hub's field pattern), the browser forwards any click on a
          // non-control descendant of the label to the labeled control —
          // the trigger — toggling it back open after the pick commits
          // and closes it. Preventing the click's default action stops
          // the forwarding. This runs in the bubble phase, after the
          // item's own handlers: the SDK treats a click that is already
          // default-prevented as vetoed, so preventing in the capture
          // phase would block the commit itself (slice 11b browser QA).
          event.preventDefault();
        }}
      >
        {options.map((entry) =>
          isGroup(entry) ? (
            <SelectGroup key={entry.label} className="app-select-group">
              <SelectGroupLabel className="app-select-group-label">
                {entry.label}
              </SelectGroupLabel>
              {entry.options.map((option) => renderItem(normalizeOption(option)))}
            </SelectGroup>
          ) : (
            renderItem(normalizeOption(entry))
          ),
        )}
      </SelectContent>
    </Select>
  );
}
