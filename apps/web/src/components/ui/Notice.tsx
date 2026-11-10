import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type NoticeTone = "info" | "success" | "warning" | "danger";

const TONES: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: "border-border text-text" },
  success: { icon: CircleCheck, className: "border-success text-text" },
  warning: { icon: TriangleAlert, className: "border-warning text-text" },
  danger: { icon: CircleAlert, className: "border-danger text-text" },
};

const ICON_COLORS: Record<NoticeTone, string> = {
  info: "text-text-muted",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
};

interface NoticeProps {
  tone: NoticeTone;
  title?: string;
  children?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** Message persistant : symbole + texte, la couleur n'est jamais seule porteuse d'information. */
export function Notice({ tone, title, children, actions, className = "" }: NoticeProps) {
  const { icon: Icon, className: toneClass } = TONES[tone];
  return (
    <div className={`flex gap-3 rounded-md border border-l-4 bg-surface p-3 text-sm ${toneClass} ${className}`}>
      <Icon aria-hidden="true" size={18} className={`mt-0.5 shrink-0 ${ICON_COLORS[tone]}`} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="text-text-muted">{children}</div>}
        {actions && <div className="mt-1 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
