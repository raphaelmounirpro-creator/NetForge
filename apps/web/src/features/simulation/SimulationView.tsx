import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Notice } from "../../components/ui/Notice";
import { Tabs } from "../../components/ui/Tabs";
import { fill, formatIssue, messages } from "../../i18n";
import { diagnosticText } from "../../i18n/simulation";
import type { OpenProject } from "../lab/store";
import { TopologyCanvas } from "../lab/topology/TopologyCanvas";
import { PingResults } from "./PingResults";
import { simulation, useIsStale } from "./services";
import { SimulationBar } from "./SimulationBar";
import { useSimulationStore, type SimulationSession } from "./store";
import { TraceJournal } from "./TraceJournal";
import { HOST_TIMING } from "@netforge/engine";

const t = messages.simulation;
type DockTab = "journal" | "pings";

function Banners({ session, stale }: { session: SimulationSession; stale: boolean }) {
  const reset = (
    <Button size="sm" onClick={() => void simulation.reset()}>
      {t.reset}
    </Button>
  );
  return (
    <>
      {session.phase === "loading" && <Notice tone="info">{t.loading}</Notice>}
      {session.phase === "failed" && (
        <Notice tone="danger" title={t.loadFailed}>
          <ul className="list-disc pl-4">
            {session.loadIssues.map((issue) => (
              <li key={`${issue.code}-${JSON.stringify(issue.params)}`}>{formatIssue(issue)}</li>
            ))}
          </ul>
        </Notice>
      )}
      {session.workerError && (
        <Notice tone="danger" actions={reset}>
          {t.workerError}
        </Notice>
      )}
      {stale && (
        <Notice
          tone="warning"
          title={t.staleTitle}
          actions={
            <Button size="sm" variant="primary" onClick={() => void simulation.reset()}>
              {t.staleAction}
            </Button>
          }
        >
          {t.stale}
        </Notice>
      )}
      {session.diagnostic && (
        <Notice tone="danger" title={t.interruptedTitle} actions={reset}>
          {diagnosticText(session.diagnostic)}. {fill(t.interruptedRest, { pending: session.diagnostic.pendingEvents.toLocaleString("fr-FR") })}
        </Notice>
      )}
      {session.notice === "compute-budget" && session.mode === "paused" && (
        <Notice tone="warning">{fill(t.computeBudget, { seconds: HOST_TIMING.finishBudgetMs / 1000 })}</Notice>
      )}
      {session.lagging && session.mode === "playing" && <Notice tone="info">{t.lagging}</Notice>}
    </>
  );
}

/**
 * Vue Simulation : la topologie (déplacements autorisés), la barre de
 * simulation et les résultats du moteur. Un seul moteur est actif : la
 * simulation d'un autre projet reste en pause tant qu'on ne la remplace pas.
 */
export function SimulationView({ projectId, project }: { projectId: string; project: OpenProject }) {
  const session = useSimulationStore((state) => state.session);
  const stale = useIsStale(projectId);
  const [dock, setDock] = useState<DockTab>("journal");

  // Premier passage sur la vue : chargement automatique si aucune simulation n'existe.
  useEffect(() => {
    if (!useSimulationStore.getState().session) void simulation.start(projectId);
  }, [projectId]);

  const own = session?.projectId === projectId ? session : null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-col gap-2 empty:hidden [&:not(:empty)]:p-2">
        {session && !own && (
          <Notice
            tone="info"
            actions={
              <Button size="sm" variant="primary" onClick={() => void simulation.start(projectId)}>
                {fill(t.startHere, { name: project.document.metadata.name })}
              </Button>
            }
          >
            {fill(t.otherProject, { name: session.projectName })}
          </Notice>
        )}
        {own && <Banners session={own} stale={stale} />}
      </div>
      <div className="relative min-h-0 flex-1">
        <TopologyCanvas projectId={projectId} project={project} mode="simulate" linkStates={own?.links} />
      </div>
      {own && (
        <>
          <SimulationBar session={own} stale={stale} />
          <section aria-label={t.dock} className="h-64 shrink-0 border-t border-border bg-surface">
            <Tabs<DockTab>
              label={t.dock}
              size="sm"
              tabs={[
                { id: "journal", label: t.journal },
                { id: "pings", label: t.pings },
              ]}
              selected={dock}
              onSelect={setDock}
              className="h-full"
            >
              {dock === "journal" ? <TraceJournal session={own} /> : <PingResults session={own} />}
            </Tabs>
          </section>
        </>
      )}
    </div>
  );
}
