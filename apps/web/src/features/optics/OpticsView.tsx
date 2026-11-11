import { useMemo } from "react";
import { messages } from "../../i18n";
import type { OpenProject } from "../lab/store";
import { TopologyCanvas } from "../lab/topology/TopologyCanvas";
import { statusText } from "./format";
import { ontStatuses, useIsExercise, useOpticalReport } from "./hooks";
import { useOpticsSession } from "./store";

const t = messages.optics;

/** Vue Optique : le canevas surligne le chemin choisi et écrit l'état de chaque ONT sous son nom. */
export function OpticsView({ projectId, project }: { projectId: string; project: OpenProject }) {
  const exercise = useIsExercise(projectId);
  const report = useOpticalReport(project.document);
  const { selectedPathId } = useOpticsSession(projectId);
  const selected = report.paths.find((path) => path.id === selectedPathId);

  const highlight = useMemo(
    () => (selected ? new Set(selected.elements.flatMap(({ element }) => (element.kind === "fiber" ? [element.linkId] : []))) : undefined),
    [selected],
  );
  const details = useMemo(() => {
    const map = new Map<string, string>();
    for (const [ontId, status] of ontStatuses(report)) map.set(ontId, statusText(status, exercise));
    for (const ontId of report.unreachedOnts) map.set(ontId, `${t.symbol.cut} ${t.unreachedShort}`);
    return map;
  }, [report, exercise]);

  return <TopologyCanvas projectId={projectId} project={project} mode="optics" highlightLinks={highlight} deviceDetails={details} />;
}
