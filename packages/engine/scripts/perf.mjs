// Mesure du calcul du moteur seul (sans navigateur), sur les scénarios versionnés.
// Usage : pnpm perf:engine (construit les paquets puis exécute ce script).
import { performance } from "node:perf_hooks";
import { createSimulation, performanceScenario, switchLoopScenario } from "../dist/index.js";

const REPEAT = 5;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function run(label, makeDoc, pings, parameters = {}) {
  const timings = [];
  let summary = null;
  for (let index = 0; index < REPEAT; index += 1) {
    const doc = makeDoc();
    const started = performance.now();
    const created = createSimulation(doc, { seed: 1, parameters });
    if (!created.ok) throw new Error(`${label} : document refusé`);
    const sim = created.simulation;
    for (const [source, destination] of pings) {
      const outcome = sim.enqueue({ type: "ping", deviceId: source, destination, count: 4 });
      if (!outcome.ok) throw new Error(`${label} : ${outcome.code}`);
    }
    let entries = 0;
    for (;;) {
      const result = sim.run({ stopWhenIdle: true, maxEvents: 50_000 });
      entries += result.trace.length;
      if (result.stop !== "budget") break;
    }
    timings.push(performance.now() - started);
    summary = { events: sim.processedEvents, traceEntries: entries, interrupted: sim.diagnostic?.code ?? null, simulatedSeconds: sim.time / 1e9 };
  }
  console.log(`${label}\n  médiane ${median(timings).toFixed(1)} ms (min ${Math.min(...timings).toFixed(1)}, max ${Math.max(...timings).toFixed(1)}, ${String(REPEAT)} essais)`);
  console.log(`  ${JSON.stringify(summary)}`);
}

const pair = (n, offset) => [`pc${String(n)}`, `10.10.0.${String(((n - 1 + offset) % 90) + 1)}`];

run("100 équipements · 8 pings × 4 échos (charge du parcours navigateur)", performanceScenario, [1, 11, 21, 31, 41, 51, 61, 71].map((n) => pair(n, 19)));
run("100 équipements · 90 pings × 4 échos (chaque PC vers un PC éloigné)", performanceScenario, Array.from({ length: 90 }, (_, index) => pair(index + 1, 45)), {
  limits: { maxPingSessions: 100 },
});
run("Boucle de commutation · tempête jusqu'à la limite de 100 000 événements en attente", switchLoopScenario, [["pc1", "192.168.1.11"]]);
console.log(`\nNode ${process.version} · ${process.platform} ${process.arch}`);
