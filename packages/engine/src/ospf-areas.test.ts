import type { NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { ospfAreasScenario } from "./scenarios.js";
import type { Simulation } from "./simulation.js";
import { command, find, ping, settle, start } from "./test-support/helpers.js";

const ospfOf = (sim: Simulation, id: string) => sim.snapshot().devices.find((device) => device.deviceId === id)?.ospf;
/** Base d'une zone sans l'âge (dépend de l'instant d'installation). */
const lsdb = (sim: Simulation, id: string, area: string) => ospfOf(sim, id)?.lsdb.filter((lsa) => lsa.area === area).map(({ age: _age, ...lsa }) => lsa);
const routeTo = (sim: Simulation, id: string, destination: string) => sim.snapshot().devices.find((device) => device.deviceId === id)?.routes.find((route) => route.destination === destination);

function linkOf(doc: NfgDocument, a: string, b: string): string {
  const link = doc.topology.links.find((item) => item.endpoints.some((end) => end.deviceId === a) && item.endpoints.some((end) => end.deviceId === b));
  if (!link) throw new Error(`aucun câble ${a}–${b}`);
  return link.id;
}

describe("OSPF : zones multiples", () => {
  it("donne à chaque routeur interne la seule base de sa zone, et aux routeurs de bordure une base par zone", () => {
    const sim = start(ospfAreasScenario());
    settle(sim);
    expect([ospfOf(sim, "r1")?.abr, ospfOf(sim, "r2")?.abr, ospfOf(sim, "r3")?.abr, ospfOf(sim, "r4")?.abr]).toEqual([false, true, true, false]);
    expect(ospfOf(sim, "r1")?.areas).toEqual(["0.0.0.1"]);
    expect(ospfOf(sim, "r2")?.areas).toEqual(["0.0.0.0", "0.0.0.1"]);
    // Base de la zone 1 identique chez R1 et R2 ; R1 ne voit ni R3 ni R4.
    expect(lsdb(sim, "r2", "0.0.0.1")).toEqual(lsdb(sim, "r1", "0.0.0.1"));
    expect(lsdb(sim, "r3", "0.0.0.0")).toEqual(lsdb(sim, "r2", "0.0.0.0"));
    expect(lsdb(sim, "r4", "0.0.0.2")).toEqual(lsdb(sim, "r3", "0.0.0.2"));
    const area1 = lsdb(sim, "r1", "0.0.0.1") ?? [];
    expect(area1.filter((lsa) => lsa.lsaType === "router").map((lsa) => [lsa.advertisingRouter, lsa.abr])).toEqual([
      ["10.12.0.1", false],
      ["10.23.0.1", true],
    ]);
    // Résumés de R2 dans la zone 1 : coût de la route chez R2 (intra-dorsale, puis inter-zones venues de la dorsale).
    expect(area1.filter((lsa) => lsa.lsaType === "summary").map((lsa) => [lsa.lsId, lsa.mask, lsa.metric, lsa.advertisingRouter])).toEqual([
      ["10.3.0.0", "255.255.255.0", 20, "10.23.0.1"],
      ["10.4.0.0", "255.255.255.0", 30, "10.23.0.1"],
      ["10.23.0.0", "255.255.255.252", 10, "10.23.0.1"],
      ["10.34.0.0", "255.255.255.252", 20, "10.23.0.1"],
    ]);
    // Jamais de résumé d'une route dans sa propre zone : R2 n'annonce pas 10.12.0.0/30 ni 10.1.0.0/24 dans la zone 1.
    expect(area1.some((lsa) => lsa.lsaType === "summary" && (lsa.lsId === "10.12.0.0" || lsa.lsId === "10.1.0.0"))).toBe(false);
    // Dorsale : les routes inter-zones n'y sont pas résumées, seulement les réseaux intra-zone des autres zones.
    const backbone = lsdb(sim, "r2", "0.0.0.0") ?? [];
    expect(backbone.filter((lsa) => lsa.lsaType === "summary").map((lsa) => [lsa.lsId, lsa.metric, lsa.advertisingRouter])).toEqual([
      ["10.1.0.0", 20, "10.23.0.1"],
      ["10.4.0.0", 20, "10.34.0.1"],
      ["10.12.0.0", 10, "10.23.0.1"],
      ["10.34.0.0", 10, "10.34.0.1"],
    ]);
  });

  it("route d'une zone à l'autre par les résumés : coût jusqu'au routeur de bordure + coût annoncé", () => {
    const sim = start(ospfAreasScenario());
    settle(sim);
    expect(routeTo(sim, "r1", "10.4.0.0")).toMatchObject({ kind: "ospf-inter", nextHop: "10.12.0.2", metric: 40 });
    expect(routeTo(sim, "r1", "10.12.0.0")).toMatchObject({ kind: "connected" });
    expect(routeTo(sim, "r3", "10.1.0.0")).toMatchObject({ kind: "ospf-inter", nextHop: "10.23.0.1", metric: 30 });
    // L'intra-zone l'emporte : R2 joint 10.3.0.0/24 par la dorsale (intra), sans tenir compte d'un résumé.
    expect(routeTo(sim, "r2", "10.3.0.0")).toMatchObject({ kind: "ospf", metric: 20 });
    const toPc4 = ping(sim, "pc1", "10.4.0.10");
    const trace = settle(sim);
    // Quatre routeurs traversés : TTL 64 − 4.
    expect(toPc4()?.attempts[0]).toMatchObject({ status: "reply", ttl: 60 });
    expect(find(trace, "ospf.route-added", "r1")).toEqual([]);
  });

  it("retire les résumés d'une zone devenue injoignable, de proche en proche", () => {
    const doc = ospfAreasScenario();
    const sim = start(doc);
    settle(sim);
    command(sim, { type: "set-link", linkId: linkOf(doc, "r3", "r4"), up: false });
    const trace = settle(sim);
    expect(find(trace, "ospf.lsa-flushed", "r3").map((entry) => [entry.params["lsaType"], entry.params["lsId"], entry.params["area"]])).toEqual(
      expect.arrayContaining([["summary", "10.4.0.0", "0.0.0.0"], ["summary", "10.34.0.0", "0.0.0.0"]]),
    );
    expect(find(trace, "ospf.lsa-flushed", "r2").map((entry) => [entry.params["lsId"], entry.params["area"]])).toEqual(
      expect.arrayContaining([["10.4.0.0", "0.0.0.1"], ["10.34.0.0", "0.0.0.1"]]),
    );
    expect(find(trace, "ospf.route-removed", "r1").map((entry) => [entry.params["route"], entry.params["inter"]])).toEqual(
      expect.arrayContaining([["10.4.0.0/24", true], ["10.34.0.0/30", true]]),
    );
    expect(routeTo(sim, "r1", "10.4.0.0")).toBeUndefined();
    expect(lsdb(sim, "r2", "0.0.0.1")).toEqual(lsdb(sim, "r1", "0.0.0.1"));
  });

  it("rejette les Hello d'une autre zone sur un même lien : aucun voisinage", () => {
    const doc = ospfAreasScenario();
    const r2 = doc.configurations["r2"];
    if (!r2) throw new Error("configuration attendue");
    const ge1 = r2.ospfInterfaces["ge1"];
    if (!ge1) throw new Error("interface attendue");
    const wrong: NfgDocument = { ...doc, configurations: { ...doc.configurations, r2: { ...r2, ospfInterfaces: { ...r2.ospfInterfaces, ge1: { ...ge1, area: "0.0.0.0" } } } } };
    const sim = start(wrong);
    const trace = settle(sim);
    expect(find(trace, "ospf.ignored", "r1").map((entry) => [entry.params["reason"], entry.params["area"]])).toContainEqual(["area", "0.0.0.0"]);
    expect(ospfOf(sim, "r1")?.interfaces.find((item) => item.portId === "ge1")?.neighbors).toEqual([]);
  });
});
