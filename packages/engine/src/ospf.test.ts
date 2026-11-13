import type { NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { compareLsa, computeOspfRoutes, electDesignatedRouter } from "./ospf.js";
import { frameBytes, OSPF_INITIAL_SEQUENCE, type EthernetFrame, type OspfLsa, type OspfPacket } from "./pdu.js";
import { ospfLanScenario, ospfScenario, ScenarioBuilder } from "./scenarios.js";
import type { Simulation } from "./simulation.js";
import { advanceTo, command, find, ping, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { TraceEntry } from "./trace.js";

const ospfOf = (sim: Simulation, id: string) => sim.snapshot().devices.find((device) => device.deviceId === id)?.ospf;
const iface = (sim: Simulation, id: string, portId: string) => ospfOf(sim, id)?.interfaces.find((item) => item.portId === portId);
const routeTo = (sim: Simulation, id: string, destination: string) =>
  sim.snapshot().devices.find((device) => device.deviceId === id)?.routes.find((route) => route.destination === destination && route.kind === "ospf");
/** Base d'états des liens sans l'âge, qui dépend de l'instant d'installation. */
const lsdb = (sim: Simulation, id: string) => ospfOf(sim, id)?.lsdb.map(({ age: _age, ...lsa }) => lsa);

/** Câble reliant deux équipements d'un scénario. */
function linkOf(doc: NfgDocument, a: string, b: string): string {
  const link = doc.topology.links.find((item) => item.endpoints.some((end) => end.deviceId === a) && item.endpoints.some((end) => end.deviceId === b));
  if (!link) throw new Error(`aucun câble ${a}–${b}`);
  return link.id;
}

/** Paquets OSPF tels qu'émis sur les câbles. */
function ospfOnWire(trace: readonly TraceEntry[]): Array<{ deviceId: string | null; portId: string | null; frame: EthernetFrame; ospf: OspfPacket; ttl: number; source: string; destination: string }> {
  return find(trace, "eth.transmit").flatMap((entry) => {
    const frame = entry.pdu;
    if (frame?.kind !== "ethernet" || frame.payload.kind !== "ipv4" || frame.payload.payload.kind !== "ospf") return [];
    return [{ deviceId: entry.deviceId, portId: entry.portId, frame, ospf: frame.payload.payload, ttl: frame.payload.ttl, source: frame.payload.source, destination: frame.payload.destination }];
  });
}

describe("OSPF : fonctions du protocole", () => {
  it("élit le DR et le BDR par priorité puis identifiant, en deux temps pour le routeur élu (RFC 2328 §9.4)", () => {
    const a = { routerId: "10.0.0.1", address: "10.0.0.1", priority: 1, dr: "0.0.0.0", bdr: "0.0.0.0" };
    const b = { routerId: "10.0.0.2", address: "10.0.0.2", priority: 1, dr: "0.0.0.0", bdr: "0.0.0.0" };
    const c = { routerId: "10.0.0.3", address: "10.0.0.3", priority: 0, dr: "0.0.0.0", bdr: "0.0.0.0" };
    // B, plus grand identifiant, devient DR ; A est BDR ; C (priorité 0) n'est jamais élu.
    expect(electDesignatedRouter(b, [a, c])).toEqual({ dr: "10.0.0.2", bdr: "10.0.0.1" });
    expect(electDesignatedRouter(c, [a, b])).toEqual({ dr: "10.0.0.2", bdr: "10.0.0.2" });
    // Un DR déjà déclaré reste DR face à une priorité plus haute (élection sans préemption).
    const high = { routerId: "10.0.0.9", address: "10.0.0.9", priority: 200, dr: "0.0.0.0", bdr: "0.0.0.0" };
    expect(electDesignatedRouter(high, [{ ...a, dr: a.address }, { ...b, dr: a.address, bdr: b.address }])).toEqual({ dr: "10.0.0.1", bdr: "10.0.0.2" });
  });

  it("compare deux instances d'un LSA : séquence, puis MaxAge, puis écart d'âge de plus de 15 minutes (RFC 2328 §13.1)", () => {
    expect(compareLsa({ sequence: OSPF_INITIAL_SEQUENCE + 1, age: 900 }, { sequence: OSPF_INITIAL_SEQUENCE, age: 0 })).toBe(1);
    // Numéros signés : 0x80000001 précède 0x7fffffff.
    expect(compareLsa({ sequence: 0x7fffffff, age: 0 }, { sequence: OSPF_INITIAL_SEQUENCE, age: 0 })).toBe(1);
    expect(compareLsa({ sequence: 5, age: 3600 }, { sequence: 5, age: 10 })).toBe(1);
    expect(compareLsa({ sequence: 5, age: 10 }, { sequence: 5, age: 1000 })).toBe(1);
    expect(compareLsa({ sequence: 5, age: 10 }, { sequence: 5, age: 800 })).toBe(0);
  });

  it("calcule les routes de plus faible coût, en vérifiant chaque lien dans les deux sens (RFC 2328 §16.1)", () => {
    const header = { age: 0, sequence: OSPF_INITIAL_SEQUENCE };
    const router = (id: string, links: Array<[type: "transit" | "stub", linkId: string, linkData: string, metric: number]>): OspfLsa => ({
      ...header,
      lsaType: "router",
      lsId: id,
      advertisingRouter: id,
      links: links.map(([type, linkId, linkData, metric]) => ({ type, linkId, linkData, metric })),
    });
    const network = (dr: string, advertisingRouter: string, attachedRouters: string[]): OspfLsa => ({ ...header, lsaType: "network", lsId: dr, advertisingRouter, mask: "255.255.255.252", attachedRouters });
    const lsas = [
      router("1.1.1.1", [["transit", "10.12.0.2", "10.12.0.1", 10], ["transit", "10.13.0.2", "10.13.0.1", 30]]),
      router("2.2.2.2", [["transit", "10.12.0.2", "10.12.0.2", 10], ["transit", "10.23.0.2", "10.23.0.1", 10]]),
      router("3.3.3.3", [["transit", "10.13.0.2", "10.13.0.2", 30], ["transit", "10.23.0.2", "10.23.0.2", 10], ["stub", "10.3.0.0", "255.255.255.0", 5]]),
      network("10.12.0.2", "2.2.2.2", ["1.1.1.1", "2.2.2.2"]),
      network("10.13.0.2", "3.3.3.3", ["1.1.1.1", "3.3.3.3"]),
      network("10.23.0.2", "3.3.3.3", ["2.2.2.2", "3.3.3.3"]),
    ];
    const toPc3 = computeOspfRoutes("1.1.1.1", lsas).find((route) => route.prefixLength === 24);
    // Par R2 : 10 + 10 + 5 = 25, contre 30 + 5 = 35 par le lien direct.
    expect(toPc3).toEqual({ destination: (10 << 24) + (3 << 16), prefixLength: 24, cost: 25, nextHop: (10 << 24) + (12 << 16) + 2, via: "10.12.0.1" });
    // Lien à sens unique (R2 ne décrit plus le réseau 10.23) : chemin par R2 inutilisable.
    const oneWay = lsas.map((lsa) => (lsa.lsId === "2.2.2.2" ? router("2.2.2.2", [["transit", "10.12.0.2", "10.12.0.2", 10]]) : lsa));
    expect(computeOspfRoutes("1.1.1.1", oneWay).find((route) => route.prefixLength === 24)?.cost).toBe(35);
    // LSA d'âge MaxAge : exclu du calcul.
    expect(computeOspfRoutes("1.1.1.1", lsas.map((lsa) => (lsa.lsId === "3.3.3.3" ? { ...lsa, age: 3600 } : lsa))).some((route) => route.prefixLength === 24)).toBe(false);
  });
});

describe("OSPF : convergence du triangle de référence", () => {
  it("établit les voisinages, synchronise une base identique sur les trois routeurs et choisit les routes de plus faible coût", () => {
    const sim = start(ospfScenario());
    settle(sim);
    // Attente de 40 s (RouterDeadInterval) avant l'élection, puis échange de base : convergence juste après 40 s.
    expect(sim.time).toBeGreaterThanOrEqual(fromSeconds(40));
    expect(sim.time).toBeLessThan(fromSeconds(41));
    for (const id of ["r1", "r2", "r3"]) {
      const neighbors = ospfOf(sim, id)?.interfaces.flatMap((item) => item.neighbors) ?? [];
      expect(neighbors.map((neighbor) => neighbor.state)).toEqual(["full", "full"]);
    }
    expect(ospfOf(sim, "r1")?.routerId).toBe("10.13.0.1");
    // Sur chaque liaison, le plus grand identifiant devient DR : R2 sur R1–R2, R3 sur R1–R3 et R2–R3.
    expect([iface(sim, "r1", "ge1")?.dr, iface(sim, "r1", "ge2")?.dr, iface(sim, "r2", "ge2")?.dr]).toEqual(["10.23.0.1", "10.23.0.2", "10.23.0.2"]);
    // Base identique : trois LSA routeur et trois LSA réseau (un par liaison, émis par son DR).
    const reference = lsdb(sim, "r1");
    expect(lsdb(sim, "r2")).toEqual(reference);
    expect(lsdb(sim, "r3")).toEqual(reference);
    expect(reference?.map((lsa) => [lsa.lsaType, lsa.advertisingRouter])).toEqual([
      ["router", "10.13.0.1"],
      ["router", "10.23.0.1"],
      ["router", "10.23.0.2"],
      ["network", "10.23.0.1"],
      ["network", "10.23.0.2"],
      ["network", "10.23.0.2"],
    ]);
    // Coût et non nombre de sauts : R1 joint le réseau de PC3 par R2 (10 + 10 + 10), pas par le lien direct (30 + 10).
    expect(routeTo(sim, "r1", "10.3.0.0")).toMatchObject({ kind: "ospf", nextHop: "10.12.0.2", portId: "ge1", metric: 30, active: true });
    expect(routeTo(sim, "r3", "10.1.0.0")).toMatchObject({ nextHop: "10.23.0.1", metric: 30 });
    const toPc3 = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(toPc3()?.attempts[0]).toMatchObject({ status: "reply", ttl: 61 });
  });

  it("découvre les voisins par Hello déclenché, puis attend 40 s avant d'élire le DR", () => {
    const sim = start(ospfScenario());
    const early = advanceTo(sim, fromSeconds(1));
    expect(find(early, "ospf.neighbor-state").filter((entry) => entry.params["to"] === "2-way")).toHaveLength(6);
    expect(iface(sim, "r1", "ge1")).toMatchObject({ state: "waiting", dr: null });
    advanceTo(sim, fromSeconds(39));
    expect(iface(sim, "r1", "ge1")?.state).toBe("waiting");
    const election = settle(sim);
    // Élection en deux temps (RFC 2328 §9.4) : sans déclaration, R2 est à la fois BDR et DR dans le calcul de R1 ;
    // le Hello déclenché de R2 (DR = R2, BDR = R1) relance l'élection et R1 devient BDR.
    expect(find(election, "ospf.interface-state", "r1").filter((entry) => entry.portId === "ge1").map((entry) => entry.params)).toEqual([
      { from: "waiting", to: "dr-other", cause: "wait-timer", dr: "10.23.0.1", bdr: "10.23.0.1" },
      { from: "dr-other", to: "backup", cause: "neighbor-change", dr: "10.23.0.1", bdr: "10.13.0.1" },
    ]);
  });

  it("émet des paquets conformes : Hello vers 224.0.0.5 en TTL 1, description de base unicast, maître au plus grand identifiant", () => {
    const sim = start(ospfScenario());
    const trace = settle(sim);
    const wire = ospfOnWire(trace);
    const hello = wire.find((item) => item.ospf.type === "hello" && item.deviceId === "r1");
    expect(hello).toMatchObject({ destination: "224.0.0.5", ttl: 1, frame: { destination: "01:00:5e:00:00:05" } });
    if (hello?.ospf.type !== "hello") throw new Error("Hello attendu");
    expect(hello.ospf).toMatchObject({ version: 2, area: "0.0.0.0", helloInterval: 10, deadInterval: 40, priority: 1, networkMask: "255.255.255.252" });
    // Trame : 14 + 20 (IPv4) + 24 (en-tête OSPF) + 20 + 4 par voisin + 4 (FCS).
    const withNeighbor = wire.find((item) => item.ospf.type === "hello" && item.ospf.neighbors.length === 1);
    expect(withNeighbor && frameBytes(withNeighbor.frame)).toBe(14 + 20 + 24 + 20 + 4 + 4);
    // Négociation : chaque côté se déclare maître (I, M, MS) ; R2 (10.23.0.1) l'emporte sur R1 (10.13.0.1).
    const initial = wire.filter((item) => item.ospf.type === "dd" && item.ospf.init && item.portId === "ge1" && (item.deviceId === "r1" || item.deviceId === "r2"));
    expect(initial.map((item) => [item.deviceId, item.destination])).toEqual(expect.arrayContaining([["r1", "10.12.0.2"], ["r2", "10.12.0.1"]]));
    expect(find(trace, "ospf.dd-received", "r1").map((entry) => entry.params["role"])).toContain("slave");
    expect(find(trace, "ospf.dd-received", "r2").filter((entry) => entry.params["neighbor"] === "10.13.0.1").map((entry) => entry.params["role"])).toContain("master");
    // Interfaces passives : aucun paquet OSPF vers les postes.
    expect(wire.filter((item) => item.portId === "ge0")).toEqual([]);
    expect(find(trace, "nic.filtered").filter((entry) => entry.deviceId?.startsWith("pc"))).toEqual([]);
  });
});

describe("OSPF : pannes et reconvergence", () => {
  it("coupure d'un lien : voisins perdus aussitôt, chemin par le lien coûteux ; retour du chemin court après l'attente au rétablissement", () => {
    const sim = start(ospfScenario());
    settle(sim);
    const linkId = linkOf(ospfScenario(), "r1", "r2");
    command(sim, { type: "set-link", linkId, up: false });
    const cut = settle(sim);
    expect(find(cut, "ospf.neighbor-state", "r1").map((entry) => [entry.params["neighbor"], entry.params["to"], entry.params["event"]])).toEqual([["10.23.0.1", "down", "interface-down"]]);
    expect(routeTo(sim, "r1", "10.3.0.0")).toMatchObject({ nextHop: "10.13.0.2", portId: "ge2", metric: 40 });
    expect(routeTo(sim, "r1", "10.2.0.0")).toMatchObject({ nextHop: "10.13.0.2", metric: 50 });
    // Le LSA réseau de la liaison coupée est retiré partout ; les bases restent identiques.
    expect(lsdb(sim, "r1")?.some((lsa) => lsa.lsaType === "network" && lsa.lsId === "10.12.0.2")).toBe(false);
    expect(lsdb(sim, "r2")).toEqual(lsdb(sim, "r1"));
    expect(lsdb(sim, "r3")).toEqual(lsdb(sim, "r1"));
    const detour = ping(sim, "pc1", "10.2.0.10");
    settle(sim);
    expect(detour()?.attempts[0]).toMatchObject({ status: "reply", ttl: 61 });

    const restoredAt = sim.time;
    command(sim, { type: "set-link", linkId, up: true });
    settle(sim);
    expect(sim.time - restoredAt).toBeGreaterThanOrEqual(fromSeconds(40));
    expect(routeTo(sim, "r1", "10.3.0.0")).toMatchObject({ nextHop: "10.12.0.2", metric: 30 });
    expect(lsdb(sim, "r3")).toEqual(lsdb(sim, "r1"));
  });

  it("refuse le voisinage quand les masques diffèrent sur un même lien (paramètres du Hello)", () => {
    const sim = start(
      new ScenarioBuilder("ospf-mask", "OSPF : masques différents")
        .device("r1", "R-200", 0, 0).device("r2", "R-200", 200, 0)
        .link("r1", "ge0", "r2", "ge0")
        .ip("r1", "ge0", "10.0.0.1/24").ip("r2", "ge0", "10.0.0.2/25")
        .ospf("r1", "ge0").ospf("r2", "ge0")
        .build(),
    );
    const trace = settle(sim);
    expect(find(trace, "ospf.hello-mismatch", "r2")[0]?.params).toMatchObject({ field: "mask", expected: "255.255.255.128", received: "255.255.255.0" });
    expect(ospfOf(sim, "r1")?.interfaces[0]?.neighbors).toEqual([]);
  });

  it("rafraîchit ses LSA toutes les 30 minutes avec un nouveau numéro de séquence", () => {
    const sim = start(ospfScenario());
    settle(sim);
    const before = ospfOf(sim, "r1")?.lsdb.find((lsa) => lsa.lsaType === "router" && lsa.advertisingRouter === "10.13.0.1");
    const trace = advanceTo(sim, fromSeconds(40 + 1800 + 1));
    const after = ospfOf(sim, "r2")?.lsdb.find((lsa) => lsa.lsaType === "router" && lsa.advertisingRouter === "10.13.0.1");
    expect(find(trace, "ospf.lsa-originated", "r1").some((entry) => entry.params["refresh"] === true)).toBe(true);
    expect(after?.sequence).toBe((before?.sequence ?? 0) + 1);
    expect(after?.age).toBeLessThan(5);
  });
});

describe("OSPF : réseau à diffusion et élection du DR", () => {
  it("élit R2 DR (priorité 100) et R4 BDR (plus grand identifiant à priorité égale) ; les autres restent en 2-Way entre eux", () => {
    const sim = start(ospfLanScenario());
    settle(sim);
    expect(["r1", "r2", "r3", "r4"].map((id) => iface(sim, id, "ge0")?.state)).toEqual(["dr-other", "dr", "dr-other", "backup"]);
    expect(iface(sim, "r1", "ge0")).toMatchObject({ dr: "10.2.0.1", bdr: "10.4.0.1" });
    // Adjacences avec le DR et le BDR seulement : R1 et R3 (DR Other) restent en 2-Way.
    expect(iface(sim, "r1", "ge0")?.neighbors.map((neighbor) => [neighbor.routerId, neighbor.state, neighbor.role])).toEqual([
      ["10.2.0.1", "full", "dr"],
      ["10.3.0.1", "2-way", "other"],
      ["10.4.0.1", "full", "bdr"],
    ]);
    // LSA réseau émis par le DR, avec les quatre routeurs pleinement adjacents.
    expect(lsdb(sim, "r3")?.find((lsa) => lsa.lsaType === "network")).toMatchObject({ lsId: "10.0.0.2", advertisingRouter: "10.2.0.1", attachedRouters: ["10.1.0.1", "10.2.0.1", "10.3.0.1", "10.4.0.1"] });
    for (const id of ["r2", "r3", "r4"]) expect(lsdb(sim, id)).toEqual(lsdb(sim, "r1"));
    // Le trafic ne passe pas par le DR : R1 envoie directement à R3 sur le réseau commun.
    expect(routeTo(sim, "r1", "10.3.0.0")).toMatchObject({ nextHop: "10.0.0.3", metric: 20 });
    const toPc3 = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(toPc3()?.attempts[0]).toMatchObject({ status: "reply", ttl: 62 });
  });

  it("inonde vers 224.0.0.6 depuis un DR Other et vers 224.0.0.5 depuis le DR ; seuls DR et BDR écoutent 224.0.0.6", () => {
    const sim = start(ospfLanScenario());
    const trace = settle(sim);
    const floods = find(trace, "ospf.lsu-sent").filter((entry) => entry.params["reason"] === "flood");
    expect(new Set(floods.filter((entry) => entry.deviceId === "r1" || entry.deviceId === "r3").map((entry) => entry.params["destination"]))).toEqual(new Set(["224.0.0.6"]));
    expect(new Set(floods.filter((entry) => entry.deviceId === "r2").map((entry) => entry.params["destination"]))).toEqual(new Set(["224.0.0.5"]));
    expect(find(trace, "nic.filtered").filter((entry) => (entry.deviceId === "r1" || entry.deviceId === "r3") && entry.params["destination"] === "01:00:5e:00:00:06").length).toBeGreaterThan(0);
  });

  it("panne du DR derrière le switch : détectée après 40 s sans Hello, le BDR devient DR et un nouveau BDR est élu", () => {
    const sim = start(ospfLanScenario());
    settle(sim);
    command(sim, { type: "set-link", linkId: linkOf(ospfLanScenario(), "sw1", "r2"), up: false });
    settle(sim);
    // Les autres routeurs ne voient pas la coupure : le DR reste connu jusqu'à l'intervalle de mort.
    expect(iface(sim, "r1", "ge0")?.dr).toBe("10.2.0.1");
    const cutAt = sim.time;
    const toPc3 = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(toPc3()?.attempts[0]?.status).toBe("reply");
    const trace = advanceTo(sim, cutAt + fromSeconds(41));
    settle(sim);
    expect(find(trace, "ospf.neighbor-state", "r1").find((entry) => entry.params["neighbor"] === "10.2.0.1")?.params).toMatchObject({ to: "down", event: "inactivity" });
    expect(["r1", "r3", "r4"].map((id) => iface(sim, id, "ge0")?.state)).toEqual(["backup", "dr-other", "dr"]);
    expect(iface(sim, "r3", "ge0")).toMatchObject({ dr: "10.4.0.1", bdr: "10.1.0.1" });
    expect(lsdb(sim, "r3")?.find((lsa) => lsa.lsaType === "network" && lsa.advertisingRouter === "10.4.0.1")?.attachedRouters).toEqual(["10.1.0.1", "10.3.0.1", "10.4.0.1"]);
    expect(lsdb(sim, "r4")).toEqual(lsdb(sim, "r1"));
    expect(routeTo(sim, "r1", "10.3.0.0")).toMatchObject({ nextHop: "10.0.0.3", metric: 20 });
  });
});

describe("OSPF : déterminisme", () => {
  it("produit la même trace pour la même graine", () => {
    const run = () => {
      const sim = start(ospfLanScenario(), { seed: 7 });
      return settle(sim).map((entry) => [entry.time, entry.code, entry.deviceId, JSON.stringify(entry.params)]);
    };
    expect(run()).toEqual(run());
  });
});
