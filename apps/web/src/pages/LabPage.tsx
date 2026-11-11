import { useState } from "react";
import { useLabLayout } from "../features/lab/layout";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { Notice } from "../components/ui/Notice";
import { Tabs } from "../components/ui/Tabs";
import { fill, messages } from "../i18n";
import { exportProject } from "../features/lab/actions";
import { ConfigurationView } from "../features/lab/ConfigurationView";
import { FeedbackBar } from "../features/lab/FeedbackBar";
import { LabToolbar } from "../features/lab/LabToolbar";
import { Palette } from "../features/lab/Palette";
import { ProjectBanners } from "../features/lab/ProjectBanners";
import { ProjectTabs } from "../features/lab/ProjectTabs";
import { PropertiesPanel } from "../features/lab/properties/PropertiesPanel";
import { projectService } from "../features/lab/services";
import { ShortcutsDialog } from "../features/lab/ShortcutsDialog";
import { useLabStore, type LabView } from "../features/lab/store";
import { TopologyCanvas } from "../features/lab/topology/TopologyCanvas";
import { useLabShortcuts } from "../features/lab/useLabShortcuts";
import { EvaluationPanel } from "../features/evaluations/EvaluationPanel";
import { ExercisePanel } from "../features/exercises/ExercisePanel";
import { OpticsPathsList } from "../features/optics/OpticsPathsList";
import { OpticsSidePanel } from "../features/optics/OpticsSidePanel";
import { OpticsView } from "../features/optics/OpticsView";
import { NewProjectDialog } from "../features/projects/NewProjectDialog";
import { SimulationSidePanel } from "../features/simulation/SimulationSidePanel";
import { SimulationActions } from "../features/simulation/SimulationActions";
import { SimulationView } from "../features/simulation/SimulationView";
import { useIsStale } from "../features/simulation/services";
import { useSimulationStore } from "../features/simulation/store";

const t = messages.lab;

export function LabPage() {
  const activeId = useLabStore((state) => state.activeId);
  const project = useLabStore((state) => (state.activeId ? state.projects[state.activeId] : undefined));
  const [newOpen, setNewOpen] = useState(false);
  /** Projet dont la fermeture attend une décision (modifications non enregistrées). */
  const [closing, setClosing] = useState<string | null>(null);
  const closingName = useLabStore((state) => (closing ? state.projects[closing]?.document.metadata.name : undefined)) ?? "";
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { paletteOpen, propertiesOpen, togglePalette, toggleProperties } = useLabLayout();
  useLabShortcuts(activeId);
  const session = useSimulationStore((state) => (activeId && state.session?.projectId === activeId ? state.session : null));
  const stale = useIsStale(activeId ?? "");
  const simulationBlocked = !session || session.phase !== "ready" || session.workerError || stale || session.status === "interrupted";

  const requestClose = async (id: string) => {
    if ((await projectService.close(id)) === "unsaved") setClosing(id);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Notice tone="info" className="m-2 lg:hidden">
        {messages.app.narrowScreen}
      </Notice>
      <ProjectTabs
        onNew={() => {
          setNewOpen(true);
        }}
        onClose={(id) => void requestClose(id)}
      />

      {activeId && project ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <ProjectBanners projectId={activeId} project={project} />
          <Tabs<LabView>
            label={t.views}
            tabs={[
              { id: "topology", label: t.viewTopology },
              { id: "simulation", label: t.viewSimulation },
              { id: "optics", label: t.viewOptics },
              { id: "configuration", label: t.viewConfiguration },
            ]}
            selected={project.view}
            onSelect={(view) => {
              useLabStore.getState().setView(activeId, view);
            }}
            trailing={
              <LabToolbar
                projectId={activeId}
                project={project}
                paletteOpen={paletteOpen}
                propertiesOpen={propertiesOpen}
                onTogglePalette={togglePalette}
                onToggleProperties={toggleProperties}
                onShowShortcuts={() => {
                  setShortcutsOpen(true);
                }}
              />
            }
            className="min-h-0 flex-1"
          >
            <div className="flex h-full min-h-0">
              {paletteOpen && (
                <aside
                  aria-label={project.view === "simulation" ? messages.simulation.actions : project.view === "optics" ? messages.optics.pathsRegion : messages.palette.region}
                  className="w-64 shrink-0 animate-panel-in-left border-r border-border bg-surface"
                >
                  {project.view === "simulation" ? (
                    <SimulationActions session={session} disabled={simulationBlocked} />
                  ) : project.view === "optics" ? (
                    <OpticsPathsList projectId={activeId} project={project} />
                  ) : (
                    <Palette projectId={activeId} project={project} />
                  )}
                </aside>
              )}
              <div key={project.view} className="relative min-w-0 flex-1 animate-view-in">
                {project.view === "topology" ? (
                  <TopologyCanvas projectId={activeId} project={project} />
                ) : project.view === "simulation" ? (
                  <SimulationView projectId={activeId} project={project} />
                ) : project.view === "optics" ? (
                  <OpticsView projectId={activeId} project={project} />
                ) : (
                  <ConfigurationView projectId={activeId} project={project} />
                )}
                <FeedbackBar projectId={activeId} project={project} />
              </div>
              {propertiesOpen && (
                <aside
                  aria-label={project.view === "simulation" ? messages.simulation.runtime.title : project.view === "optics" ? messages.optics.tabs : messages.properties.title}
                  className="flex w-[22rem] shrink-0 animate-panel-in-right flex-col border-l border-border bg-surface"
                >
                  {/* Guide d'exercice en tête du panneau : le canevas garde toute sa hauteur. */}
                  <ExercisePanel projectId={activeId} project={project} />
                  <EvaluationPanel projectId={activeId} project={project} />
                  <div className="min-h-0 flex-1">
                    {project.view === "simulation" ? (
                      <SimulationSidePanel projectId={activeId} session={session} selection={project.selection} disabled={simulationBlocked} />
                    ) : project.view === "optics" ? (
                      <OpticsSidePanel projectId={activeId} project={project} />
                    ) : (
                      <PropertiesPanel projectId={activeId} project={project} />
                    )}
                  </div>
                </aside>
              )}
            </div>
          </Tabs>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-semibold text-text">{t.emptyTitle}</h1>
            <p className="mt-2 text-text-muted">{t.emptyBody}</p>
            <div className="mt-6 flex justify-center gap-2">
              <Button
                variant="primary"
                onClick={() => {
                  setNewOpen(true);
                }}
              >
                {t.newProject}
              </Button>
            </div>
            <p className="mt-6 text-xs text-text-muted">{messages.storage.guestNotice}</p>
          </div>
        </div>
      )}

      <NewProjectDialog
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
        }}
        onCreated={() => {
          setNewOpen(false);
        }}
      />
      <ShortcutsDialog
        open={shortcutsOpen}
        onClose={() => {
          setShortcutsOpen(false);
        }}
      />
      <Dialog
        open={closing !== null}
        title={fill(t.closeTitle, { name: closingName })}
        onClose={() => {
          setClosing(null);
        }}
        actions={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setClosing(null);
              }}
            >
              {messages.projects.cancel}
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (closing) void projectService.close(closing, { force: true });
                setClosing(null);
              }}
            >
              {t.closeDiscard}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (closing) {
                  exportProject(closing);
                  void projectService.close(closing, { force: true });
                }
                setClosing(null);
              }}
            >
              {t.closeExport}
            </Button>
          </>
        }
      >
        {t.closeBody}
      </Dialog>
    </div>
  );
}
