import { addDevice, connectPorts, setDefaultGateway, setInterfaceIpv4, setSwitchport, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { frameBytes, type EthernetFrame } from "./pdu.js";
import { VLAN_SCENARIO, vlanScenario } from "./scenarios.js";
import { createSimulation } from "./simulation.js";
import type { TraceEntry } from "./trace.js";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

/** Ping de deux échos jusqu'à la fin des échanges : trace complète et résultat. */
function ping(doc: NfgDocument, from: string, to: string) {
  const created = createSimulation(doc);
  if (!created.ok) throw new Error(created.issues.map((issue) => issue.code).join(", "));
  const sim = created.simulation;
  const outcome = sim.enqueue({ type: "ping", deviceId: from, destination: to, count: 2 });
  if (!outcome.ok) throw new Error(outcome.code);
  const trace: TraceEntry[] = [];
  for (let slice = 0; slice < 50; slice += 1) {
    const result = sim.run({ stopWhenIdle: true, maxEvents: 10_000 });
    trace.push(...result.trace);
    if (result.stop !== "budget") break;
  }
  const snapshot = sim.snapshot();
  const view = snapshot.pings.find((item) => item.id === outcome.sessionId);
  const replies = view?.attempts.filter((attempt) => attempt.status === "reply").length ?? 0;
  return { trace, snapshot, replies, sent: view?.attempts.length ?? 0 };
}

/** Trames réellement émises sur un lien, telles qu'elles circulent sur le câble. */
const onLink = (trace: readonly TraceEntry[], linkId: string) =>
  trace.filter((entry) => entry.code === "eth.transmit" && entry.params["linkId"] === linkId).map((entry) => entry.pdu as EthernetFrame);

const codes = (trace: readonly TraceEntry[]) => new Set(trace.map((entry) => entry.code));

describe("VLAN 802.1Q", () => {
  it("relient deux postes du même VLAN à travers un trunk, trames étiquetées sur le trunk seulement", () => {
    const run = ping(vlanScenario(), "pc1", VLAN_SCENARIO.pc3);
    expect([run.replies, run.sent]).toEqual([2, 2]);
    const trunk = onLink(run.trace, "l5");
    expect(trunk.length).toBeGreaterThan(0);
    expect(trunk.every((frame) => frame.vlan === 10)).toBe(true);
    // Lien d'accès vers PC1 : trames sans étiquette.
    expect(onLink(run.trace, "l1").every((frame) => frame.vlan === undefined)).toBe(true);
  });

  it("isolent deux VLAN même quand les postes partagent le réseau IP : l'ARP reste dans son VLAN", () => {
    const run = ping(vlanScenario(), "pc4", VLAN_SCENARIO.pc1);
    expect(run.replies).toBe(0);
    // PC1 ne reçoit jamais la requête ARP de PC4 ; aucune trame du VLAN 20 ne sort vers le VLAN 10.
    expect(run.trace.some((entry) => entry.deviceId === "pc1" && entry.code === "arp.request-received")).toBe(false);
    expect(run.trace.filter((entry) => entry.code === "switch.flood-broadcast").every((entry) => entry.params["vlan"] === 20)).toBe(true);
  });

  it("routent entre VLAN par les sous-interfaces d'un routeur (« router-on-a-stick »)", () => {
    const run = ping(vlanScenario(), "pc1", VLAN_SCENARIO.pc2);
    expect([run.replies, run.sent]).toEqual([2, 2]);
    const toRouter = onLink(run.trace, "l6");
    expect(new Set(toRouter.map((frame) => frame.vlan))).toEqual(new Set([10, 20]));
    const received = run.trace.filter((entry) => entry.deviceId === "r1" && entry.code === "ip.forward").map((entry) => entry.portId);
    expect(received.length).toBeGreaterThan(0);
    expect(received.every((port) => port === "ge0.10" || port === "ge0.20")).toBe(true);
  });

  it("tiennent une table MAC par VLAN : la même adresse peut figurer dans deux VLAN", () => {
    const run = ping(vlanScenario(), "pc1", VLAN_SCENARIO.pc2);
    const sw1 = run.snapshot.devices.find((device) => device.deviceId === "sw1");
    const r1 = run.snapshot.devices.find((device) => device.deviceId === "r1");
    const routerMac = r1?.interfaces.find((port) => port.portId === "ge0")?.mac;
    const routerEntries = sw1?.macTable.filter((entry) => entry.mac === routerMac).map((entry) => [entry.vlan, entry.portId]);
    expect(routerEntries).toEqual([
      [10, "ge23"],
      [20, "ge23"],
    ]);
    expect(run.trace.some((entry) => entry.code === "switch.move")).toBe(false);
    expect(r1?.interfaces.filter((port) => port.vlan !== null).map((port) => [port.portId, port.vlan, port.ipv4])).toEqual([
      ["ge0.10", 10, "192.168.10.1/24"],
      ["ge0.20", 20, "192.168.20.1/24"],
    ]);
  });

  it("transportent le VLAN natif sans étiquette sur un trunk", () => {
    let doc = vlanScenario();
    for (const id of ["sw1", "sw2"]) doc = ok(setSwitchport(doc, { deviceId: id, portId: "ge24", switchport: { mode: "trunk", nativeVlan: 10, allowedVlans: [10, 20] } }));
    const run = ping(doc, "pc1", VLAN_SCENARIO.pc3);
    expect(run.replies).toBe(2);
    expect(onLink(run.trace, "l5").every((frame) => frame.vlan === undefined)).toBe(true);
  });

  it("refusent un VLAN non autorisé sur un trunk, avec une décision explicite", () => {
    const doc = ok(setSwitchport(vlanScenario({ trunkAllowed: "all" }), { deviceId: "sw2", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: [20] } }));
    const run = ping(doc, "pc1", VLAN_SCENARIO.pc3);
    expect(run.replies).toBe(0);
    const refused = run.trace.find((entry) => entry.code === "vlan.not-allowed");
    expect(refused).toMatchObject({ deviceId: "sw2", portId: "ge24", params: { vlan: 10, tagged: true } });
  });

  it("refusent une trame étiquetée sur un port d'accès, et un poste ne lit pas une trame étiquetée", () => {
    // Sous-interfaces du routeur reliées à un port d'accès (erreur de câblage classique) : PC5, derrière
    // un autre port du routeur, vise PC1 ; la requête ARP du routeur part étiquetée par ge0.10.
    let onAccess = ok(setSwitchport(vlanScenario(), { deviceId: "sw1", portId: "ge23", switchport: { mode: "access", vlan: 10 } }));
    onAccess = ok(addDevice(onAccess, { id: "pc5", model: "PC", name: "PC5", position: { x: 0, y: 0 } }));
    onAccess = ok(connectPorts(onAccess, { linkId: "l9", a: { deviceId: "pc5", portId: "eth0" }, b: { deviceId: "r1", portId: "ge1" } }));
    onAccess = ok(setInterfaceIpv4(onAccess, { deviceId: "r1", portId: "ge1", ipv4: { address: "192.168.50.1", prefixLength: 24 } }));
    onAccess = ok(setInterfaceIpv4(onAccess, { deviceId: "pc5", portId: "eth0", ipv4: { address: "192.168.50.10", prefixLength: 24 } }));
    onAccess = ok(setDefaultGateway(onAccess, { deviceId: "pc5", gateway: "192.168.50.1" }));
    const fromRouter = ping(onAccess, "pc5", VLAN_SCENARIO.pc1);
    expect(fromRouter.replies).toBe(0);
    expect(fromRouter.trace.find((entry) => entry.code === "vlan.tagged-dropped")).toMatchObject({ deviceId: "sw1", portId: "ge23", params: { accessVlan: 10 } });
    // PC3 relié à un port en trunk : les trames du VLAN 10 lui arrivent étiquetées.
    const pcOnTrunk = ok(setSwitchport(vlanScenario(), { deviceId: "sw2", portId: "ge1", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: [10] } }));
    const toPc = ping(pcOnTrunk, "pc1", VLAN_SCENARIO.pc3);
    expect(toPc.replies).toBe(0);
    expect(toPc.trace.find((entry) => entry.code === "nic.tagged-dropped")).toMatchObject({ deviceId: "pc3", params: { vlan: 10 } });
  });

  it("refusent au routeur une trame d'un VLAN sans sous-interface", () => {
    const doc = ok(setSwitchport(vlanScenario(), { deviceId: "sw1", portId: "ge23", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: "all" } }));
    const moved = ok(setSwitchport(doc, { deviceId: "sw1", portId: "ge2", switchport: { mode: "access", vlan: 30 } }));
    const run = ping(moved, "pc2", "192.168.20.1");
    expect(run.replies).toBe(0);
    expect(run.trace.find((entry) => entry.code === "vlan.no-subinterface")).toMatchObject({ deviceId: "r1", portId: "ge0", params: { vlan: 30 } });
    expect(codes(run.trace).has("arp.request-received")).toBe(false);
  });

  it("comptent les 4 octets de l'étiquette dans la taille d'une trame", () => {
    const frame: EthernetFrame = {
      kind: "ethernet",
      source: "02:00:00:00:00:01",
      destination: "02:00:00:00:00:02",
      payload: { kind: "ipv4", source: "10.0.0.1", destination: "10.0.0.2", ttl: 64, identification: 1, payload: { kind: "icmp", type: "echo-request", identifier: 1, sequence: 1, dataLength: 100 } },
    };
    expect(frameBytes({ ...frame, vlan: 10 }) - frameBytes(frame)).toBe(4);
  });
});
