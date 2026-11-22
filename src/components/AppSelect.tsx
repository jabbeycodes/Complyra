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
      <SelectContent className="app-select-popup">
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
