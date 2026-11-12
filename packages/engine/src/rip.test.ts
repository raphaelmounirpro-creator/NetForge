import { describe, expect, it } from "vitest";
import { frameBytes, type EthernetFrame, type RipMessage, type UdpDatagram } from "./pdu.js";
import { ripScenario, ScenarioBuilder } from "./scenarios.js";
import type { Simulation } from "./simulation.js";
import { advanceTo, command, find, ping, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { TraceEntry } from "./trace.js";
import type { RipRouteView } from "./views.js";

const ripTable = (sim: Simulation, id: string) => sim.snapshot().devices.find((device) => device.deviceId === id)?.rip?.routes ?? [];
const route = (sim: Simulation, id: string, cidr: string): RipRouteView | undefined => ripTable(sim, id).find((entry) => `${entry.destination}/${String(entry.prefixLength)}` === cidr);

/** Datagrammes RIP tels qu'émis sur les câbles, avec l'équipement émetteur. */
function ripOnWire(trace: readonly TraceEntry[]): Array<{ deviceId: string | null; portId: string | null; toDeviceId: unknown; frame: EthernetFrame; udp: UdpDatagram; rip: RipMessage; ttl: number; source: string; destination: string }> {
  return find(trace, "eth.transmit").flatMap((entry) => {
    const frame = entry.pdu;
    if (frame?.kind !== "ethernet" || frame.payload.kind !== "ipv4" || frame.payload.payload.kind !== "udp" || frame.payload.payload.payload.kind !== "rip") return [];
    const packet = frame.payload;
    const udp = frame.payload.payload;
    return [{ deviceId: entry.deviceId, portId: entry.portId, toDeviceId: entry.params["toDeviceId"], frame, udp, rip: frame.payload.payload.payload, ttl: packet.ttl, source: packet.source, destination: packet.destination }];
  });
}

describe("RIP : convergence sans route statique", () => {
  it("apprend tous les réseaux en métrique de sauts et route les pings entre les trois réseaux de postes", () => {
    const sim = start(ripScenario());
    settle(sim);
    // Réseaux locaux en métrique 1, réseaux d'un routeur voisin en métrique 2 (RFC 2453 §3.5 et §3.9.2).
    expect(ripTable(sim, "r1").map((entry) => [`${entry.destination}/${String(entry.prefixLength)}`, entry.state, entry.metric])).toEqual([
      ["10.1.0.0/24", "local", 1],
      ["10.2.0.0/24", "valid", 2],
      ["10.3.0.0/24", "valid", 2],
      ["10.12.0.0/30", "local", 1],
      ["10.13.0.0/30", "local", 1],
      ["10.23.0.0/30", "valid", 2],
    ]);
    expect(route(sim, "r1", "10.2.0.0/24")).toMatchObject({ nextHop: "10.12.0.2", portId: "ge1" });
    expect(route(sim, "r1", "10.3.0.0/24")).toMatchObject({ nextHop: "10.13.0.2", portId: "ge2" });
    expect(["10.12.0.2", "10.13.0.2"]).toContain(route(sim, "r1", "10.23.0.0/30")?.nextHop);
    // La table de routage contient les routes RIP, préférées aux seules routes absentes.
    const routes = sim.snapshot().devices.find((device) => device.deviceId === "r1")?.routes ?? [];
    expect(routes.find((item) => item.destination === "10.3.0.0")).toMatchObject({ kind: "rip", nextHop: "10.13.0.2", portId: "ge2", metric: 2, active: true });
    const results = [ping(sim, "pc1", "10.3.0.10"), ping(sim, "pc2", "10.1.0.10"), ping(sim, "pc3", "10.2.0.10")];
    settle(sim);
    for (const result of results) expect(result()?.attempts[0]?.status).toBe("reply");
    // Deux routeurs traversés : TTL 64 − 2.
    expect(results[0]?.()?.attempts[0]?.ttl).toBe(62);
  });

  it("converge par les demandes de démarrage et les mises à jour déclenchées, sans attendre l'annonce périodique", () => {
    const sim = start(ripScenario());
    const trace = settle(sim);
    expect(sim.time).toBeLessThan(fromSeconds(1));
    expect(find(trace, "rip.request-sent").map((entry) => [entry.deviceId, entry.portId])).toEqual([
      ["r1", "ge1"],
      ["r1", "ge2"],
      ["r2", "ge1"],
      ["r2", "ge2"],
      ["r3", "ge1"],
      ["r3", "ge2"],
    ]);
    expect(find(trace, "rip.response-sent").every((entry) => entry.params["reason"] !== "periodic")).toBe(true);
    expect(sim.snapshot().devices.find((device) => device.deviceId === "r1")?.rip?.nextUpdateAt).toBe(fromSeconds(30));
  });

  it("émet des messages conformes : groupe 224.0.0.9, TTL 1, UDP 520, demande de table complète, réponse unicast", () => {
    const sim = start(ripScenario());
    const wire = ripOnWire(settle(sim));
    const request = wire.find((item) => item.rip.command === "request");
    if (!request) throw new Error("demande attendue");
    expect(request.frame.destination).toBe("01:00:5e:00:00:09");
    expect([request.destination, request.ttl, request.udp.sourcePort, request.udp.destinationPort]).toEqual(["224.0.0.9", 1, 520, 520]);
    expect(request.rip.entries).toEqual([{ family: "unspecified", routeTag: 0, address: "0.0.0.0", mask: "0.0.0.0", nextHop: "0.0.0.0", metric: 16 }]);
    // En-tête Ethernet 14, IPv4 20, UDP 8, RIP 4 + 20 par entrée, FCS 4.
    expect(frameBytes(request.frame)).toBe(14 + 20 + 8 + 4 + 20 + 4);
    const reply = wire.find((item) => item.rip.command === "response" && item.destination !== "224.0.0.9");
    expect(reply?.udp.destinationPort).toBe(520);
    expect(reply?.rip.entries.every((entry) => entry.family === "inet" && entry.nextHop === "0.0.0.0" && entry.metric >= 1 && entry.metric <= 16)).toBe(true);
  });

  it("applique l'horizon partagé et n'émet jamais sur une interface passive, dont le réseau reste annoncé", () => {
    const sim = start(ripScenario());
    const wire = ripOnWire(settle(sim));
    advanceTo(sim, fromSeconds(31));
    // R1 n'annonce sur ge1 ni le réseau de ge1, ni ce qu'il a appris par ge1 (réseau de R2).
    const onGe1 = wire.filter((item) => item.deviceId === "r1" && item.portId === "ge1" && item.rip.command === "response").flatMap((item) => item.rip.entries.map((entry) => entry.address));
    expect(onGe1.length).toBeGreaterThan(0);
    expect(onGe1).not.toContain("10.12.0.0");
    expect(onGe1).not.toContain("10.2.0.0");
    expect(onGe1).toContain("10.1.0.0");
    expect(wire.some((item) => item.portId === "ge0" || String(item.toDeviceId).startsWith("pc"))).toBe(false);
    expect(route(sim, "r2", "10.1.0.0/24")).toMatchObject({ metric: 2, state: "valid" });
  });
});

describe("RIP : pannes et reconvergence", () => {
  it("coupure d'un lien : retrait immédiat aux deux extrémités, chemin de secours à l'annonce périodique suivante", () => {
    const sim = start(ripScenario());
    settle(sim);
    command(sim, { type: "set-link", linkId: "l6", up: false });
    const cut = settle(sim);
    const cutAt = find(cut, "command.link-down")[0]?.time ?? 0;
    expect(find(cut, "rip.route-unreachable", "r1").map((entry) => [entry.params["route"], entry.params["reason"]])).toEqual([
      ["10.13.0.0/30", "interface-down"],
      ["10.3.0.0/24", "interface-down"],
    ]);
    expect(route(sim, "r1", "10.3.0.0/24")).toMatchObject({ metric: 16, state: "deleting", garbageAt: cutAt + fromSeconds(120) });
    const during = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(during()?.attempts[0]).toMatchObject({ status: "error", errorType: "destination-unreachable", from: "10.1.0.1" });
    // R2 annonce 10.3.0.0/24 (métrique 2) à sa prochaine annonce périodique : R1 l'adopte en métrique 3.
    const periodic = advanceTo(sim, fromSeconds(31));
    const learned = find(periodic, "rip.route-learned", "r1").find((entry) => entry.params["route"] === "10.3.0.0/24");
    expect(learned?.time).toBeGreaterThanOrEqual(fromSeconds(30));
    expect(route(sim, "r1", "10.3.0.0/24")).toMatchObject({ nextHop: "10.12.0.2", metric: 3, state: "valid" });
    const after = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(after()?.attempts[0]).toMatchObject({ status: "reply", ttl: 61 });
    // Le réseau du lien coupé reste annoncé inaccessible 120 s, puis disparaît de la table.
    const removal = advanceTo(sim, cutAt + fromSeconds(121));
    expect(find(removal, "rip.route-removed", "r1").map((entry) => entry.params["route"])).toContain("10.13.0.0/30");
    expect(route(sim, "r1", "10.13.0.0/30")).toBeUndefined();
  });

  it("lien rétabli : le réseau revient et la demande de table rétablit aussitôt le chemin le plus court", () => {
    const sim = start(ripScenario());
    settle(sim);
    command(sim, { type: "set-link", linkId: "l6", up: false });
    settle(sim);
    advanceTo(sim, fromSeconds(31));
    expect(route(sim, "r1", "10.3.0.0/24")?.metric).toBe(3);
    command(sim, { type: "set-link", linkId: "l6", up: true });
    const restored = settle(sim);
    expect(find(restored, "rip.network-up", "r1").map((entry) => entry.params["route"])).toEqual(["10.13.0.0/30"]);
    expect(find(restored, "rip.request-sent", "r1").map((entry) => entry.portId)).toEqual(["ge2"]);
    expect(route(sim, "r1", "10.3.0.0/24")).toMatchObject({ nextHop: "10.13.0.2", metric: 2 });
    expect(find(restored, "rip.route-updated", "r1").find((entry) => entry.params["route"] === "10.3.0.0/24")?.params).toMatchObject({ previousMetric: 3, metric: 2 });
  });

  it("voisin disparu derrière un switch : expiration après 180 s sans annonce, suppression 120 s plus tard", () => {
    const doc = new ScenarioBuilder("rip-switch", "RIP derrière un switch")
      .device("r1", "R-200", 0, 0).device("sw1", "S-24", 200, 0).device("r2", "R-200", 400, 0).device("pc2", "PC", 600, 0)
      .link("r1", "ge1", "sw1", "ge1").link("sw1", "ge2", "r2", "ge1").link("r2", "ge0", "pc2", "eth0")
      .ip("r1", "ge1", "10.12.0.1/24").ip("r2", "ge1", "10.12.0.2/24").ip("r2", "ge0", "10.2.0.1/24")
      .rip("r1", "ge1").rip("r2", "ge1").rip("r2", "ge0", "passive")
      .build();
    const sim = start(doc);
    const startup = settle(sim);
    // Le switch répète la multidiffusion comme une diffusion (aucun suivi des groupes).
    expect(find(startup, "switch.flood-multicast", "sw1").length).toBeGreaterThan(0);
    const learnedAt = find(startup, "rip.route-learned", "r1")[0]?.time ?? 0;
    expect(route(sim, "r1", "10.2.0.0/24")).toMatchObject({ state: "valid", expiresAt: learnedAt + fromSeconds(180) });
    command(sim, { type: "set-link", linkId: "l2", up: false });
    settle(sim);
    advanceTo(sim, learnedAt + fromSeconds(179));
    expect(route(sim, "r1", "10.2.0.0/24")?.state).toBe("valid");
    const expiry = advanceTo(sim, learnedAt + fromSeconds(181));
    expect(find(expiry, "rip.route-unreachable", "r1")[0]?.params).toMatchObject({ route: "10.2.0.0/24", reason: "timeout" });
    const removal = advanceTo(sim, learnedAt + fromSeconds(301));
    expect(find(removal, "rip.route-removed", "r1").map((entry) => entry.params["route"])).toEqual(["10.2.0.0/24"]);
  });
});

describe("RIP : limites et erreurs de configuration observables", () => {
  it("limite le diamètre à 15 sauts : au-delà, la métrique 16 rend le réseau inaccessible", () => {
    // Le réseau d'origine doit être relié : une interface sans câble est inactive et son réseau n'est pas annoncé.
    const builder = new ScenarioBuilder("rip-chain", "Chaîne de 16 routeurs")
      .device("pc0", "PC", 0, 100).device("r1", "R-200", 0, 0).link("pc0", "eth0", "r1", "ge0")
      .ip("r1", "ge0", "10.100.0.1/24").rip("r1", "ge0", "passive");
    for (let index = 2; index <= 16; index += 1) {
      const previous = `r${String(index - 1)}`;
      const current = `r${String(index)}`;
      builder.device(current, "R-200", index * 100, 0).link(previous, "ge1", current, "ge2");
      builder.ip(previous, "ge1", `10.0.${String(index)}.1/30`).ip(current, "ge2", `10.0.${String(index)}.2/30`).rip(previous, "ge1").rip(current, "ge2");
    }
    const sim = start(builder.build());
    settle(sim);
    expect(route(sim, "r2", "10.100.0.0/24")?.metric).toBe(2);
    expect(route(sim, "r15", "10.100.0.0/24")?.metric).toBe(15);
    expect(route(sim, "r16", "10.100.0.0/24")).toBeUndefined();
  });

  it("interface passive chez le voisin : aucun échange, la multidiffusion est filtrée par sa carte", () => {
    const doc = new ScenarioBuilder("rip-passive", "Voisin passif")
      .device("r1", "R-200", 0, 0).device("r2", "R-200", 200, 0)
      .link("r1", "ge1", "r2", "ge1").ip("r1", "ge1", "10.12.0.1/30").ip("r2", "ge1", "10.12.0.2/30").ip("r2", "ge0", "10.2.0.1/24")
      .rip("r1", "ge1").rip("r2", "ge1", "passive").rip("r2", "ge0", "passive")
      .build();
    const sim = start(doc);
    const trace = settle(sim);
    expect(find(trace, "nic.filtered", "r2")[0]?.params).toMatchObject({ destination: "01:00:5e:00:00:09" });
    expect(route(sim, "r1", "10.2.0.0/24")).toBeUndefined();
  });

  it("voisin d'un autre réseau sur le même câble : ses messages sont ignorés", () => {
    const doc = new ScenarioBuilder("rip-mismatch", "Réseaux différents sur un lien")
      .device("r1", "R-200", 0, 0).device("r2", "R-200", 200, 0)
      .link("r1", "ge1", "r2", "ge1").ip("r1", "ge1", "10.12.0.1/30").ip("r2", "ge1", "10.99.0.2/30").ip("r2", "ge0", "10.2.0.1/24")
      .rip("r1", "ge1").rip("r2", "ge1").rip("r2", "ge0", "passive")
      .build();
    const sim = start(doc);
    const trace = settle(sim);
    expect(find(trace, "rip.ignored", "r1").map((entry) => entry.params)).toContainEqual({ reason: "not-neighbor", from: "10.99.0.2" });
    expect(route(sim, "r1", "10.2.0.0/24")).toBeUndefined();
  });

  it("sans RIP, les réseaux distants restent inaccessibles", () => {
    const sim = start(ripScenario({ rip: false }));
    settle(sim);
    const result = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(result()?.attempts[0]).toMatchObject({ status: "error", errorType: "destination-unreachable" });
  });
});

describe("RIP : déterminisme", () => {
  it("produit la même trace pour la même graine, y compris les attentes tirées des mises à jour déclenchées", () => {
    const run = (seed: number) => {
      const sim = start(ripScenario(), { seed });
      settle(sim);
      command(sim, { type: "set-link", linkId: "l6", up: false });
      settle(sim);
      return advanceTo(sim, fromSeconds(40));
    };
    expect(JSON.stringify(run(3))).toBe(JSON.stringify(run(3)));
  });
});
