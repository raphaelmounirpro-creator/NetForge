import type { PlaybackSpeed } from "@netforge/engine";
import { fill, messages } from "../../i18n";
import { useLabStore } from "../lab/store";
import { SimulationClient, type Reply, type WorkerPort } from "./client";
import { useConsoleStore } from "./consoleStore";
import { networkFingerprint } from "./fingerprint";
import { useObservationStore } from "./observation";
import { useSimulationStore } from "./store";

/** Graine fixe : la même session donne toujours la même trace (affichée dans la vue). */
export const SIMULATION_SEED = 1;

export interface SimulationController {
  /** Charge le projet (document courant) dans le moteur ; remplace toute autre simulation. */
  start: (projectId: string) => Promise<void>;
  /** Réinitialise : recharge la configuration actuelle du projet, vide paquets, tables et compteurs. */
  reset: () => Promise<void>;
  play: (speed: PlaybackSpeed) => Promise<Reply>;
  pause: () => Promise<Reply>;
  step: () => Promise<Reply>;
  finish: () => Promise<Reply>;
  ping: (deviceId: string, destination: string, count: number) => Promise<Reply>;
  setLink: (linkId: string, up: boolean) => Promise<Reply>;
  clearTable: (deviceId: string, table: "arp" | "mac") => Promise<Reply>;
  dhcp: (deviceId: string, action: "renew" | "release") => Promise<Reply>;
  /** Arrête la simulation (projet fermé). */
  stop: () => void;
  /** Changement de projet actif : la simulation d'un autre projet est mise en pause. */
  onActiveProjectChange: (activeId: string | null) => void;
}

const NOT_LOADED: Reply = { ok: false, code: "sim.not-loaded", params: {}, issues: [] };

export function createSimulationController(createWorker: () => WorkerPort): SimulationController {
  const store = useSimulationStore.getState;
  const client = new SimulationClient(createWorker, {
    onUpdate: (update) => {
      // Mesures de performance séparées : calcul dans le Worker, puis intégration côté interface.
      performance.mark("nf:engine-compute", { detail: update.computeMs });
      performance.mark("nf:update-start");
      // Nouveau chargement ou réinitialisation : les décisions inspectées n'existent plus.
      if (update.full) {
        useObservationStore.getState().reset();
        useConsoleStore.getState().forgetWatches();
      }
      store().applyUpdate(update);
      const session = store().session;
      if (session) useConsoleStore.getState().syncPings(session);
      performance.measure("nf:update-apply", "nf:update-start");
    },
    onFailure: () => {
      store().workerFailed();
    },
  });

  const whenLoaded = (request: () => Promise<Reply>): Promise<Reply> => {
    const session = store().session;
    return session?.phase === "ready" && !session.workerError ? request() : Promise.resolve(NOT_LOADED);
  };

  const start = async (projectId: string) => {
    const project = useLabStore.getState().projects[projectId];
    if (!project) return;
    const doc = project.document;
    if (store().session?.workerError) client.terminate();
    store().begin(projectId, doc.metadata.name, networkFingerprint(doc));
    const reply = await client.request({ type: "load", document: doc, seed: SIMULATION_SEED });
    if (!reply.ok && store().session?.projectId === projectId) store().loadFailed(reply.issues);
  };

  return {
    start,
    reset: async () => {
      const session = store().session;
      if (session) await start(session.projectId);
    },
    play: (speed) => whenLoaded(() => client.request({ type: "play", speed })),
    pause: () => whenLoaded(() => client.request({ type: "pause" })),
    step: () => whenLoaded(() => client.request({ type: "step" })),
    finish: () => whenLoaded(() => client.request({ type: "finish" })),
    ping: (deviceId, destination, count) =>
      whenLoaded(() => client.request({ type: "command", command: { type: "ping", deviceId, destination, count } })),
    setLink: (linkId, up) => whenLoaded(() => client.request({ type: "command", command: { type: "set-link", linkId, up } })),
    clearTable: (deviceId, table) => whenLoaded(() => client.request({ type: "command", command: { type: "clear-table", deviceId, table } })),
    dhcp: (deviceId, action) => whenLoaded(() => client.request({ type: "command", command: { type: "dhcp", deviceId, action } })),
    stop: () => {
      client.terminate();
      store().clear();
    },
    onActiveProjectChange: (activeId) => {
      const session = store().session;
      if (!session || session.projectId === activeId || session.mode === "paused") return;
      void client.request({ type: "pause" });
      if (activeId) useLabStore.getState().setNotice(activeId, fill(messages.simulation.pausedOther, { name: session.projectName }));
    },
  };
}
