import { CircleAlert, CircleCheck, CircleDot, Eye, GitCompareArrows, LoaderCircle, type LucideIcon } from "lucide-react";
import { messages } from "../../i18n";
import type { OpenProject } from "./store";

const t = messages.save;

type View = { icon: LucideIcon; label: string; className: string };

function viewFor(project: OpenProject): View {
  if (project.access === "readonly") return { icon: Eye, label: t.readonly, className: "text-text-muted" };
  switch (project.saveStatus) {
    case "saving":
      return { icon: LoaderCircle, label: t.saving, className: "text-text-muted [&>svg]:motion-safe:animate-spin" };
    case "saved":
      return { icon: CircleCheck, label: t.saved, className: "text-success" };
    case "error":
      return { icon: CircleAlert, label: t.error, className: "text-danger" };
    case "conflict":
      return { icon: GitCompareArrows, label: t.conflict, className: "text-danger" };
    case "pending":
      return { icon: CircleDot, label: t.pending, className: "text-text-muted" };
  }
}

/** État d'enregistrement visible et annoncé ; « localement » : jamais présenté comme une synchronisation. */
export function SaveStatus({ project }: { project: OpenProject }) {
  const { icon: Icon, label, className } = viewFor(project);
  return (
    <span role="status" className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap transition-colors duration-(--duration-fast) ${className}`}>
      <Icon aria-hidden="true" size={16} />
      <span>{label}</span>
    </span>
  );
}
