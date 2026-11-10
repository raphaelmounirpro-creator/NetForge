import { X } from "lucide-react";
import { Notice } from "../../components/ui/Notice";
import { formatIssue, messages } from "../../i18n";
import { useLabStore, type OpenProject } from "./store";

/**
 * Retour de la dernière commande : erreurs (refus expliqué), avertissements
 * ou confirmation. Zone annoncée aux lecteurs d'écran.
 */
export function FeedbackBar({ projectId, project }: { projectId: string; project: OpenProject }) {
  const errors = project.feedback.filter((issue) => issue.severity === "error");
  const warnings = project.feedback.filter((issue) => issue.severity === "warning");
  const visible = errors.length > 0 || warnings.length > 0 || project.notice !== null;
  const dismiss = () => {
    useLabStore.getState().setFeedback(projectId, []);
    useLabStore.getState().setNotice(projectId, null);
  };
  const tone = errors.length > 0 ? "danger" : warnings.length > 0 ? "warning" : "success";
  const lines = errors.length > 0 ? errors.map(formatIssue) : warnings.length > 0 ? warnings.map(formatIssue) : [project.notice ?? ""];

  return (
    <div aria-live="polite" className="pointer-events-none absolute right-3 bottom-3 left-3 flex justify-center">
      {visible && (
        <Notice tone={tone} className="pointer-events-auto w-full max-w-2xl shadow-lg">
          <div className="flex items-start gap-2">
            <ul className="flex-1 space-y-1 text-text">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <button type="button" aria-label={messages.lab.dismiss} onClick={dismiss} className="inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-text-muted hover:text-text">
              <X aria-hidden="true" size={14} />
            </button>
          </div>
        </Notice>
      )}
    </div>
  );
}
