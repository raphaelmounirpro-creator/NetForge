import { createSimulation, dhcpScenario, dnsScenario, lanScenario, lanThreeScenario, twoRoutersScenario, type Simulation, type TraceEntry } from "@netforge/engine";
import { describe, expect, it } from "vitest";
import { HOP_MS, MAX_BACKLOG_MS, scheduleAnimations, type Animation } from "./PacketLayer";
import type { JournalEntry } from "./store";

/** Décisions réelles du moteur pour un ping, sous forme d'entrées de journal. */
function journalOf(trace: readonly TraceEntry[]): JournalEntry[] {
  return trace.map((entry, key) => ({ key, entry }));
}

function pingTrace(doc = lanScenario(), destination = "192.168.1.11") {
  const created = createSimulation(doc);
  if (!created.ok) throw new Error("document refusé");
  created.simulation.enqueue({ type: "ping", deviceId: "pc1", destination, count: 1 });
  return created.simulation.run({ stopWhenIdle: true, maxEvents: 10_000 }).trace;
}

describe("animations issues des événements du moteur", () => {
  it("anime uniquement les trames réellement émises, dans l'ordre des événements", () => {
    const trace = pingTrace();
    const queue: Animation[] = [];
    scheduleAnimations(journalOf(trace), queue, { now: 0, cursor: 0 }, false);
    const frames = queue.filter((item) => item.kind === "frame");
    expect(frames).toHaveLength(trace.filter((entry) => entry.code === "eth.transmit").length);
    // Premières trames : requête ARP de PC1 vers SW1, puis SW1 qui la répète vers PC2.
    expect(frames.slice(0, 2).map((item) => [item.from, item.to, item.label])).toEqual([
      ["pc1", "sw1", "ARP"],
      ["sw1", "pc2", "ARP"],
    ]);
    const starts = frames.map((item) => item.start);
    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(frames[1]?.start).toBe(HOP_MS);
  });

  it("étiquette chaque trame par le protocole qu'elle transporte : ARP, ICMP, DHCP ou DNS", () => {
    const labels = (doc: Parameters<typeof createSimulation>[0], command?: Parameters<Simulation["enqueue"]>[0]) => {
      const created = createSimulation(doc);
      if (!created.ok) throw new Error("document refusé");
      if (command) created.simulation.enqueue(command);
      const queue: Animation[] = [];
      scheduleAnimations(journalOf(created.simulation.run({ stopWhenIdle: true, maxEvents: 10_000 }).trace), queue, { now: 0, cursor: 0 }, false);
      return new Set(queue.filter((item) => item.kind === "frame").map((item) => item.label));
    };
    expect(labels(lanScenario(), { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 })).toEqual(new Set(["ARP", "ICMP"]));
    expect(labels(dhcpScenario())).toEqual(new Set(["DHCP"]));
    expect(labels(dnsScenario(), { type: "nslookup", deviceId: "pc1", name: "srv.lab" })).toEqual(new Set(["ARP", "DNS"]));
  });

  it("fait partir ensemble les trames d'un même événement (inondation)", () => {
    const trace = pingTrace(lanThreeScenario());
    const queue: Animation[] = [];
    scheduleAnimations(journalOf(trace), queue, { now: 0, cursor: 0 }, false);
    const events = new Set(trace.filter((entry) => entry.code === "eth.transmit").map((entry) => entry.event));
    // Un instant de départ par événement : les copies d'une inondation partent ensemble.
    const frames = queue.filter((item) => item.kind === "frame");
    expect(new Set(frames.map((item) => item.start)).size).toBe(events.size);
    expect(frames.length).toBeGreaterThan(events.size);
  });

  it("marque d'une croix l'abandon décidé par le moteur", () => {
    const trace = pingTrace(twoRoutersScenario({ r2Route: false }), "10.0.2.10");
    const queue: Animation[] = [];
    scheduleAnimations(journalOf(trace), queue, { now: 0, cursor: 0 }, false);
    expect(queue.filter((item) => item.kind === "drop").map((item) => item.from)).toContain("r2");
  });

  it("abandonne les animations non commencées quand l'affichage prend trop de retard", () => {
    const queue: Animation[] = [];
    const clock = { now: 0, cursor: 0 };
    scheduleAnimations(journalOf(pingTrace()), queue, clock, false);
    expect(clock.cursor).toBeGreaterThan(MAX_BACKLOG_MS);
    const before = queue.length;
    scheduleAnimations(journalOf(pingTrace()).map((item) => ({ ...item, key: item.key + 1000 })), queue, clock, false);
    // Les trames non commencées du premier lot sont abandonnées ; le nouveau lot part tout de suite.
    expect(queue.length).toBeLessThan(2 * before);
    expect(Math.min(...queue.map((item) => item.start))).toBe(0);
  });

  it("sans mouvement (réduction des animations), ne garde que le dernier lot", () => {
    const queue: Animation[] = [];
    const clock = { now: 0, cursor: 0 };
    scheduleAnimations(journalOf(pingTrace()), queue, clock, true);
    const first = queue.length;
    scheduleAnimations(journalOf(pingTrace()).slice(0, 3), queue, clock, true);
    expect(first).toBeGreaterThan(3);
    expect(queue.length).toBeLessThanOrEqual(3);
  });
});
