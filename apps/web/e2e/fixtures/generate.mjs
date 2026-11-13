// Régénère les projets de référence des parcours navigateur à partir des
// scénarios versionnés du moteur. Usage : pnpm build:packages, puis
// node apps/web/e2e/fixtures/generate.mjs (un test unitaire vérifie la synchronisation).
import { writeFileSync } from "node:fs";
import { bgpScenario, dhcpScenario, dnsScenario, ftthScenario, ospfAreasScenario, ospfLanScenario, ospfScenario, performanceScenario, ripScenario, vrrpScenario, routedScenario, stpTriangleScenario, switchLoopScenario, twoRoutersScenario, vlanScenario } from "@netforge/engine";
import { serializeNfg } from "@netforge/project";

const fixtures = {
  "routed.nfg.json": routedScenario(),
  "dhcp.nfg.json": dhcpScenario(),
  "dns.nfg.json": dnsScenario(),
  "rip.nfg.json": ripScenario(),
  "ospf.nfg.json": ospfScenario(),
  "ospf-lan.nfg.json": ospfLanScenario(),
  "ospf-zones.nfg.json": ospfAreasScenario(),
  "vrrp.nfg.json": vrrpScenario(),
  "bgp.nfg.json": bgpScenario(),
  "two-routers-no-return.nfg.json": twoRoutersScenario({ r2Route: false }),
  "perf-100.nfg.json": performanceScenario(),
  "switch-loop.nfg.json": switchLoopScenario(),
  "ftth.nfg.json": ftthScenario(),
  "vlan.nfg.json": vlanScenario(),
  "stp-triangle.nfg.json": stpTriangleScenario(),
};

for (const [name, doc] of Object.entries(fixtures)) {
  writeFileSync(new URL(name, import.meta.url), serializeNfg(doc));
  console.log(`écrit : ${name}`);
}
