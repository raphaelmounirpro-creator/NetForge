import { disconnect, setInterfaceIpv4 } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { lanScenario, lanThreeScenario } from "./scenarios.js";
import { advanceTo, codes, command, find, ping, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";

describe("LAN : même sous-réseau, caches vides", () => {
  it("résout l'adresse par ARP puis échange l'écho ICMP", () => {
    const sim = start(lanScenario());
    const view = ping(sim, "pc1", "192.168.1.11");
    const trace = settle(sim);

    // Ordre des décisions significatives : ARP d'abord, ICMP ensuite.
    const keyEvents = trace
      .filter((entry) =>
        ["arp.request-sent", "arp.request-received", "arp.reply-sent", "arp.reply-received", "icmp.echo-request", "ping.reply"].includes(
          entry.code,
        ),
      )
      .map((entry) => `${entry.deviceId ?? ""}:${entry.code}`);
    expect(keyEvents).toEqual([
      "pc1:arp.request-sent",
      "pc2:arp.request-received",
      "pc2:arp.reply-sent",
      "pc1:arp.reply-received",
      "pc2:icmp.echo-request",
      "pc1:ping.reply",
    ]);

    // La requête ARP, diffusée, est inondée ; la réponse va directement à PC1 (adresse apprise).
    expect(find(trace, "switch.flood-broadcast", "sw1")).toHaveLength(1);
    expect(find(trace, "switch.forward", "sw1").length).toBeGreaterThanOrEqual(1);
    // PC2 a appris PC1 grâce à la requête : pas de nouvelle requête ARP pour répondre.
    expect(find(trace, "arp.request-sent", "pc2")).toHaveLength(0);
    expect(find(trace, "arp.cache-hit", "pc2")).toHaveLength(1);

    const result = view();
    expect(result?.done).toBe(true);
    expect(result?.attempts[0]).toMatchObject({ status: "reply", from: "192.168.1.11", ttl: 64 });
  });

  it("rend les tables observables après l'échange", () => {
    const sim = start(lanScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    const devices = new Map(sim.snapshot().devices.map((device) => [device.deviceId, device]));
    const macOf = (deviceId: string) => devices.get(deviceId)?.interfaces[0]?.mac;

    expect(devices.get("sw1")?.macTable.map((entry) => [entry.mac, entry.portId]).sort()).toEqual(
      [
        [macOf("pc1"), "ge1"],
        [macOf("pc2"), "ge2"],
      ].sort(),
    );
    expect(devices.get("pc1")?.arpCache).toEqual([
      expect.objectContaining({ ip: "192.168.1.11", mac: macOf("pc2"), portId: "eth0" }),
    ]);
    expect(devices.get("pc2")?.arpCache).toEqual([
      expect.objectContaining({ ip: "192.168.1.10", mac: macOf("pc1"), portId: "eth0" }),
    ]);
    expect(devices.get("pc1")?.routes).toEqual([
      expect.objectContaining({ kind: "connected", destination: "192.168.1.0", prefixLength: 24, active: true, portId: "eth0" }),
    ]);
  });

  it("mesure un aller-retour égal à la somme des délais modélisés", () => {
    const sim = start(lanScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    const view = ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    // Référence calculée à la main (paramètres par défaut) : trame ICMP de
    // 78 octets (14 + 20 + 8 + 32 + 4) + 20 octets de préambule et
    // d'intervalle à 1 Gb/s = 784 ns ; propagation 500 ns ; traitement
    // 10 µs par PC et 2 µs par switch. Deux sauts dans chaque sens.
    const oneWay = 10_000 + 2_000 + 2 * (784 + 500);
    expect(view()?.attempts[0]?.rtt).toBe(2 * oneWay);
  });
});

describe("LAN : caches ARP et MAC dans le temps virtuel", () => {
  it("réutilise l'entrée ARP pour un nouveau ping avant son expiration", () => {
    const sim = start(lanScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    advanceTo(sim, fromSeconds(30));
    ping(sim, "pc1", "192.168.1.11");
    const second = settle(sim);
    expect(find(second, "arp.request-sent")).toHaveLength(0);
    expect(find(second, "arp.cache-hit", "pc1")).toEqual([
      expect.objectContaining({ params: expect.objectContaining({ ip: "192.168.1.11" }) as unknown }),
    ]);
  });

  it("fait expirer l'entrée ARP puis la résout de nouveau", () => {
    const sim = start(lanScenario());
    ping(sim, "pc1", "192.168.1.11");
    const first = settle(sim);
    const learnedAt = find(first, "arp.entry-added", "pc1")[0]?.time ?? 0;
    // Durée de vie ARP d'un PC : 60 s, sans attente réelle.
    const expiry = advanceTo(sim, learnedAt + fromSeconds(60));
    expect(find(expiry, "arp.entry-expired", "pc1")).toEqual([expect.objectContaining({ time: learnedAt + fromSeconds(60) })]);
    expect(sim.snapshot().devices.find((device) => device.deviceId === "pc1")?.arpCache).toEqual([]);

    ping(sim, "pc1", "192.168.1.11");
    const again = settle(sim);
    expect(find(again, "arp.cache-miss", "pc1")).toHaveLength(1);
    expect(find(again, "arp.request-sent", "pc1")).toHaveLength(1);
  });

  it("fait vieillir la table MAC du switch après 300 s sans trafic", () => {
    const sim = start(lanScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    const trace = advanceTo(sim, fromSeconds(301));
    expect(find(trace, "switch.expire", "sw1")).toHaveLength(2);
    expect(sim.snapshot().devices.find((device) => device.deviceId === "sw1")?.macTable).toEqual([]);
  });

  it("inonde une trame vers une adresse MAC inconnue ; les autres cartes la filtrent", () => {
    // Table MAC plus courte que le cache ARP : PC1 connaît encore PC2, le switch l'a oublié.
    const sim = start(lanThreeScenario(), { parameters: { macAgingTime: fromSeconds(20) } });
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    advanceTo(sim, fromSeconds(30));
    ping(sim, "pc1", "192.168.1.11");
    const trace = settle(sim);
    expect(find(trace, "arp.cache-hit", "pc1")).toHaveLength(1);
    expect(find(trace, "switch.flood-unknown", "sw1")).toHaveLength(1);
    expect(find(trace, "nic.filtered", "pc3")).toHaveLength(1);
    expect(find(trace, "ping.reply", "pc1")).toHaveLength(1);
  });
});

describe("LAN : lien absent ou coupé", () => {
  it("n'émet rien vers un PC non câblé et abandonne après trois requêtes ARP", () => {
    const doc = disconnect(lanScenario(), { linkId: "l2" });
    if (!doc.ok) throw new Error("déconnexion attendue");
    const sim = start(doc.document);
    const view = ping(sim, "pc1", "192.168.1.11");
    const trace = settle(sim);
    expect(trace.some((entry) => entry.code === "eth.transmit" && entry.params["toDeviceId"] === "pc2")).toBe(false);
    expect(find(trace, "arp.request-sent", "pc1")).toHaveLength(3);
    expect(find(trace, "arp.failed", "pc1")).toHaveLength(1);
    expect(view()?.attempts[0]).toMatchObject({ status: "failed", failure: "host-unreachable" });
  });

  it("ne transmet plus aucune trame sur un lien coupé pendant la simulation", () => {
    const sim = start(lanScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    command(sim, { type: "set-link", linkId: "l2", up: false });
    const view = ping(sim, "pc1", "192.168.1.11");
    const trace = settle(sim);
    expect(find(trace, "command.link-down")).toHaveLength(1);
    // Le switch oublie l'adresse apprise sur le port tombé, puis inonde sans ce port.
    expect(find(trace, "switch.flush", "sw1")).toEqual([expect.objectContaining({ portId: "ge2", params: { count: 1 } })]);
    expect(trace.filter((entry) => entry.code === "eth.transmit" && entry.params["linkId"] === "l2")).toEqual([]);
    expect(view()?.attempts[0]?.status).toBe("timeout");
    expect(sim.snapshot().links.find((link) => link.linkId === "l2")?.up).toBe(false);
  });

  it("perd une trame déjà en transit au moment de la coupure", () => {
    const sim = start(lanScenario());
    ping(sim, "pc1", "192.168.1.11");
    // Avance jusqu'à ce que la requête ARP soit en route vers PC2 (après le switch).
    let lost = false;
    for (let index = 0; index < 50 && !lost; index += 1) {
      const step = sim.step().trace;
      if (step.some((entry) => entry.code === "eth.transmit" && entry.params["linkId"] === "l2")) {
        command(sim, { type: "set-link", linkId: "l2", up: false });
        const rest = settle(sim);
        lost = find(rest, "eth.lost-in-transit", "pc2").length === 1;
      }
    }
    expect(lost).toBe(true);
  });

  it("rétablit le lien et le trafic", () => {
    const sim = start(lanScenario());
    command(sim, { type: "set-link", linkId: "l2", up: false });
    settle(sim);
    command(sim, { type: "set-link", linkId: "l2", up: true });
    const view = ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    expect(view()?.attempts[0]?.status).toBe("reply");
  });
});

describe("Ping local", () => {
  it("répond à 127.0.0.1 et à sa propre adresse sans émettre de trame", () => {
    const sim = start(lanScenario());
    const loopback = ping(sim, "pc1", "127.0.0.1");
    const own = ping(sim, "pc1", "192.168.1.10");
    const trace = settle(sim);
    expect(codes(trace)).not.toContain("eth.transmit");
    expect(loopback()?.attempts[0]).toMatchObject({ status: "reply", from: "127.0.0.1" });
    expect(own()?.attempts[0]).toMatchObject({ status: "reply", from: "192.168.1.10" });
  });

  it("échoue immédiatement, sans émettre, sur un PC sans adresse", () => {
    const cleared = setInterfaceIpv4(lanScenario(), { deviceId: "pc1", portId: "eth0", ipv4: null });
    if (!cleared.ok) throw new Error("modification attendue");
    const sim = start(cleared.document);
    const view = ping(sim, "pc1", "192.168.1.11");
    const trace = settle(sim);
    expect(codes(trace)).not.toContain("eth.transmit");
    expect(find(trace, "ip.no-route", "pc1")[0]?.params).toMatchObject({ reason: "no-address" });
    expect(view()?.attempts[0]).toMatchObject({ status: "failed", failure: "no-address" });
  });
});
