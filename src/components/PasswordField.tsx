import { useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * PasswordField — the app's single password-entry control.
 *
 * Masked by default (type="password"), following the sign-in screen's
 * pattern: the person typing may reveal their own entry with the eye
 * toggle, but a password is never rendered in plain text just because a
 * form happens to hold it. Used for every temporary-password entry
 * (agency setup, platform agency creation, staff account creation) so a
 * credential being handed to someone else is not left readable on
 * screen while the rest of the form is filled in.
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
  const [showPassword, setShowPassword] = useState(false);
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className="form-label">
      <label htmlFor={inputId}>{label}</label>
      <span className="password-field">
        <input
          id={inputId}
          type={showPassword ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          className="password-toggle"
          aria-label={showPassword ? "Hide password" : "Show password"}
          aria-pressed={showPassword}
          onClick={() => setShowPassword((v) => !v)}
        >
          {showPassword ? (
            <EyeOff size={20} aria-hidden="true" />
          ) : (
            <Eye size={20} aria-hidden="true" />
          )}
        </button>
      </span>
    </div>
  );
}
