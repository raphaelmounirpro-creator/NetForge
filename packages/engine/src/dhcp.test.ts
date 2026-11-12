import { setDhcpPool, setInterfaceDhcp, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { dhcpScenario, ScenarioBuilder } from "./scenarios.js";
import { advanceTo, command, find, ping, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { Simulation } from "./simulation.js";

const client = (sim: Simulation, id = "pc1") => sim.snapshot().devices.find((d) => d.deviceId === id)?.dhcpClient;
const server = (sim: Simulation) => sim.snapshot().devices.find((d) => d.deviceId === "r1")?.dhcpServer;

describe("DHCP : attribution déterministe et échanges réels", () => {
  it("échange DORA, attribue deux adresses distinctes et route vers un réseau distant sans modifier le projet", () => {
    const doc = dhcpScenario();
    const original = JSON.stringify(doc);
    const sim = start(doc);
    const trace = settle(sim);
    expect(trace.filter((e) => e.deviceId === "pc1" && ["dhcp.discover-sent", "dhcp.offer-received", "dhcp.request-sent", "dhcp.bound"].includes(e.code)).map((e) => e.code))
      .toEqual(["dhcp.discover-sent", "dhcp.offer-received", "dhcp.request-sent", "dhcp.bound"]);
    expect(client(sim)).toMatchObject({ phase: "bound", lease: { address: "192.168.1.100", prefixLength: 24, gateway: "192.168.1.1", server: "192.168.1.1", leaseSeconds: 120 } });
    expect(client(sim, "pc2")?.lease?.address).toBe("192.168.1.101");
    expect(server(sim)?.leases.map((l) => [l.address, l.state])).toEqual([["192.168.1.100", "bound"], ["192.168.1.101", "bound"]]);
    const result = ping(sim, "pc1", "10.0.0.2");
    settle(sim);
    expect(result()?.attempts[0]?.status).toBe("reply");
    expect(JSON.stringify(doc)).toBe(original);
    expect(find(trace, "eth.transmit").some((e) => e.pdu?.kind === "ethernet" && e.pdu.payload.kind === "ipv4" && e.pdu.payload.source === "0.0.0.0" && e.pdu.payload.destination === "255.255.255.255")).toBe(true);
  });

  it("signale une plage épuisée, abandonne après quatre essais, puis réutilise un bail libéré", () => {
    const sim = start(dhcpScenario({ singleAddress: true }));
    const trace = settle(sim);
    expect(find(trace, "dhcp.pool-exhausted").length).toBeGreaterThan(0);
    expect(client(sim, "pc2")).toMatchObject({ phase: "failed", lease: null });
    command(sim, { type: "dhcp", deviceId: "pc1", action: "release" });
    settle(sim);
    expect(client(sim)?.phase).toBe("released");
    expect(server(sim)?.leases).toEqual([]);
    command(sim, { type: "dhcp", deviceId: "pc2", action: "renew" });
    settle(sim);
    expect(client(sim, "pc2")).toMatchObject({ phase: "bound", lease: { address: "192.168.1.100" } });
  });

  it("sans serveur, réessaie à 0, 4, 12 et 28 secondes puis abandonne à 60 secondes", () => {
    const sim = start(dhcpScenario({ noServer: true }));
    const trace = settle(sim);
    expect(find(trace, "dhcp.discover-sent", "pc1").map((e) => e.time)).toEqual([0, 4, 12, 28].map(fromSeconds));
    expect(find(trace, "dhcp.gave-up", "pc1")[0]?.time).toBe(fromSeconds(60));
    expect(client(sim)?.lease).toBeNull();
    expect(sim.snapshot().activity).toBe(false);
  });

  it("l'ancienne expiration d'une adresse libérée ne supprime pas un nouveau bail de cette adresse", () => {
    const sim = start(dhcpScenario());
    settle(sim);
    const original = client(sim)?.lease;
    if (!original) throw new Error("bail attendu");
    advanceTo(sim, fromSeconds(10));
    command(sim, { type: "dhcp", deviceId: "pc1", action: "release" });
    settle(sim);
    command(sim, { type: "dhcp", deviceId: "pc1", action: "renew" });
    settle(sim);
    const renewed = client(sim)?.lease;
    if (!renewed) throw new Error("nouveau bail attendu");
    command(sim, { type: "set-link", linkId: "l3", up: false });
    settle(sim);
    advanceTo(sim, original.expiresAt + 1);
    const retained = server(sim)?.leases.find((l) => l.address === original.address);
    expect(retained?.state).toBe("bound");
    expect(retained?.expiresAt).toBeGreaterThan(original.expiresAt);
    expect(client(sim)?.lease?.expiresAt).toBe(renewed.expiresAt);
  });

  it("une offre perdue expire et rend l'adresse disponible à un autre client", () => {
    const sim = start(dhcpScenario({ singleAddress: true }));
    let offered = false;
    for (let step = 0; step < 100 && !offered; step += 1) {
      offered = sim.run({ maxEvents: 1 }).trace.some((e) => e.code === "dhcp.offer-sent");
    }
    expect(offered).toBe(true);
    command(sim, { type: "set-link", linkId: "l1", up: false });
    settle(sim);
    expect(server(sim)?.leases[0]?.state).toBe("offered");
    advanceTo(sim, fromSeconds(61));
    expect(server(sim)?.leases).toEqual([]);
    command(sim, { type: "dhcp", deviceId: "pc2", action: "renew" });
    settle(sim);
    expect(client(sim, "pc2")?.lease?.address).toBe("192.168.1.100");
  });

  it("renouvelle en unicast à T1 (60 s), sans prolonger indéfiniment « Terminer les échanges »", () => {
    const sim = start(dhcpScenario());
    settle(sim);
    const lease = client(sim)?.lease;
    if (!lease) throw new Error("bail attendu");
    expect(lease.renewAt - lease.obtainedAt).toBe(fromSeconds(60));
    expect(lease.rebindAt - lease.obtainedAt).toBe(fromSeconds(105));
    expect(lease.expiresAt - lease.obtainedAt).toBe(fromSeconds(120));
    expect(sim.snapshot().time).toBeLessThan(fromSeconds(1));
    const trace = advanceTo(sim, lease.renewAt + fromSeconds(1));
    expect(find(trace, "dhcp.request-sent", "pc1")[0]?.params["mode"]).toBe("renewing");
    expect(client(sim)?.lease?.expiresAt).toBeGreaterThan(lease.expiresAt);
    expect(client(sim)?.phase).toBe("bound");
  });

  it("perd le serveur : T2 diffusé, bail expiré, adresse et passerelle retirées", () => {
    const sim = start(dhcpScenario());
    settle(sim);
    const lease = client(sim)?.lease;
    if (!lease) throw new Error("bail attendu");
    command(sim, { type: "set-link", linkId: "l3", up: false });
    settle(sim);
    const trace = advanceTo(sim, lease.expiresAt + fromSeconds(1));
    expect(find(trace, "dhcp.request-sent", "pc1").map((e) => e.params["mode"])).toEqual(["renewing", "rebinding"]);
    expect(find(trace, "dhcp.expired", "pc1")).toHaveLength(1);
    expect(client(sim)?.lease).toBeNull();
    expect(sim.snapshot().devices.find((d) => d.deviceId === "pc1")?.interfaces[0]?.ipv4).toBeNull();
    expect(sim.snapshot().devices.find((d) => d.deviceId === "pc1")?.routes).toEqual([]);
    expect(server(sim)?.leases).toEqual([]);
  });

  it("refuse renew sur un poste statique ; un bail dynamique ne traverse pas les routeurs", () => {
    const sim = start(dhcpScenario());
    expect(sim.enqueue({ type: "dhcp", deviceId: "pc3", action: "renew" })).toMatchObject({ ok: false, code: "command.not-dhcp-client" });
    const doc = setInterfaceDhcp(dhcpScenario(), { deviceId: "pc3", portId: "eth0", enabled: true });
    if (!doc.ok) throw new Error("configuration attendue");
    const isolated = start(doc.document);
    settle(isolated);
    expect(client(isolated, "pc3")).toMatchObject({ phase: "failed", lease: null });
  });

  it("même graine et ordre du document inversé : même trace et mêmes baux", () => {
    const doc = dhcpScenario();
    const reordered: NfgDocument = { ...doc, topology: { ...doc.topology, devices: [...doc.topology.devices].reverse(), links: [...doc.topology.links].reverse() } };
    const a = start(doc, { seed: 42 });
    const b = start(reordered, { seed: 42 });
    expect(settle(a)).toEqual(settle(b));
    expect(a.snapshot()).toEqual(b.snapshot());
  });

  it("sert un VLAN par sous-interface, sans fuite vers un autre VLAN", () => {
    let doc = new ScenarioBuilder("dhcp-vlan", "DHCP par VLAN")
      .device("r1", "R-200", 0, 0).device("sw1", "S-24", 100, 0).device("pc1", "PC", 200, 0).device("pc2", "PC", 200, 100)
      .link("r1", "ge0", "sw1", "ge1").link("sw1", "ge2", "pc1", "eth0").link("sw1", "ge3", "pc2", "eth0")
      .ip("r1", "ge0.10", "192.168.10.1/24")
      .trunk("sw1", "ge1", [1, 10, 20])
      .access("sw1", "ge2", 10).access("sw1", "ge3", 20)
      .dhcpClient("pc1").dhcpClient("pc2").build();
    const configured = setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0.10", pool: { start: "192.168.10.100", end: "192.168.10.100", gateway: "192.168.10.1", leaseSeconds: 120 } });
    if (!configured.ok) throw new Error("plage attendue");
    doc = configured.document;
    const sim = start(doc);
    settle(sim);
    expect(client(sim)?.lease?.address).toBe("192.168.10.100");
    expect(client(sim, "pc2")?.lease).toBeNull();
  });
});
