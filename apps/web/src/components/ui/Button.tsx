import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "md" | "sm";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Requête en cours : le bouton est désactivé pour éviter une double soumission. */
  busy?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-accent text-on-accent border-accent hover:bg-accent-hover hover:border-accent-hover",
  secondary: "bg-transparent text-text border-border-strong hover:border-accent-text hover:text-accent-text",
  ghost: "bg-transparent text-text-muted border-transparent hover:text-text hover:border-border",
  danger: "bg-transparent text-danger border-danger hover:bg-danger hover:text-canvas",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: "min-h-10 px-4 text-sm",
  sm: "min-h-8 px-3 text-xs",
};

/** Bouton commun : transition de couleur et de bordure uniquement, sans déplacement. */
export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  disabled,
  className = "",
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled === true || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-md border font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ease-(--ease-standard) disabled:cursor-not-allowed disabled:opacity-50 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    />
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Nom accessible obligatoire : l'icône seule ne suffit pas. */
  label: string;
  icon: ReactNode;
  pressed?: boolean;
}

/** Bouton d'icône nommé (aria-label + infobulle). */
export function IconButton({ label, icon, pressed, className = "", type = "button", ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-md border text-text-muted transition-colors duration-(--duration-fast) ease-(--ease-standard) hover:text-text disabled:cursor-not-allowed disabled:opacity-40 ${
        pressed ? "border-accent-text bg-surface-raised text-accent-text" : "border-transparent hover:border-border"
      } ${className}`}
      {...rest}
    >
      {icon}
    </button>
  );
}
