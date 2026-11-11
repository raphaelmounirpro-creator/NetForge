import { useMemo } from "react";
import { useLabStore } from "../lab/store";
import type { WorkerPort } from "./client";
import { createSimulationController } from "./controller";
import { networkFingerprint } from "./fingerprint";
import { useSimulationStore } from "./store";

/** Contrôleur unique de l'application : une seule simulation active à la fois. */
export const simulation = createSimulationController(
  () => new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" }) as unknown as WorkerPort,
);

/**
 * Cycle de vie de la simulation selon l'éditeur :
 * - changement de projet actif → la simulation d'un autre projet passe en pause ;
 * - modification du réseau simulé → pause immédiate, réinitialisation demandée ;
 * - fermeture du projet simulé → arrêt du moteur.
 */
export function installSimulationLifecycle(): () => void {
  return useLabStore.subscribe((state, previous) => {
    if (state.activeId !== previous.activeId) simulation.onActiveProjectChange(state.activeId);
    const session = useSimulationStore.getState().session;
    if (!session) return;
    const project = state.projects[session.projectId];
    if (!project) {
      simulation.stop();
      return;
    }
    const before = previous.projects[session.projectId];
    if (before?.document === project.document || session.mode === "paused") return;
    if (networkFingerprint(project.document) !== session.fingerprint) void simulation.pause();
  });
}

/** Vrai si le projet a changé depuis son chargement dans le moteur (hors disposition). */
export function useIsStale(projectId: string): boolean {
  const fingerprint = useSimulationStore((state) => (state.session?.projectId === projectId ? state.session.fingerprint : null));
  const document = useLabStore((state) => state.projects[projectId]?.document);
  // Empreinte recalculée seulement quand le document change, pas à chaque lot du moteur.
  const current = useMemo(() => (document ? networkFingerprint(document) : null), [document]);
  return fingerprint !== null && current !== null && current !== fingerprint;
}
