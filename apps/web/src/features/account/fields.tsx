import { Eye, EyeOff } from "lucide-react";
import { useId, useState, type InputHTMLAttributes } from "react";
import { messages } from "../../i18n";

const t = messages.account;
const inputClass =
  "min-h-11 w-full rounded-sm border bg-canvas px-3 text-base text-text transition-colors duration-(--duration-fast) placeholder:text-text-muted disabled:opacity-60";

interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "type"> {
  label: string;
  hint?: string | undefined;
  error?: string | null | undefined;
}

function Described({ id, hint, error }: { id: string; hint?: string | undefined; error?: string | null | undefined }) {
  return (
    <>
      {hint && (
        <p id={`${id}-hint`} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-sm text-danger">
          ✕ {error}
        </p>
      )}
    </>
  );
}

const describedBy = (id: string, hint?: string, error?: string | null) => [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ") || undefined;

/** Adresse e-mail : libellé persistant, autocomplétion des gestionnaires d'identifiants, collage autorisé. */
export function EmailField({ label, hint, error, className = "", ...rest }: FieldProps) {
  const id = useId();
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <input
        id={id}
        type="email"
        inputMode="email"
        autoComplete="username"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        className={`${inputClass} ${error ? "border-danger" : "border-border-strong"}`}
        {...rest}
      />
      <Described id={id} hint={hint} error={error} />
    </div>
  );
}

/**
 * Mot de passe : affichage ou masquage par un bouton nommé, collage et
 * gestionnaires autorisés. La valeur ne vit que dans l'état du formulaire.
 */
export function PasswordField({ label, hint, error, className = "", ...rest }: FieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <label htmlFor={id} className="text-sm font-medium text-text">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          className={`${inputClass} pr-12 ${error ? "border-danger" : "border-border-strong"}`}
          {...rest}
        />
        <button
          type="button"
          aria-label={visible ? t.hidePassword : t.showPassword}
          aria-pressed={visible}
          onClick={() => {
            setVisible((value) => !value);
          }}
          className="absolute inset-y-0 right-0 inline-flex w-11 items-center justify-center rounded-sm text-text-muted hover:text-text"
        >
          {visible ? <EyeOff aria-hidden="true" size={18} /> : <Eye aria-hidden="true" size={18} />}
        </button>
      </div>
      <Described id={id} hint={hint} error={error} />
    </div>
  );
}
