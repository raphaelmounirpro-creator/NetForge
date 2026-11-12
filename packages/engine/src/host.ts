import { parseNfgValue, type NfgDocument } from "@netforge/project";
import {
  PROTOCOL_VERSION,
  simRequestSchema,
  type HostErrorCode,
  type PlaybackSpeed,
  type SimMode,
  type SimRequest,
  type UpdateNotice,
  type WorkerMessage,
} from "./protocol.js";
import { createSimulation, type Simulation } from "./simulation.js";
import { MAX_SIM_TIME, NANOSECONDS_PER_MILLISECOND } from "./time.js";
import type { TraceEntry, TraceParams } from "./trace.js";
import type { SimulationChanges } from "./views.js";

/**
 * Adaptateur d'exécution du moteur (Web Worker, ou appel direct en test).
 * Il découpe le calcul en lots courts pour rester interruptible ; l'horloge
 * réelle sert uniquement à choisir jusqu'où calculer, jamais à décider
 * d'un résultat réseau.
 */
export interface HostEnvironment {
  post(message: WorkerMessage): void;
  /** Horloge réelle en millisecondes (performance.now dans un Worker). */
  now(): number;
  /** Programme un rappel ; renvoie une fonction d'annulation. */
  setTimer(callback: () => void, delayMs: number): () => void;
}

export const HOST_TIMING = {
  /** Intervalle entre deux lots en lecture continue. */
  tickMs: 50,
  /** Durée réelle maximale d'un lot avant de rendre la main. */
  sliceMs: 8,
  /** Événements traités entre deux contrôles de durée. */
  sliceEvents: 2000,
  /** Durée réelle maximale de « Terminer les échanges » avant pause expliquée. */
  finishBudgetMs: 10_000,
  /** Écart réel maximal pris en compte entre deux lots (onglet en arrière-plan). */
  maxTickGapMs: 250,
  /** Décisions transmises au plus par mise à jour (les plus récentes). */
  maxTraceEntriesPerUpdate: 2000,
  /** Calcul intensif (« terminer ») : au plus une mise à jour par intervalle, pour ménager l'interface. */
  finishUpdateIntervalMs: 100,
} as const;

export type HostTiming = { readonly [K in keyof typeof HOST_TIMING]: number };

export interface SimulationHost {
  receive(raw: unknown): void;
  dispose(): void;
}

function requestId(raw: unknown): number | null {
  if (typeof raw !== "object" || raw === null) return null;
  const id = (raw as Record<string, unknown>)["id"];
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

export function createSimulationHost(env: HostEnvironment, timing: Partial<HostTiming> = {}): SimulationHost {
  const config: HostTiming = { ...HOST_TIMING, ...timing };
  let document: NfgDocument | null = null;
  let seed = 1;
  let sim: Simulation | null = null;
  let mode: SimMode = "paused";
  let speed: PlaybackSpeed = 1;
  let lastWall = 0;
  let finishStartedAt = 0;
  let cancelTimer: (() => void) | null = null;
  let updateSeq = 0;
  /** Décisions accumulées pendant « terminer » entre deux mises à jour. */
  let pendingTrace: TraceEntry[] = [];
  let pendingDropped = 0;
  let pendingComputeMs = 0;
  let lastFinishPost = 0;

  /** Ajoute des décisions au tampon en ne gardant que les plus récentes. */
  const buffer = (trace: readonly TraceEntry[]) => {
    pendingTrace.push(...trace);
    const excess = pendingTrace.length - config.maxTraceEntriesPerUpdate;
    if (excess > 0) {
      pendingTrace = pendingTrace.slice(excess);
      pendingDropped += excess;
    }
  };

  const stopTimer = () => {
    cancelTimer?.();
    cancelTimer = null;
  };

  const fail = (id: number | null, code: HostErrorCode, params: TraceParams = {}) => {
    env.post({ v: PROTOCOL_VERSION, type: "error", id, code, params, issues: [] });
  };

  const ack = (id: number, sessionId: string | null = null) => {
    env.post({ v: PROTOCOL_VERSION, type: "ack", id, sessionId });
  };

  const postUpdate = (
    current: Simulation,
    options: { trace?: TraceEntry[]; dropped?: number; full?: boolean; computeMs?: number; lagging?: boolean; notice?: UpdateNotice } = {},
  ) => {
    // Le tampon de « terminer » part avec la prochaine mise à jour, quelle qu'elle soit :
    // aucune décision calculée n'est perdue sans être comptée.
    const trace = options.full ? (options.trace ?? []) : [...pendingTrace, ...(options.trace ?? [])];
    const kept = trace.length > config.maxTraceEntriesPerUpdate ? trace.slice(-config.maxTraceEntriesPerUpdate) : trace;
    const dropped = (options.full ? 0 : pendingDropped) + (options.dropped ?? 0) + trace.length - kept.length;
    pendingTrace = [];
    pendingDropped = 0;
    let changes: SimulationChanges = current.takeChanges();
    if (options.full) {
      const snapshot = current.snapshot();
      changes = { devices: snapshot.devices, pings: snapshot.pings, lookups: snapshot.lookups, links: snapshot.links };
    }
    updateSeq += 1;
    env.post({
      v: PROTOCOL_VERSION,
      type: "update",
      seq: updateSeq,
      full: options.full ?? false,
      mode,
      speed,
      time: current.time,
      status: current.diagnostic ? "interrupted" : "ready",
      diagnostic: current.diagnostic,
      processedEvents: current.processedEvents,
      pendingEvents: current.pendingEvents,
      activity: current.hasActivity(),
      trace: kept,
      droppedTrace: dropped,
      changes,
      computeMs: options.computeMs ?? 0,
      lagging: options.lagging ?? false,
      notice: options.notice ?? null,
    });
  };

  /** Lecture continue : calcule jusqu'à l'instant correspondant au temps réel écoulé × vitesse. */
  const tick = () => {
    cancelTimer = null;
    const current = sim;
    if (!current || mode !== "playing") return;
    const wall = env.now();
    const elapsed = Math.max(0, Math.min(wall - lastWall, config.maxTickGapMs));
    lastWall = wall;
    const horizon = Math.min(current.time + Math.round(elapsed * speed * NANOSECONDS_PER_MILLISECOND), MAX_SIM_TIME);
    const started = env.now();
    const trace: TraceEntry[] = [];
    let lagging = false;
    for (;;) {
      const result = current.run({ until: horizon, maxEvents: config.sliceEvents });
      trace.push(...result.trace);
      if (result.stop !== "budget") break;
      if (env.now() - started >= config.sliceMs) {
        lagging = true;
        break;
      }
    }
    let notice: UpdateNotice = null;
    if (current.diagnostic) {
      mode = "paused";
      notice = "interrupted";
    }
    postUpdate(current, { trace, computeMs: env.now() - started, lagging, notice });
    if (mode === "playing") cancelTimer = env.setTimer(tick, config.tickMs);
  };

  /** « Terminer les échanges » : calcule au plus vite, par lots, jusqu'à l'inactivité. */
  const finishSlice = () => {
    cancelTimer = null;
    const current = sim;
    if (!current || mode !== "finishing") return;
    const started = env.now();
    let done = false;
    for (;;) {
      const result = current.run({ stopWhenIdle: true, maxEvents: config.sliceEvents });
      buffer(result.trace);
      if (result.stop !== "budget") {
        done = true;
        break;
      }
      if (env.now() - started >= config.sliceMs) break;
    }
    pendingComputeMs += env.now() - started;
    let notice: UpdateNotice = null;
    if (current.diagnostic) {
      mode = "paused";
      notice = "interrupted";
    } else if (done) {
      mode = "paused";
      notice = "finished";
    } else if (env.now() - finishStartedAt >= config.finishBudgetMs) {
      mode = "paused";
      notice = "compute-budget";
    }
    const now = env.now();
    if (mode !== "finishing" || now - lastFinishPost >= config.finishUpdateIntervalMs) {
      postUpdate(current, { computeMs: pendingComputeMs, notice });
      pendingComputeMs = 0;
      lastFinishPost = now;
    }
    if (mode === "finishing") cancelTimer = env.setTimer(finishSlice, 0);
  };

  const load = (request: Extract<SimRequest, { type: "load" }>) => {
    const parsed = parseNfgValue(request.document);
    if (!parsed.ok) {
      env.post({ v: PROTOCOL_VERSION, type: "error", id: request.id, code: "load.invalid-document", params: {}, issues: parsed.errors });
      return;
    }
    const created = createSimulation(parsed.document, { seed: request.seed });
    if (!created.ok) {
      env.post({ v: PROTOCOL_VERSION, type: "error", id: request.id, code: "load.invalid-document", params: {}, issues: created.issues });
      return;
    }
    stopTimer();
    document = parsed.document;
    seed = request.seed;
    sim = created.simulation;
    mode = "paused";
    ack(request.id);
    postUpdate(sim, { full: true });
  };

  const handle = (request: SimRequest) => {
    if (request.type === "load") {
      load(request);
      return;
    }
    const current = sim;
    if (!current || !document) {
      fail(request.id, "sim.not-loaded");
      return;
    }
    switch (request.type) {
      case "command": {
        const outcome = current.enqueue(request.command);
        if (!outcome.ok) {
          fail(request.id, outcome.code, outcome.params);
          return;
        }
        // La commande est appliquée tout de suite, à l'instant simulé courant : les
        // événements de cet instant sont traités (frontière d'événements définie),
        // les suivants attendent la lecture ou le pas à pas.
        const started = env.now();
        const result = current.run({ until: current.time, maxEvents: config.sliceEvents });
        ack(request.id, outcome.sessionId);
        postUpdate(current, { trace: result.trace, computeMs: env.now() - started });
        return;
      }
      case "play":
        speed = request.speed;
        ack(request.id);
        if (current.diagnostic) return;
        if (mode !== "playing") {
          stopTimer();
          mode = "playing";
          lastWall = env.now();
          cancelTimer = env.setTimer(tick, config.tickMs);
        }
        postUpdate(current);
        return;
      case "pause":
        stopTimer();
        mode = "paused";
        ack(request.id);
        postUpdate(current);
        return;
      case "step": {
        stopTimer();
        mode = "paused";
        const started = env.now();
        const result = current.step();
        ack(request.id);
        postUpdate(current, { trace: result.trace, computeMs: env.now() - started, notice: current.diagnostic ? "interrupted" : null });
        return;
      }
      case "finish":
        stopTimer();
        ack(request.id);
        if (current.diagnostic) return;
        mode = "finishing";
        finishStartedAt = env.now();
        lastFinishPost = finishStartedAt;
        pendingComputeMs = 0;
        cancelTimer = env.setTimer(finishSlice, 0);
        postUpdate(current);
        return;
      case "reset": {
        stopTimer();
        const created = createSimulation(document, { seed });
        if (!created.ok) {
          fail(request.id, "load.invalid-document");
          return;
        }
        sim = created.simulation;
        mode = "paused";
        ack(request.id);
        postUpdate(sim, { full: true });
        return;
      }
    }
  };

  return {
    receive(raw) {
      const parsed = simRequestSchema.safeParse(raw);
      if (!parsed.success) {
        const version = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>)["v"] : undefined;
        fail(requestId(raw), version !== undefined && version !== PROTOCOL_VERSION ? "protocol.version" : "protocol.invalid-message", {
          expected: PROTOCOL_VERSION,
        });
        return;
      }
      handle(parsed.data);
    },
    dispose() {
      stopTimer();
      sim = null;
      document = null;
      mode = "paused";
    },
  };
}
