import { useMemo } from "react";
import { messages } from "../../i18n";
import type { OpenProject } from "../lab/store";
import { TopologyCanvas } from "../lab/topology/TopologyCanvas";
import { statusText } from "./format";
import { ontStatuses, useIsExercise, useOpticalReport, usePonReport } from "./hooks";
import { useOpticsSession } from "./store";

const t = messages.optics;

/** Vue Optique : le canevas surligne le chemin choisi et écrit l'état de chaque ONT sous son nom. */
export function OpticsView({ projectId, project }: { projectId: string; project: OpenProject }) {
  const exercise = useIsExercise(projectId);
  const report = useOpticalReport(project.document);
  const pon = usePonReport(project.document, report);
  const { selectedPathId } = useOpticsSession(projectId);
  const selected = report.paths.find((path) => path.id === selectedPathId);

  const highlight = useMemo(
    () => (selected ? new Set(selected.elements.flatMap(({ element }) => (element.kind === "fiber" ? [element.linkId] : []))) : undefined),
    [selected],
  );
  const details = useMemo(() => {
    const map = new Map<string, string>();
    // Sous chaque ONT : l'état optique, puis l'état d'activation PON quand la lumière passe (un chemin conforme ne suffit pas).
    const states = new Map(pon.onts.map((ont) => [ont.ontId, ont.state]));
    for (const [ontId, status] of ontStatuses(report)) {
      const state = states.get(ontId);
      const inService = status === "ok" || status === "low-margin";
      map.set(ontId, inService && state ? `${statusText(status, exercise)} · ${state === "O5" ? "" : `${t.pon.stateSymbol[state]} `}${t.pon.stateShort[state]}` : statusText(status, exercise));
    }
    for (const ontId of report.unreachedOnts) map.set(ontId, `${t.symbol.cut} ${t.unreachedShort}`);
    return map;
  }, [report, pon, exercise]);

  return <TopologyCanvas projectId={projectId} project={project} mode="optics" highlightLinks={highlight} deviceDetails={details} />;
}
