import type { NfgDocument } from "@netforge/project";
import type { SimCommand } from "../commands.js";
import { createSimulation, type Simulation, type SimulationOptions } from "../simulation.js";
import type { TraceCode, TraceEntry } from "../trace.js";

export function start(doc: NfgDocument, options: SimulationOptions = {}): Simulation {
  const result = createSimulation(doc, options);
  if (!result.ok) throw new Error(`document refusé : ${result.issues.map((issue) => issue.code).join(", ")}`);
  return result.simulation;
}

/** Programme une commande et échoue si le moteur la refuse. */
export function command(sim: Simulation, value: SimCommand): string | null {
  const outcome = sim.enqueue(value);
  if (!outcome.ok) throw new Error(`commande refusée : ${outcome.code}`);
  return outcome.sessionId;
}

/** Calcule jusqu'à la fin des échanges en cours. */
export function settle(sim: Simulation): TraceEntry[] {
  const result = sim.run({ stopWhenIdle: true, maxEvents: 1_000_000 });
  return result.trace;
}

/** Avance l'horloge jusqu'à l'instant donné (temporisations d'expiration comprises). */
export function advanceTo(sim: Simulation, time: number): TraceEntry[] {
  return sim.run({ until: time, maxEvents: 1_000_000 }).trace;
}

export function codes(trace: readonly TraceEntry[], deviceId?: string): TraceCode[] {
  return trace.filter((entry) => deviceId === undefined || entry.deviceId === deviceId).map((entry) => entry.code);
}

export function find(trace: readonly TraceEntry[], code: TraceCode, deviceId?: string): TraceEntry[] {
  return trace.filter((entry) => entry.code === code && (deviceId === undefined || entry.deviceId === deviceId));
}

export function ping(sim: Simulation, deviceId: string, destination: string, count = 1) {
  const sessionId = command(sim, { type: "ping", deviceId, destination, count });
  return () => sim.snapshot().pings.find((view) => view.id === sessionId);
}
