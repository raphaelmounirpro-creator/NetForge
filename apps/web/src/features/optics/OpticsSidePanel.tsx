import { Tabs } from "../../components/ui/Tabs";
import { messages } from "../../i18n";
import type { OpenProject } from "../lab/store";
import { useIsExercise, useOpticalReport, usePonReport } from "./hooks";
import { OpticsBudget } from "./OpticsBudget";
import { OpticsFaults, OpticsInterventions } from "./OpticsFaults";
import { OpticsMeasure } from "./OpticsMeasure";
import { OpticsPon } from "./OpticsPon";
import { useOpticsSession, useOpticsStore, type OpticsTab } from "./store";

const t = messages.optics;

/**
 * Panneau droit de la vue Optique. En exercice, l'onglet « Pannes » du
 * formateur disparaît : l'élève dispose du bilan de conception, du
 * photomètre, de l'inspection et des interventions.
 */
export function OpticsSidePanel({ projectId, project }: { projectId: string; project: OpenProject }) {
  const exercise = useIsExercise(projectId);
  const report = useOpticalReport(project.document);
  const pon = usePonReport(project.document, report);
  const session = useOpticsSession(projectId);
  const path = report.paths.find((item) => item.id === session.selectedPathId);
  const editable = project.access === "editor";
  const tabs: { id: OpticsTab; label: string }[] = [
    { id: "budget", label: t.tabBudget },
    { id: "pon", label: t.tabPon },
    { id: "measure", label: t.tabMeasure },
    { id: "interventions", label: t.tabInterventions },
    ...(exercise ? [] : [{ id: "faults" as const, label: t.tabFaults }]),
  ];
  const tab = tabs.some((item) => item.id === session.tab) ? session.tab : "budget";

  return (
    <Tabs
      label={t.tabs}
      size="sm"
      tabs={tabs}
      selected={tab}
      onSelect={(next) => {
        useOpticsStore.getState().update(projectId, { tab: next });
      }}
      className="h-full min-h-0"
    >
      <div className="h-full min-h-0 overflow-y-auto">
        {tab === "budget" ? (
          <OpticsBudget doc={project.document} path={path} exercise={exercise} reserve={report.reserveDb} />
        ) : tab === "pon" ? (
          <OpticsPon doc={project.document} report={pon} exercise={exercise} />
        ) : tab === "measure" ? (
          <OpticsMeasure projectId={projectId} doc={project.document} selection={project.selection} />
        ) : tab === "interventions" ? (
          <OpticsInterventions projectId={projectId} doc={project.document} editable={editable} />
        ) : (
          <OpticsFaults projectId={projectId} doc={project.document} editable={editable} />
        )}
      </div>
    </Tabs>
  );
}
