import { useId, type InputHTMLAttributes } from "react";

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  label: string;
  hint?: string | undefined;
  /** Message d'erreur relié au champ (aria-describedby + aria-invalid). */
  error?: string | null;
  /** Chasse fixe pour les valeurs techniques (adresses, nombres) ; police courante pour du texte. */
  mono?: boolean;
}

/** Champ avec libellé persistant ; l'erreur est annoncée et reliée au champ. */
export function TextField({ label, hint, error, mono = true, className = "", ...rest }: TextFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-xs font-medium text-text">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`min-h-9 w-full rounded-sm border bg-canvas px-2 ${mono ? "font-mono" : ""} text-sm text-text transition-colors duration-(--duration-fast) disabled:opacity-60 ${
          error ? "border-danger" : "border-border-strong"
        }`}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
