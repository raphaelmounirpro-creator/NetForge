import type { NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { frameBytes, type BgpMessage, type EthernetFrame, type TcpSegment } from "./pdu.js";
import { bgpScenario, ScenarioBuilder } from "./scenarios.js";
import type { Simulation } from "./simulation.js";
import { advanceTo, command, find, ping, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { TraceEntry } from "./trace.js";

const bgpOf = (sim: Simulation, id: string) => sim.snapshot().devices.find((device) => device.deviceId === id)?.bgp;
const peer = (sim: Simulation, id: string, address: string) => bgpOf(sim, id)?.peers.find((item) => item.address === address);
const best = (sim: Simulation, id: string, network: string) => bgpOf(sim, id)?.table.find((route) => route.network === network && route.best);

function linkOf(doc: NfgDocument, a: string, b: string): string {
  const link = doc.topology.links.find((item) => item.endpoints.some((end) => end.deviceId === a) && item.endpoints.some((end) => end.deviceId === b));
  if (!link) throw new Error(`aucun câble ${a}–${b}`);
  return link.id;
}

/** Segments TCP tels qu'émis sur les câbles. */
function tcpOnWire(trace: readonly TraceEntry[]): Array<{ deviceId: string | null; frame: EthernetFrame; tcp: TcpSegment; ttl: number; destination: string }> {
  return find(trace, "eth.transmit").flatMap((entry) => {
    const frame = entry.pdu;
    if (frame?.kind !== "ethernet" || frame.payload.kind !== "ipv4" || frame.payload.payload.kind !== "tcp") return [];
    return [{ deviceId: entry.deviceId, frame, tcp: frame.payload.payload, ttl: frame.payload.ttl, destination: frame.payload.destination }];
  });
}

const messageOf = (tcp: TcpSegment, type: BgpMessage["type"]) => tcp.payload?.type === type;

describe("BGP : sessions entre systèmes autonomes", () => {
  it("établit les sessions : TCP vers le port 179 ouvert par l'adresse la plus grande, OPEN, KEEPALIVE, Established", () => {
    const sim = start(bgpScenario());
    const trace = settle(sim);
    for (const [id, address] of [["r1", "10.12.0.2"], ["r1", "10.13.0.2"], ["r2", "10.23.0.2"]] as const) expect(peer(sim, id, address)?.state).toBe("established");
    // R2 (10.12.0.2) ouvre vers R1, R3 vers R1 et vers R2 (voisins dans l'ordre des adresses) ; SYN vers le port 179, TTL 1.
    expect(find(trace, "tcp.syn-sent").map((entry) => [entry.deviceId, entry.params["peer"]])).toEqual([
      ["r2", "10.12.0.1"],
      ["r3", "10.13.0.1"],
      ["r3", "10.23.0.1"],
    ]);
    const wire = tcpOnWire(trace);
    const syn = wire.find((item) => item.tcp.flags.syn && !item.tcp.flags.ack);
    expect(syn).toMatchObject({ ttl: 1, tcp: { destinationPort: 179 } });
    expect(syn?.tcp.sourcePort).toBeGreaterThanOrEqual(49152);
    // OPEN : version 4, AS, Hold Time 90 s, identifiant BGP ; trame 14 + 20 + 20 (TCP) + 29 (OPEN) + 4.
    const open = wire.find((item) => item.deviceId === "r1" && messageOf(item.tcp, "open"));
    expect(open?.tcp.payload).toEqual({ kind: "bgp", type: "open", version: 4, myAs: 65001, holdTime: 90, bgpId: "10.13.0.1" });
    expect(open && frameBytes(open.frame)).toBe(14 + 20 + 20 + 29 + 4);
    // KEEPALIVE : en-tête BGP seul (19 octets) ; trame 14 + 20 + 20 + 19 + 4.
    const keepalive = wire.find((item) => messageOf(item.tcp, "keepalive"));
    expect(keepalive && frameBytes(keepalive.frame)).toBe(14 + 20 + 20 + 19 + 4);
    expect(find(trace, "bgp.state", "r1").filter((entry) => entry.params["peer"] === "10.12.0.2").map((entry) => entry.params["to"])).toEqual(["active", "opensent", "openconfirm", "established"]);
  });

  it("annonce les réseaux avec AS_PATH et NEXT_HOP, rejette les chemins bouclés et retient le plus court", () => {
    const sim = start(bgpScenario());
    const trace = settle(sim);
    const update = tcpOnWire(trace).find((item) => item.deviceId === "r3" && item.tcp.payload?.type === "update" && item.tcp.payload.nlri.some((prefix) => prefix.address === "10.3.0.0"));
    const attributes = update?.tcp.payload?.type === "update" ? update.tcp.payload.attributes : undefined;
    expect(attributes && [attributes.origin, attributes.asPath]).toEqual(["igp", [65003]]);
    expect(["10.13.0.2", "10.23.0.2"]).toContain(attributes?.nextHop);
    // R3 reçoit son propre réseau par R1 (65001 65003) : boucle d'AS, chemin exclu.
    expect(find(trace, "bgp.loop-rejected", "r3").map((entry) => [entry.params["network"], entry.params["asPath"]])).toContainEqual(["10.3.0.0/24", "65001 65003"]);
    expect(best(sim, "r1", "10.3.0.0/24")).toMatchObject({ asPath: [65003], nextHop: "10.13.0.2", from: "10.13.0.2" });
    expect(bgpOf(sim, "r1")?.table.filter((route) => route.network === "10.3.0.0/24").map((route) => [route.asPath.join(" "), route.best])).toEqual([
      ["65003", true],
      ["65002 65003", false],
    ]);
    const route = sim.snapshot().devices.find((device) => device.deviceId === "r1")?.routes.find((item) => item.destination === "10.3.0.0");
    expect(route).toMatchObject({ kind: "bgp", nextHop: "10.13.0.2", portId: "ge2", metric: 1, active: true });
    const toPc3 = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(toPc3()?.attempts[0]).toMatchObject({ status: "reply", ttl: 62 });
  });

  it("bascule sur le détour par un autre AS quand le lien direct tombe, puis revient au chemin court", () => {
    const doc = bgpScenario();
    const sim = start(doc);
    settle(sim);
    const linkId = linkOf(doc, "r1", "r3");
    command(sim, { type: "set-link", linkId, up: false });
    const cut = settle(sim);
    expect(find(cut, "bgp.state", "r1").map((entry) => [entry.params["peer"], entry.params["to"], entry.params["event"]])).toEqual([["10.13.0.2", "idle", "interface-down"]]);
    expect(best(sim, "r1", "10.3.0.0/24")).toMatchObject({ asPath: [65002, 65003], nextHop: "10.12.0.2" });
    const detour = ping(sim, "pc1", "10.3.0.10");
    settle(sim);
    expect(detour()?.attempts[0]).toMatchObject({ status: "reply", ttl: 61 });
    command(sim, { type: "set-link", linkId, up: true });
    settle(sim);
    expect(peer(sim, "r1", "10.13.0.2")?.state).toBe("established");
    expect(best(sim, "r1", "10.3.0.0/24")).toMatchObject({ asPath: [65003], nextHop: "10.13.0.2" });
  });

  it("refuse un voisin d'un autre AS que prévu (NOTIFICATION) et un voisin non configuré (RST)", () => {
    const wrong = new ScenarioBuilder("bgp-as", "AS inattendu")
      .device("r1", "R-200", 0, 0).device("r2", "R-200", 200, 0)
      .link("r1", "ge0", "r2", "ge0").ip("r1", "ge0", "10.0.0.1/30").ip("r2", "ge0", "10.0.0.2/30")
      .bgp("r1", 65001, [["10.0.0.2", 65099]], []).bgp("r2", 65002, [["10.0.0.1", 65001]], [])
      .build();
    const sim = start(wrong);
    const trace = settle(sim);
    expect(find(trace, "bgp.notification-sent", "r1")[0]?.params).toMatchObject({ peer: "10.0.0.2", error: "bad-peer-as" });
    expect(find(trace, "bgp.notification-received", "r2")).toHaveLength(1);
    expect(peer(sim, "r1", "10.0.0.2")?.state).toBe("idle");
    const lonely = new ScenarioBuilder("bgp-rst", "Voisin non configuré")
      .device("r1", "R-200", 0, 0).device("r2", "R-200", 200, 0)
      .link("r1", "ge0", "r2", "ge0").ip("r1", "ge0", "10.0.0.1/30").ip("r2", "ge0", "10.0.0.2/30")
      .bgp("r2", 65002, [["10.0.0.1", 65001]], [])
      .build();
    const refused = start(lonely);
    const rst = settle(refused);
    expect(find(rst, "tcp.reset", "r1")[0]?.params).toMatchObject({ direction: "sent", reason: "no-listener" });
    expect(find(rst, "tcp.reset", "r2")[0]?.params).toMatchObject({ direction: "received" });
    // Nouvelle tentative après ConnectRetryTime (120 s).
    const retry = advanceTo(refused, fromSeconds(121));
    expect(find(retry, "tcp.syn-sent", "r2")).toHaveLength(1);
  });

  it("ferme la session à l'expiration du Hold Time quand le voisin se tait derrière un switch", () => {
    const doc = new ScenarioBuilder("bgp-hold", "Voisin derrière un switch")
      .device("r1", "R-200", 0, 0).device("sw1", "S-24", 200, 0).device("r2", "R-200", 400, 0)
      .link("r1", "ge0", "sw1", "ge1").link("sw1", "ge2", "r2", "ge0").ip("r1", "ge0", "10.0.0.1/24").ip("r2", "ge0", "10.0.0.2/24")
      .bgp("r1", 65001, [["10.0.0.2", 65002]], []).bgp("r2", 65002, [["10.0.0.1", 65001]], [])
      .build();
    const sim = start(doc);
    settle(sim);
    const established = sim.time;
    command(sim, { type: "set-link", linkId: linkOf(doc, "sw1", "r2"), up: false });
    settle(sim);
    // R1 ne voit pas la coupure : la session reste établie jusqu'à 90 s sans message.
    expect(peer(sim, "r1", "10.0.0.2")?.state).toBe("established");
    const trace = advanceTo(sim, established + fromSeconds(91));
    expect(find(trace, "bgp.keepalive-sent", "r1").length).toBeGreaterThanOrEqual(2);
    expect(find(trace, "bgp.notification-sent", "r1")[0]?.params).toMatchObject({ error: "hold-timer-expired" });
    expect(peer(sim, "r1", "10.0.0.2")?.state).toBe("idle");
  });

  it("sans BGP, aucun réseau distant n'est connu ; même trace pour la même graine", () => {
    const none = start(bgpScenario({ bgp: false }));
    settle(none);
    const lost = ping(none, "pc1", "10.3.0.10");
    settle(none);
    expect(lost()?.attempts[0]?.status).not.toBe("reply");
    const run = () => settle(start(bgpScenario(), { seed: 5 })).map((entry) => [entry.time, entry.code, entry.deviceId, JSON.stringify(entry.params)]);
    expect(run()).toEqual(run());
  });
});
