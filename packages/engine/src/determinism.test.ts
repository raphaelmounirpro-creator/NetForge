import type { NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { lanScenario, routedScenario, switchLoopScenario } from "./scenarios.js";
import type { Simulation } from "./simulation.js";
import { advanceTo, command, find, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { TraceEntry } from "./trace.js";

/** Scénario de référence : deux pings, une coupure de lien puis un rétablissement. */
function scenario(sim: Simulation): TraceEntry[] {
  const trace: TraceEntry[] = [];
  command(sim, { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 3 });
  trace.push(...settle(sim));
  trace.push(...advanceTo(sim, fromSeconds(20)));
  command(sim, { type: "set-link", linkId: "l4", up: false });
  command(sim, { type: "ping", deviceId: "pc2", destination: "192.168.1.10", count: 2 });
  trace.push(...settle(sim));
  command(sim, { type: "set-link", linkId: "l4", up: true });
  command(sim, { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 1 });
  trace.push(...settle(sim));
  return trace;
}

describe("déterminisme", () => {
  it("produit la même trace logique pour la même graine et les mêmes actions", () => {
    const first = scenario(start(routedScenario(), { seed: 42 }));
    const second = scenario(start(routedScenario(), { seed: 42 }));
    expect(first.length).toBeGreaterThan(50);
    expect(second).toEqual(first);
  });

  it("rejoue une session à partir du journal des commandes", () => {
    const original = start(routedScenario(), { seed: 7 });
    const trace = scenario(original);

    const replay = start(routedScenario(), { seed: 7 });
    const replayed: TraceEntry[] = [];
    for (const { time, command: value } of original.commandLog) {
      replayed.push(...replay.run({ until: time, maxEvents: 1_000_000 }).trace);
      command(replay, value);
    }
    replayed.push(...settle(replay));
    expect(replayed).toEqual(trace);
  });

  it("change les identifiants tirés au hasard avec la graine, pas le déroulement", () => {
    const a = scenario(start(routedScenario(), { seed: 1 }));
    const b = scenario(start(routedScenario(), { seed: 2 }));
    expect(b.map((entry) => entry.code)).toEqual(a.map((entry) => entry.code));
    const identifiers = (trace: TraceEntry[]) => find(trace, "command.ping").map((entry) => entry.params["identifier"]);
    expect(identifiers(b)).not.toEqual(identifiers(a));
  });

  it("ne dépend pas de l'ordre des équipements et des liens dans le document", () => {
    const doc = lanScenario();
    const shuffled: NfgDocument = {
      ...doc,
      topology: { devices: [...doc.topology.devices].reverse(), links: [...doc.topology.links].reverse() },
    };
    const run = (value: NfgDocument) => {
      const sim = start(value, { seed: 3 });
      command(sim, { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 2 });
      return settle(sim);
    };
    expect(run(shuffled)).toEqual(run(doc));
  });

  it("numérote les événements dans l'ordre de traitement et relie chaque décision à sa cause", () => {
    const sim = start(lanScenario());
    command(sim, { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 });
    const trace = settle(sim);
    let previous = 0;
    let previousTime = 0;
    for (const entry of trace) {
      expect(entry.event).toBeGreaterThanOrEqual(previous);
      expect(entry.time).toBeGreaterThanOrEqual(previousTime);
      previous = entry.event;
      previousTime = entry.time;
    }
    // La réception par PC2 de la requête ARP est causée par l'émission du switch.
    const received = find(trace, "arp.request-received", "pc2")[0];
    const flood = find(trace, "switch.flood-broadcast", "sw1")[0];
    expect(received?.parent).toBe(flood?.event);
  });
});

describe("limites d'exécution", () => {
  const loopScenario = switchLoopScenario;

  it("interrompt proprement une tempête de diffusion et explique la limite atteinte", () => {
    const sim = start(loopScenario(), { parameters: { limits: { maxPendingEvents: 200 } } });
    command(sim, { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 });
    const result = sim.run({ stopWhenIdle: true, maxEvents: 1_000_000 });
    expect(result.stop).toBe("interrupted");
    expect(sim.diagnostic).toMatchObject({ code: "limit.pending-events", limit: 200 });
    expect(sim.diagnostic?.pendingEvents).toBeGreaterThan(200);
    expect(result.trace.at(-1)?.code).toBe("sim.interrupted");
    // Après interruption : plus aucun calcul, commandes refusées.
    expect(sim.run({ maxEvents: 10 }).processed).toBe(0);
    expect(sim.enqueue({ type: "ping", deviceId: "pc1", destination: "192.168.1.11" })).toMatchObject({ ok: false, code: "command.interrupted" });
    expect(sim.snapshot().status).toBe("interrupted");
  });

  it("interrompt au-delà du nombre total d'événements autorisé", () => {
    const sim = start(loopScenario(), { parameters: { limits: { maxEvents: 300, maxPendingEvents: 1_000_000 } } });
    command(sim, { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 });
    sim.run({ stopWhenIdle: true, maxEvents: 1_000_000 });
    expect(sim.diagnostic).toMatchObject({ code: "limit.events", limit: 300 });
    expect(sim.processedEvents).toBe(300);
  });

  it("découpe le calcul en lots sans changer le résultat", () => {
    const whole = start(routedScenario());
    command(whole, { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 3 });
    const expected = settle(whole);

    const sliced = start(routedScenario());
    command(sliced, { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 3 });
    const collected: TraceEntry[] = [];
    for (;;) {
      const result = sliced.run({ stopWhenIdle: true, maxEvents: 3 });
      collected.push(...result.trace);
      if (result.stop !== "budget") break;
    }
    expect(collected).toEqual(expected);
  });

  it("avance pas à pas : chaque pas produit au moins une décision", () => {
    const sim = start(lanScenario());
    command(sim, { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 });
    const steps: TraceEntry[][] = [];
    while (sim.hasActivity()) steps.push(sim.step().trace);
    expect(steps.length).toBeGreaterThan(5);
    expect(steps.every((trace) => trace.length > 0)).toBe(true);
    // Les temporisations d'expiration restent programmées après les échanges.
    expect(sim.pendingEvents).toBeGreaterThan(0);
    expect(sim.hasActivity()).toBe(false);
  });

  it("avance l'horloge jusqu'à l'horizon demandé même sans événement", () => {
    const sim = start(lanScenario());
    sim.run({ until: fromSeconds(5), maxEvents: 100 });
    expect(sim.time).toBe(fromSeconds(5));
  });
});
