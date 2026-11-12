import { dhcpScenario, dnsScenario, ftthScenario, performanceScenario, ripScenario, routedScenario, stpTriangleScenario, switchLoopScenario, twoRoutersScenario, vlanScenario } from "@netforge/engine";
import { parseNfgText, serializeNfg, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";

/** Projets de référence des parcours navigateur (e2e/fixtures), générés depuis les scénarios du moteur. */
const files = import.meta.glob<string>("../e2e/fixtures/*.nfg.json", { eager: true, query: "?raw", import: "default" });

const expected: Record<string, NfgDocument> = {
  "routed.nfg.json": routedScenario(),
  "dhcp.nfg.json": dhcpScenario(),
  "dns.nfg.json": dnsScenario(),
  "rip.nfg.json": ripScenario(),
  "two-routers-no-return.nfg.json": twoRoutersScenario({ r2Route: false }),
  "perf-100.nfg.json": performanceScenario(),
  "switch-loop.nfg.json": switchLoopScenario(),
  "ftth.nfg.json": ftthScenario(),
  "vlan.nfg.json": vlanScenario(),
  "stp-triangle.nfg.json": stpTriangleScenario(),
};

describe("projets de référence des parcours navigateur", () => {
  for (const [name, doc] of Object.entries(expected)) {
    it(`${name} correspond au scénario du moteur (sinon : node e2e/fixtures/generate.mjs)`, () => {
      const text = files[`../e2e/fixtures/${name}`];
      expect(text).toBe(serializeNfg(doc));
      expect(parseNfgText(text ?? "").ok).toBe(true);
    });
  }

  it("le scénario de performance compte 100 équipements et 99 liens", () => {
    const doc = performanceScenario();
    expect(doc.topology.devices).toHaveLength(100);
    expect(doc.topology.links).toHaveLength(99);
  });
});
