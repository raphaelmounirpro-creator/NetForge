import { CircleCheck, CircleHelp, CircleX, LoaderCircle, type LucideIcon } from "lucide-react";

export type StatusTone = "success" | "danger" | "neutral" | "pending";

interface StatusBadgeProps {
  tone: StatusTone;
  label: string;
}

// Chaque état combine un symbole et un texte : la couleur n'est jamais seule porteuse d'information.
const TONES: Record<StatusTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  danger: { icon: CircleX, className: "text-danger" },
  neutral: { icon: CircleHelp, className: "text-text-muted" },
  pending: { icon: LoaderCircle, className: "text-text-muted [&>svg]:motion-safe:animate-spin" },
};

export function StatusBadge({ tone, label }: StatusBadgeProps) {
  const { icon: Icon, className } = TONES[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${className}`}>
      <Icon aria-hidden="true" size={18} strokeWidth={2} />
      <span>{label}</span>
    </span>
  );
}
