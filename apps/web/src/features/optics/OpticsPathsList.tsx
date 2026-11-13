import { getModel } from "@netforge/project";
import { useState } from "react";
import { Tabs } from "../../components/ui/Tabs";
import { fill, messages } from "../../i18n";
import type { OpenProject } from "../lab/store";
import { deviceName, formatDb, pathLabel, statusText } from "./format";
import { useIsExercise, useOpticalReport, usePonReport } from "./hooks";
import { OpticsSitesView, OpticsTreeView } from "./OpticsTree";
import { useOpticsSession, useOpticsStore } from "./store";

const t = messages.optics;

type LeftView = "paths" | "tree" | "sites";

/** Colonne de gauche de la vue Optique : chemins, arbre du réseau ou implantation. */
export function OpticsPathsList({ projectId, project }: { projectId: string; project: OpenProject }) {
  const [view, setView] = useState<LeftView>("paths");
  const doc = project.document;
  const exercise = useIsExercise(projectId);
  const report = useOpticalReport(doc);
  const pon = usePonReport(doc, report);
  return (
    <Tabs
      label={t.leftTabs}
      size="sm"
      tabs={[
        { id: "paths", label: t.leftPaths },
        { id: "tree", label: t.leftTree },
        { id: "sites", label: t.leftSites },
      ]}
      selected={view}
      onSelect={setView}
      className="h-full min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto p-4">
        {view === "paths" ? (
          <PathsList projectId={projectId} project={project} />
        ) : view === "tree" ? (
          <OpticsTreeView doc={doc} report={report} pon={pon} exercise={exercise} />
        ) : (
          <OpticsSitesView doc={doc} pon={pon} />
        )}
      </div>
    </Tabs>
  );
}

/** Chemins OLT → ONT avec leur état (symbole et texte, jamais la couleur seule). */
function PathsList({ projectId, project }: { projectId: string; project: OpenProject }) {
  const doc = project.document;
  const exercise = useIsExercise(projectId);
  const report = useOpticalReport(doc);
  const { selectedPathId } = useOpticsSession(projectId);
  const hasOlt = doc.topology.devices.some((device) => getModel(device.model).kind === "olt");

  return (
    <div className="flex flex-col gap-3">
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
                      <span className="text-xs text-text-muted">
                        {path.oltTechnology === path.ontTechnology
                          ? t.technology[path.oltTechnology]
                          : fill(t.pathMismatch, { olt: t.technology[path.oltTechnology], ont: t.technology[path.ontTechnology] })}
                      </span>
                      <span className={`text-xs font-semibold ${tone}`}>{statusText(status, exercise)}</span>
                      {path.status !== "cut" && path.status !== "incompatible" && path.status !== "technology-mismatch" && (
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
