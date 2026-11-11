import { describe, expect, it } from "vitest";
import { createSimulation } from "./simulation.js";
import { lanScenario, routedScenario } from "./scenarios.js";
import { start } from "./test-support/helpers.js";

describe("validation des commandes", () => {
  const sim = () => start(lanScenario());

  it("refuse un équipement inconnu ou qui n'est pas un PC", () => {
    expect(sim().enqueue({ type: "ping", deviceId: "absent", destination: "192.168.1.11" })).toMatchObject({ code: "command.unknown-device" });
    expect(sim().enqueue({ type: "ping", deviceId: "sw1", destination: "192.168.1.11" })).toMatchObject({
      code: "command.not-a-pc",
      params: { deviceName: "SW1" },
    });
  });

  it("refuse une destination mal écrite, de groupe, réservée ou de diffusion locale", () => {
    const cases: Array<[string, string]> = [
      ["192.168.1", "format"],
      ["192.168.001.11", "format"],
      ["224.0.0.1", "multicast"],
      ["255.255.255.255", "reserved"],
      ["0.0.0.0", "this-network"],
      ["192.168.1.255", "broadcast-address"],
    ];
    for (const [destination, reason] of cases) {
      expect(sim().enqueue({ type: "ping", deviceId: "pc1", destination })).toMatchObject({
        ok: false,
        code: "command.invalid-destination",
        params: { reason },
      });
    }
  });

  it("accepte une destination entourée d'espaces et la normalise", () => {
    const simulation = sim();
    expect(simulation.enqueue({ type: "ping", deviceId: "pc1", destination: " 192.168.1.11 " })).toEqual({ ok: true, sessionId: "ping-1" });
    expect(simulation.commandLog[0]?.command).toEqual({ type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 4 });
  });

  it("borne le nombre d'échos et de pings simultanés", () => {
    expect(sim().enqueue({ type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 0 })).toMatchObject({ code: "command.invalid-count" });
    expect(sim().enqueue({ type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 21 })).toMatchObject({ code: "command.invalid-count" });
    expect(sim().enqueue({ type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1.5 })).toMatchObject({ code: "command.invalid-count" });
    const simulation = start(lanScenario(), { parameters: { limits: { maxPingSessions: 2 } } });
    simulation.enqueue({ type: "ping", deviceId: "pc1", destination: "192.168.1.11" });
    simulation.enqueue({ type: "ping", deviceId: "pc2", destination: "192.168.1.10" });
    expect(simulation.enqueue({ type: "ping", deviceId: "pc1", destination: "192.168.1.11" })).toMatchObject({
      code: "command.too-many-pings",
      params: { max: 2 },
    });
  });

  it("refuse un lien inconnu", () => {
    expect(sim().enqueue({ type: "set-link", linkId: "absent", up: false })).toMatchObject({ code: "command.unknown-link" });
  });

  it("refuse de simuler un document comportant des erreurs", () => {
    const doc = routedScenario();
    const broken = { ...doc, topology: { ...doc.topology, links: [...doc.topology.links, { ...doc.topology.links[0], id: "l1" }] } };
    const result = createSimulation(broken as typeof doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.map((issue) => issue.code)).toContain("link.duplicate-id");
  });
});
