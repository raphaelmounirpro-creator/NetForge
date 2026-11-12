import { setStp, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { buildNetwork, isPortUp } from "./network.js";
import { stpParallelScenario, stpTriangleScenario, switchLoopScenario } from "./scenarios.js";
import { createSimulation, type Simulation } from "./simulation.js";
import { computeSpanningTree, stpPortCost, stpPortKey } from "./stp.js";
import type { TraceEntry } from "./trace.js";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

function simulation(doc: NfgDocument): Simulation {
  const created = createSimulation(doc);
  if (!created.ok) throw new Error(created.issues.map((issue) => issue.code).join(", "));
  return created.simulation;
}

/** Ping d'un écho jusqu'à la fin des échanges ; renvoie la trace et le nombre de réponses. */
function ping(sim: Simulation, from: string, to: string): { trace: TraceEntry[]; replies: number } {
  const outcome = sim.enqueue({ type: "ping", deviceId: from, destination: to, count: 1 });
  if (!outcome.ok) throw new Error(outcome.code);
  const trace: TraceEntry[] = [];
  for (let slice = 0; slice < 100; slice += 1) {
    const result = sim.run({ stopWhenIdle: true, maxEvents: 20_000 });
    trace.push(...result.trace);
    if (result.stop !== "budget") break;
  }
  const view = sim.snapshot().pings.find((item) => item.id === outcome.sessionId);
  return { trace, replies: view?.attempts.filter((attempt) => attempt.status === "reply").length ?? 0 };
}

const stpOf = (sim: Simulation, deviceId: string) => sim.snapshot().devices.find((device) => device.deviceId === deviceId)?.stp;
const portStp = (sim: Simulation, deviceId: string, portId: string) => stpOf(sim, deviceId)?.ports.find((port) => port.portId === portId);

describe("Spanning Tree : élection et rôles (802.1D)", () => {
  it("élit la racine au plus petit identifiant de pont et choisit les ports racine et désignés", () => {
    const network = buildNetwork(stpTriangleScenario());
    const tree = computeSpanningTree(network, (port) => isPortUp(network, port));
    expect([...tree.bridges.values()].map((bridge) => bridge.rootDeviceId)).toEqual(["sw1", "sw1", "sw1"]);
    expect([tree.bridges.get("sw1")?.rootPort, tree.bridges.get("sw2")?.rootPort, tree.bridges.get("sw3")?.rootPort]).toEqual([null, "ge1", "ge1"]);
    expect([tree.bridges.get("sw2")?.rootCost, tree.bridges.get("sw3")?.rootCost]).toEqual([4, 4]);
    const role = (device: string, port: string) => tree.ports.get(stpPortKey(device, port))?.role;
    // Segment SW2–SW3 : coûts égaux, SW2 a le plus petit identifiant de pont → désigné ; SW3 bloque.
    expect([role("sw1", "ge1"), role("sw1", "ge2"), role("sw2", "ge2"), role("sw3", "ge2"), role("sw2", "ge10"), role("sw2", "ge5")]).toEqual([
      "designated",
      "designated",
      "designated",
      "alternate",
      "designated",
      "disabled",
    ]);
    expect(stpPortCost(1000)).toBe(4);
  });

  it("entre câbles parallèles, garde le port relié au plus petit numéro de port émetteur", () => {
    const sim = simulation(stpParallelScenario());
    expect(stpOf(sim, "sw2")?.rootPort).toBe("ge1");
    expect(["ge1", "ge2", "ge3"].map((port) => portStp(sim, "sw2", port)?.state)).toEqual(["forwarding", "blocking", "blocking"]);
  });
});

describe("Spanning Tree : effet sur la commutation", () => {
  it("empêche la tempête de diffusion de la boucle de référence : le ping réussit, des trames sont écartées", () => {
    const sim = simulation(stpParallelScenario());
    const run = ping(sim, "pc1", "192.168.1.11");
    expect(run.replies).toBe(1);
    expect(sim.snapshot().status).toBe("ready");
    expect(run.trace.some((entry) => entry.code === "stp.discarded" && entry.deviceId === "sw2" && entry.params["state"] === "blocking")).toBe(true);
    // Sans STP, la même topologie s'interrompt sur une tempête.
    const storm = simulation(switchLoopScenario());
    ping(storm, "pc1", "192.168.1.11");
    expect(storm.snapshot().status).toBe("interrupted");
  });

  it("achemine le trafic par la racine quand le segment direct est bloqué", () => {
    const sim = simulation(stpTriangleScenario());
    const run = ping(sim, "pc1", "192.168.1.11");
    expect(run.replies).toBe(1);
    const transmitted = run.trace.filter((entry) => entry.code === "eth.transmit").map((entry) => entry.params["linkId"]);
    expect(transmitted).toContain("l1");
    expect(transmitted).toContain("l3");
    // Le port désigné de SW2 émet sur le segment SW2–SW3 ; le port bloqué de SW3 écarte et n'émet jamais.
    expect(run.trace.some((entry) => entry.code === "stp.discarded" && entry.deviceId === "sw3" && entry.portId === "ge2")).toBe(true);
    expect(run.trace.some((entry) => entry.code === "eth.transmit" && entry.deviceId === "sw3" && entry.params["linkId"] === "l2")).toBe(false);
  });

  it("ignore un switch dont STP est désactivé : ses ports transmettent toujours", () => {
    const doc = ok(setStp(stpTriangleScenario(), { deviceId: "sw3", enabled: false, priority: 32768 }));
    const sim = simulation(doc);
    expect(stpOf(sim, "sw3")).toMatchObject({ enabled: false, ports: [] });
    expect(portStp(sim, "sw2", "ge2")?.role).toBe("designated");
  });
});

describe("Spanning Tree : reconvergence après une coupure", () => {
  it("débloque le port alternatif en passant par l'écoute puis l'apprentissage (Forward Delay de 15 s chacun)", () => {
    const sim = simulation(stpTriangleScenario());
    sim.enqueue({ type: "set-link", linkId: "l3", up: false });
    const cut = sim.run({ stopWhenIdle: false, until: sim.snapshot().time + 1, maxEvents: 1_000 });
    expect(cut.trace.filter((entry) => entry.code === "stp.topology-change").map((entry) => entry.deviceId).sort()).toEqual(["sw1", "sw2", "sw3"]);
    expect(stpOf(sim, "sw3")).toMatchObject({ rootPort: "ge2", rootCost: 8 });
    expect(portStp(sim, "sw3", "ge2")?.state).toBe("listening");

    const later = sim.run({ until: 31_000_000_000, maxEvents: 100_000 });
    const states = later.trace.filter((entry) => entry.code === "stp.port-state" && entry.deviceId === "sw3" && entry.portId === "ge2");
    expect(states.map((entry) => [entry.params["state"], entry.time])).toEqual([
      ["learning", 15_000_000_000],
      ["forwarding", 30_000_000_000],
    ]);
    expect(ping(sim, "pc1", "192.168.1.11").replies).toBe(1);
  });

  it("ne laisse pas passer le trafic pendant l'écoute", () => {
    const sim = simulation(stpTriangleScenario());
    sim.enqueue({ type: "set-link", linkId: "l3", up: false });
    sim.run({ until: sim.snapshot().time + 1, maxEvents: 1_000 });
    const run = ping(sim, "pc1", "192.168.1.11");
    expect(run.replies).toBe(0);
    expect(run.trace.some((entry) => entry.code === "stp.discarded" && entry.deviceId === "sw3" && entry.params["state"] === "listening")).toBe(true);
  });

  it("rebloque immédiatement le port quand le lien revient, sans repasser par l'écoute", () => {
    const sim = simulation(stpTriangleScenario());
    sim.enqueue({ type: "set-link", linkId: "l3", up: false });
    sim.run({ until: 31_000_000_000, maxEvents: 100_000 });
    sim.enqueue({ type: "set-link", linkId: "l3", up: true });
    const back = sim.run({ until: sim.snapshot().time + 1, maxEvents: 1_000 });
    expect(back.trace.find((entry) => entry.code === "stp.port-state" && entry.deviceId === "sw3" && entry.portId === "ge2")?.params["state"]).toBe("blocking");
    expect(portStp(sim, "sw3", "ge1")?.state).toBe("listening");
  });
});
