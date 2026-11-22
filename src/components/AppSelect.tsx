import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select";
import { ChevronDown } from "lucide-react";
import "./AppSelect.css";

export type AppSelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

type AppSelectProps = {
  value: string;
  onChange: (next: string) => void;
  options: (string | AppSelectOption)[];
  ariaLabel?: string;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
};

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
  const normalized: AppSelectOption[] = options.map((option) =>
    typeof option === "string" ? { value: option, label: option } : option,
  );
  return (
    <Select
      items={normalized}
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
            {normalized.reduce(
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
        {normalized.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            label={option.label}
            disabled={option.disabled}
            className="app-select-option"
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
