import { useState } from 'react';

/**
 * A password input with a show/hide toggle.
 *
 * Why this exists as a component rather than a local `useState` in each form: there are
 * already three password inputs across sign-in, create-account and reset-password, and the
 * details that make the toggle safe (a `type="button"` that cannot submit the form, a
 * label that changes with state, autocomplete surviving the type switch) are exactly the
 * ones that get dropped when the pattern is retyped.
 *
 * Revealing a password is a deliberate trade. It is the single most effective fix for
 * mistyped passwords on phones — where the keyboard is small, autocorrect interferes and
 * the account being created is often abandoned after two failed attempts — at the cost of
 * making the password shoulder-surfable while shown. It is off by default and the user
 * chooses, which is the trade every major sign-up form now makes.
 */

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /**
   * `new-password` on create-account and reset forms, `current-password` on sign-in.
   * Getting this right is what lets a password manager offer to generate a strong one
   * rather than autofilling the old one.
   */
  autoComplete?: 'new-password' | 'current-password';
  required?: boolean;
  placeholder?: string;
  /** Marks the input invalid for assistive tech, e.g. while the two entries differ. */
  invalid?: boolean;
}

export function PasswordField({
  id,
  value,
  onChange,
  autoComplete = 'current-password',
  required,
  placeholder,
  invalid,
}: Props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-field">
      <input
        id={id}
        // Switching the type is what reveals the value. Password managers follow the
        // change without losing track of the field, so autofill keeps working.
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
      />
      <button
        // Must be an explicit button type. The default inside a <form> is "submit", so
        // without this, revealing the password would submit a half-filled form.
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        // The label carries the state, so a screen reader announces what the button will
        // do next rather than just "button". Deliberately left in the tab order: someone
        // navigating by keyboard has the same reason to check what they typed.
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
}

/* Inline SVG rather than an icon package: two icons do not justify a dependency, and
   `currentColor` means they follow the surrounding text colour in both themes. */

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}
