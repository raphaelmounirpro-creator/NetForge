import { useId, type TextareaHTMLAttributes } from "react";

interface TextAreaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> {
  label: string;
  hint?: string | undefined;
  error?: string | null;
}

/** Zone de texte avec libellé persistant ; l'erreur est annoncée et reliée au champ. */
export function TextArea({ label, hint, error, className = "", rows = 3, ...rest }: TextAreaProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <label htmlFor={id} className="text-xs font-medium text-text">
        {label}
      </label>
      <textarea
        id={id}
        rows={rows}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full rounded-sm border bg-canvas px-2 py-1.5 text-sm text-text transition-colors duration-(--duration-fast) disabled:opacity-60 ${
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
