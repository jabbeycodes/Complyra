import { useRef } from "react";
import {
  Autocomplete,
  AutocompleteContent,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
} from "@ui-sdk/react/autocomplete";
import "./SuggestionInput.css";

type SuggestionInputProps = {
  value: string;
  onChange: (next: string) => void;
  suggestions: string[];
  type?: string;
  placeholder?: string;
  ariaLabel?: string;
  required?: boolean;
  autoComplete?: string;
  name?: string;
};

// Free-text input with a suggestion popup — the shared replacement for the
// native <datalist> fields (slice 10). The typed text is the value; a
// suggestion only fills it in. Suggestions open on focus, as a datalist's
// do, and the list is deduped because an Autocomplete item's value is its
// identity (a datalist could repeat a string; the fill text is identical).
export function SuggestionInput({
  value,
  onChange,
  suggestions,
  type,
  placeholder,
  ariaLabel,
  required,
  autoComplete,
  name,
}: SuggestionInputProps) {
  const uniqueSuggestions = [...new Set(suggestions)];
  const lastItemPressAt = useRef(0);
  return (
    <Autocomplete
      value={value}
      onValueChange={(next, details) => {
        if (details.reason === "item-press") {
          lastItemPressAt.current = Date.now();
        }
        onChange(next);
      }}
      onOpenChange={(next, details) => {
        // After a mouse pick the browser retargets the selecting click
        // onto the input as the popup unmounts, and the SDK reads that
        // as a trigger press and reopens the list — a datalist stayed
        // closed. Veto that one reopen; a later deliberate click, focus
        // or keystroke opens as usual.
        if (
          next &&
          details.reason === "trigger-press" &&
          Date.now() - lastItemPressAt.current < 750
        ) {
          lastItemPressAt.current = 0;
          details.cancel();
        }
      }}
      openOnFocus
      required={required}
      name={name}
    >
      <AutocompleteInput
        type={type}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoComplete={autoComplete}
      />
      <AutocompleteContent className="suggestion-popup">
        <AutocompleteList>
          {uniqueSuggestions.map((suggestion) => (
            <AutocompleteItem
              key={suggestion}
              value={suggestion}
              className="suggestion-option"
            >
              {suggestion}
            </AutocompleteItem>
          ))}
        </AutocompleteList>
      </AutocompleteContent>
    </Autocomplete>
  );
}
