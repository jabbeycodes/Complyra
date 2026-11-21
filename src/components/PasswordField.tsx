import { useId } from "react";
import { Eye, EyeOff } from "lucide-react";
import {
  PasswordInput,
  PasswordInputControl,
  PasswordInputToggle,
} from "@ui-sdk/react/password-input";

/**
 * PasswordField — the app's single password-entry control, on
 * @ui-sdk/react's Password Input (slice 4). Masked by default: the
 * person typing may reveal their own entry with the eye toggle, but a
 * password is never rendered in plain text just because a form happens
 * to hold it. Used for every temporary-password entry (agency setup,
 * platform agency creation, staff account creation) and sign-in, so a
 * credential being handed to someone else is not left readable on
 * screen while the rest of the form is filled in.
 *
 * The SDK toggle keeps the caret and focus in the field on a pointer
 * press, wires its own aria-pressed/aria-controls, and re-hides the
 * password when the form submits. The toggle's name follows the app's
 * existing pattern — "Show password" / "Hide password" by state.
 */
export default function PasswordField({
  id,
  label,
  value,
  onChange,
  minLength,
  required,
  autoComplete = "new-password",
}: {
  id?: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  minLength?: number;
  required?: boolean;
  autoComplete?: string;
}) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="form-label">
      <label htmlFor={inputId}>{label}</label>
      <PasswordInput
        className="password-field"
        value={value}
        onValueChange={(next) => onChange(next)}
        autoComplete={autoComplete}
        required={required}
      >
        <PasswordInputControl id={inputId} minLength={minLength} />
        <PasswordInputToggle
          render={(props, state) => (
            <button
              {...props}
              className="password-toggle"
              aria-label={state.visible ? "Hide password" : "Show password"}
            >
              {state.visible ? (
                <EyeOff size={20} aria-hidden="true" />
              ) : (
                <Eye size={20} aria-hidden="true" />
              )}
            </button>
          )}
        />
      </PasswordInput>
    </div>
  );
}
