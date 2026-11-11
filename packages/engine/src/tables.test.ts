import { describe, expect, it } from "vitest";
import { lanThreeScenario } from "./scenarios.js";
import { command, find, ping, settle, start } from "./test-support/helpers.js";

describe("effacement des tables apprises", () => {
  it("vide le cache ARP d'un PC : le ping suivant résout de nouveau l'adresse", () => {
    const sim = start(lanThreeScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    command(sim, { type: "clear-table", deviceId: "pc1", table: "arp" });
    const cleared = settle(sim);
    expect(find(cleared, "command.clear-arp", "pc1")).toEqual([expect.objectContaining({ params: { count: 1 } })]);
    expect(sim.snapshot().devices.find((device) => device.deviceId === "pc1")?.arpCache).toEqual([]);

    ping(sim, "pc1", "192.168.1.11");
    const again = settle(sim);
    expect(find(again, "arp.request-sent", "pc1")).toHaveLength(1);
    expect(find(again, "ping.reply", "pc1")).toHaveLength(1);
  });

  it("vide la table MAC d'un switch : la trame suivante est inondée", () => {
    const sim = start(lanThreeScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    command(sim, { type: "clear-table", deviceId: "sw1", table: "mac" });
    expect(find(settle(sim), "command.clear-mac", "sw1")).toEqual([expect.objectContaining({ params: { count: 2 } })]);

    ping(sim, "pc1", "192.168.1.11");
    const trace = settle(sim);
    expect(find(trace, "switch.flood-unknown", "sw1")).toHaveLength(1);
    expect(find(trace, "nic.filtered", "pc3")).toHaveLength(1);
  });

  it("refuse une table qui n'existe pas sur l'équipement", () => {
    const sim = start(lanThreeScenario());
    expect(sim.enqueue({ type: "clear-table", deviceId: "sw1", table: "arp" })).toMatchObject({ ok: false, code: "command.wrong-table" });
    expect(sim.enqueue({ type: "clear-table", deviceId: "pc1", table: "mac" })).toMatchObject({ ok: false, code: "command.wrong-table" });
    expect(sim.enqueue({ type: "clear-table", deviceId: "absent", table: "arp" })).toMatchObject({ ok: false, code: "command.unknown-device" });
  });

  it("une entrée réapprise après effacement expire à sa propre échéance", () => {
    const sim = start(lanThreeScenario());
    ping(sim, "pc1", "192.168.1.11");
    settle(sim);
    sim.run({ until: 30_000_000_000, maxEvents: 100_000 });
    command(sim, { type: "clear-table", deviceId: "pc1", table: "arp" });
    ping(sim, "pc1", "192.168.1.11");
    const relearned = settle(sim);
    const learnedAt = find(relearned, "arp.entry-added", "pc1")[0]?.time ?? 0;
    // La temporisation d'origine (échéance à 60 s) trouve une entrée plus récente et se reporte.
    const expiry = sim.run({ until: learnedAt + 60_000_000_000, maxEvents: 100_000 }).trace;
    expect(find(expiry, "arp.entry-expired", "pc1")).toEqual([expect.objectContaining({ time: learnedAt + 60_000_000_000 })]);
  });
});
