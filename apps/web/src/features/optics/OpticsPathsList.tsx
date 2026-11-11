import { getModel } from "@netforge/project";
import { fill, messages } from "../../i18n";
import type { OpenProject } from "../lab/store";
import { deviceName, formatDb, pathLabel, statusText } from "./format";
import { useIsExercise, useOpticalReport } from "./hooks";
import { useOpticsSession, useOpticsStore } from "./store";

const t = messages.optics;

/** Colonne de gauche de la vue Optique : chemins OLT → ONT avec leur état (symbole et texte, jamais la couleur seule). */
export function OpticsPathsList({ projectId, project }: { projectId: string; project: OpenProject }) {
  const doc = project.document;
  const exercise = useIsExercise(projectId);
  const report = useOpticalReport(doc);
  const { selectedPathId } = useOpticsSession(projectId);
  const hasOlt = doc.topology.devices.some((device) => getModel(device.model).kind === "olt");

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <h2 className="text-xs font-semibold tracking-[0.12em] text-text-muted uppercase">{t.pathsTitle}</h2>
      {!hasOlt ? (
        <p className="text-sm text-text-muted">{t.noOlt}</p>
      ) : (
        <>
          <p className="text-xs text-text-muted">{t.pathsHint}</p>
          {report.paths.length === 0 ? (
            <p className="text-sm text-text-muted">{t.noPaths}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {report.paths.map((path) => {
                const selected = path.id === selectedPathId;
                // En exercice, la marge affichée est celle de la conception : la panne ne se lit qu'à la mesure.
                const figures = (direction: "downstream" | "upstream") => (exercise ? path[direction].nominal : path[direction].actual);
                const margin = Math.min(figures("downstream").marginDb, figures("upstream").marginDb);
                // L'état (symptôme en exercice) tient compte des pannes : c'est ce que constate l'ONT.
                const status = path.status;
                const tone = status === "ok" ? "text-success" : status === "low-margin" ? "text-warning" : "text-danger";
                return (
                  <li key={path.id}>
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onClick={() => {
                        useOpticsStore.getState().update(projectId, { selectedPathId: selected ? null : path.id, tab: "budget" });
                      }}
                      className={`flex w-full flex-col gap-0.5 rounded-sm border px-2.5 py-1.5 text-left text-sm transition-colors duration-(--duration-fast) ${
                        selected ? "border-accent-text bg-surface-raised" : "border-transparent hover:border-border"
                      }`}
                    >
                      <span className="font-medium text-text">{pathLabel(doc, path)}</span>
                      <span className={`text-xs font-semibold ${tone}`}>{statusText(status, exercise)}</span>
                      {path.status !== "cut" && path.status !== "incompatible" && (
                        <span className="text-xs text-text-muted">{fill(exercise ? t.pathDesignMargin : t.pathMargin, { margin: formatDb(margin) })}</span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {report.unreachedOnts.map((ontId) => (
            <p key={ontId} className="text-xs text-text-muted">
              {fill(t.unreached, { name: deviceName(doc, ontId) })}
            </p>
          ))}
          {report.loops > 0 && <p className="text-xs text-warning">{fill(t.loops, { count: report.loops })}</p>}
          {report.truncated && <p className="text-xs text-warning">{t.truncated}</p>}
        </>
      )}
    </div>
  );
}
