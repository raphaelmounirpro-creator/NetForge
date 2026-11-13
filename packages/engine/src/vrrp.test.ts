import type { NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { frameBytes, type EthernetFrame, type VrrpAdvertisement } from "./pdu.js";
import { vrrpScenario } from "./scenarios.js";
import type { Simulation } from "./simulation.js";
import { advanceTo, command, find, ping, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { TraceEntry } from "./trace.js";

const VIRTUAL_MAC = "00:00:5e:00:01:01";
const group = (sim: Simulation, id: string) => sim.snapshot().devices.find((device) => device.deviceId === id)?.vrrp?.[0];
const macPort = (sim: Simulation, mac: string) => sim.snapshot().devices.find((device) => device.deviceId === "sw1")?.macTable.find((entry) => entry.mac === mac)?.portId;

function linkOf(doc: NfgDocument, a: string, b: string): string {
  const link = doc.topology.links.find((item) => item.endpoints.some((end) => end.deviceId === a) && item.endpoints.some((end) => end.deviceId === b));
  if (!link) throw new Error(`aucun câble ${a}–${b}`);
  return link.id;
}

/** Annonces VRRP telles qu'émises sur les câbles. */
function advertsOnWire(trace: readonly TraceEntry[]): Array<{ deviceId: string | null; frame: EthernetFrame; advert: VrrpAdvertisement; ttl: number; source: string; destination: string }> {
  return find(trace, "eth.transmit").flatMap((entry) => {
    const frame = entry.pdu;
    if (frame?.kind !== "ethernet" || frame.payload.kind !== "ipv4" || frame.payload.payload.kind !== "vrrp") return [];
    return [{ deviceId: entry.deviceId, frame, advert: frame.payload.payload, ttl: frame.payload.ttl, source: frame.payload.source, destination: frame.payload.destination }];
  });
}

/** Ping depuis PC1 vers PC2, calculé jusqu'au bout ; renvoie la tentative. */
function pingPc2(sim: Simulation) {
  const result = ping(sim, "pc1", "10.3.0.10");
  settle(sim);
  return result()?.attempts[0];
}

describe("VRRP : élection du maître", () => {
  it("élit le routeur le plus prioritaire après Master_Down_Interval ; annonces conformes et MAC virtuelle apprise", () => {
    const sim = start(vrrpScenario());
    const trace = settle(sim);
    expect([group(sim, "r1")?.state, group(sim, "r2")?.state]).toEqual(["master", "backup"]);
    // Skew_Time de R1 = (256 − 110) / 256 s : maître à 3,5703125 s (RFC 5798 §6.1).
    const elected = find(trace, "vrrp.state", "r1").find((entry) => entry.params["to"] === "master");
    expect(elected?.time).toBe(3 * 1e9 + Math.round((146 * 1e9) / 256));
    expect(elected?.params["cause"]).toBe("master-down");
    const advert = advertsOnWire(trace).find((item) => item.deviceId === "r1");
    expect(advert).toMatchObject({ ttl: 255, source: "192.168.1.2", destination: "224.0.0.18", frame: { source: VIRTUAL_MAC, destination: "01:00:5e:00:00:12" } });
    expect(advert?.advert).toEqual({ kind: "vrrp", version: 3, type: "advertisement", vrid: 1, priority: 110, maxAdverInterval: 100, addresses: ["192.168.1.1"] });
    // Trame : 14 + 20 (IPv4) + 8 + 4 (une adresse) + 4 (FCS), complétée à 64 octets.
    expect(advert && frameBytes(advert.frame)).toBe(64);
    expect(find(trace, "vrrp.gratuitous-arp", "r1")).toHaveLength(1);
    // Le switch situe la MAC virtuelle sur le port de R1 ; R2 accepte les annonces (110 ≥ 100).
    expect(macPort(sim, VIRTUAL_MAC)).toBe("ge2");
    expect(group(sim, "r2")).toMatchObject({ master: "192.168.1.2", virtualMac: VIRTUAL_MAC, priority: 100 });
  });

  it("répond à l'ARP de l'adresse virtuelle avec la MAC virtuelle et route le trafic des postes par le maître", () => {
    const sim = start(vrrpScenario());
    settle(sim);
    const result = ping(sim, "pc1", "10.3.0.10");
    const trace = settle(sim);
    expect(result()?.attempts[0]).toMatchObject({ status: "reply", ttl: 62 });
    // Seul le maître répond pour l'adresse virtuelle ; le secours ignore la requête (RFC 5798 §6.4.2).
    expect(find(trace, "vrrp.arp-reply").map((entry) => [entry.deviceId, entry.params["mac"]])).toEqual([["r1", VIRTUAL_MAC]]);
    expect(find(trace, "arp.not-target", "r2").map((entry) => entry.params["targetIp"])).toContain("192.168.1.1");
    const pc1 = sim.snapshot().devices.find((device) => device.deviceId === "pc1");
    expect(pc1?.arpCache.find((entry) => entry.ip === "192.168.1.1")?.mac).toBe(VIRTUAL_MAC);
  });

  it("donne la main aussitôt au propriétaire de l'adresse virtuelle (priorité 255)", () => {
    const sim = start(vrrpScenario({ owner: true }));
    const trace = settle(sim);
    expect(group(sim, "r1")).toMatchObject({ state: "master", owner: true, priority: 255 });
    expect(find(trace, "vrrp.state", "r1")[0]).toMatchObject({ time: 0, params: { from: "initialize", to: "master", cause: "owner" } });
  });

  it("refuse les paquets adressés à l'adresse virtuelle quand le maître n'en est pas propriétaire (Accept_Mode faux)", () => {
    const sim = start(vrrpScenario());
    settle(sim);
    const toVirtual = ping(sim, "pc1", "192.168.1.1");
    const trace = settle(sim);
    expect(find(trace, "vrrp.not-accepted", "r1")[0]?.params).toMatchObject({ vrid: 1, address: "192.168.1.1", state: "master" });
    expect(toVirtual()?.attempts[0]?.status).toBe("timeout");
    // Propriétaire : l'adresse virtuelle est la sienne, il répond.
    const owner = start(vrrpScenario({ owner: true }));
    settle(owner);
    const reply = ping(owner, "pc1", "192.168.1.1");
    settle(owner);
    expect(reply()?.attempts[0]?.status).toBe("reply");
  });
});

describe("VRRP : bascule et retour", () => {
  it("bascule sur R2 quand R1 tombe : détection après Master_Down_Interval, ARP gratuit, le poste garde sa passerelle", () => {
    const doc = vrrpScenario();
    const sim = start(doc);
    const before = [...settle(sim)];
    before.push(...find(advanceTo(sim, sim.time), "vrrp.advert-received"));
    command(sim, { type: "set-link", linkId: linkOf(doc, "sw1", "r1"), up: false });
    settle(sim);
    expect([group(sim, "r1")?.state, group(sim, "r2")?.state]).toEqual(["initialize", "backup"]);
    const failover = advanceTo(sim, sim.time + fromSeconds(5));
    const promoted = find(failover, "vrrp.state", "r2").find((entry) => entry.params["to"] === "master");
    expect(promoted?.params["cause"]).toBe("master-down");
    // R2 (priorité 100) : 3 s + (256 − 100) / 256 s après la dernière annonce reçue de R1 (Master_Down_Interval).
    const lastReceived = Math.max(...find(before, "vrrp.advert-received", "r2").map((entry) => entry.time));
    expect(promoted && promoted.time - lastReceived).toBe(3 * 1e9 + Math.round((156 * 1e9) / 256));
    expect(find(failover, "vrrp.gratuitous-arp", "r2")).toHaveLength(1);
    expect(macPort(sim, VIRTUAL_MAC)).toBe("ge3");
    // Même passerelle, même MAC virtuelle dans le cache du poste : le trafic passe par R2.
    settle(sim);
    expect(pingPc2(sim)).toMatchObject({ status: "reply", ttl: 62 });
    const pc1 = sim.snapshot().devices.find((device) => device.deviceId === "pc1");
    expect(pc1?.arpCache.find((entry) => entry.ip === "192.168.1.1")?.mac).toBe(VIRTUAL_MAC);
  });

  it("rend la main à R1 à son retour grâce à la préemption, et pas sans elle", () => {
    for (const preempt of [true, false]) {
      const doc = vrrpScenario({ r1Preempt: preempt });
      const sim = start(doc);
      settle(sim);
      const linkId = linkOf(doc, "sw1", "r1");
      command(sim, { type: "set-link", linkId, up: false });
      settle(sim);
      advanceTo(sim, sim.time + fromSeconds(5));
      expect(group(sim, "r2")?.state).toBe("master");
      command(sim, { type: "set-link", linkId, up: true });
      const back = settle(sim);
      if (preempt) {
        // Au retour, R1 (secours, 110) écarte les annonces de R2 (100) puis se proclame maître à son échéance.
        expect(find(back, "vrrp.advert-discarded", "r1").length).toBeGreaterThan(0);
        expect([group(sim, "r1")?.state, group(sim, "r2")?.state]).toEqual(["master", "backup"]);
        expect(find(back, "vrrp.state", "r2").map((entry) => entry.params["cause"])).toContain("higher-priority");
        expect(macPort(sim, VIRTUAL_MAC)).toBe("ge2");
      } else {
        advanceTo(sim, sim.time + fromSeconds(10));
        expect([group(sim, "r1")?.state, group(sim, "r2")?.state]).toEqual(["backup", "master"]);
      }
    }
  });

  it("produit la même trace pour la même graine", () => {
    const run = () => {
      const sim = start(vrrpScenario(), { seed: 3 });
      return settle(sim).map((entry) => [entry.time, entry.code, entry.deviceId, JSON.stringify(entry.params)]);
    };
    expect(run()).toEqual(run());
  });
});
