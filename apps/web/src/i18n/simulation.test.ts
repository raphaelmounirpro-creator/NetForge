import {
  COMMAND_ERROR_CODES,
  TRACE_CODES,
  createSimulation,
  lanScenario,
  routedScenario,
  twoRoutersScenario,
  type SimCommand,
  type TraceEntry,
} from "@netforge/engine";
import { addStaticRoute, disconnect, setDefaultGateway, setInterfaceIpv4, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import {
  buildNameIndex,
  formatCommandError,
  formatDuration,
  formatSimTime,
  formatTrace,
  isLossOrError,
  pingAttemptText,
  pingSummary,
  traceCategory,
} from "./simulation";

function ok<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error("résultat attendu");
  return result as Extract<T, { ok: true }>;
}

/** Exécute un scénario réel du moteur et renvoie toutes ses décisions. */
function run(doc: NfgDocument, commands: SimCommand[], options: Parameters<typeof createSimulation>[1] = {}) {
  const created = createSimulation(doc, options);
  if (!created.ok) throw new Error("document refusé");
  const sim = created.simulation;
  const trace: TraceEntry[] = [];
  for (const command of commands) {
    sim.enqueue(command);
    trace.push(...sim.run({ stopWhenIdle: true, maxEvents: 200_000 }).trace);
  }
  trace.push(...sim.run({ until: 400_000_000_000, maxEvents: 200_000 }).trace);
  return { trace, snapshot: sim.snapshot() };
}

function allScenarios() {
  const loop = ok(
    addStaticRoute(
      ok(addStaticRoute(twoRoutersScenario(), { deviceId: "r1", route: { destination: "10.0.9.0", prefixLength: 24, nextHop: "10.0.12.2" } }))
        .document,
      { deviceId: "r2", route: { destination: "10.0.9.0", prefixLength: 24, nextHop: "10.0.12.1" } },
    ),
  ).document;
  return [
    run(lanScenario(), [
      { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 2 },
      { type: "ping", deviceId: "pc1", destination: "127.0.0.1", count: 1 },
      { type: "set-link", linkId: "l2", up: false },
      { type: "set-link", linkId: "l2", up: false },
      { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 },
      { type: "set-link", linkId: "l2", up: true },
      { type: "set-link", linkId: "l2", up: true },
    ]),
    run(routedScenario(), [
      { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 1 },
      { type: "ping", deviceId: "pc1", destination: "192.168.2.99", count: 1 },
      { type: "ping", deviceId: "pc1", destination: "192.168.2.255", count: 1 },
    ]),
    run(ok(setDefaultGateway(routedScenario(), { deviceId: "pc2", gateway: null })).document, [
      { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 1 },
      { type: "ping", deviceId: "pc2", destination: "192.168.1.10", count: 1 },
    ]),
    run(ok(setDefaultGateway(routedScenario(), { deviceId: "pc1", gateway: "10.9.9.9" })).document, [
      { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 1 },
    ]),
    run(ok(setInterfaceIpv4(lanScenario(), { deviceId: "pc1", portId: "eth0", ipv4: null })).document, [
      { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 },
      { type: "ping", deviceId: "pc2", destination: "192.168.1.10", count: 1 },
    ]),
    run(ok(disconnect(lanScenario(), { linkId: "l2" })).document, [{ type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 }]),
    run(twoRoutersScenario({ r1Route: false }), [{ type: "ping", deviceId: "pc1", destination: "10.0.2.10", count: 1 }]),
    run(loop, [{ type: "ping", deviceId: "pc1", destination: "10.0.9.9", count: 1 }]),
    run(lanScenario(), [{ type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 }], { parameters: { limits: { maxEvents: 5 } } }),
  ];
}

describe("textes de la trace", () => {
  const scenarios = allScenarios();

  it("produit une phrase complète pour chaque décision réellement émise par le moteur", () => {
    const seen = new Set<string>();
    for (const { trace, snapshot } of scenarios) {
      const names = buildNameIndex(snapshot.devices);
      for (const entry of trace) {
        seen.add(entry.code);
        const text = formatTrace(entry, names);
        expect(text, entry.code).not.toMatch(/\{\w+\}|undefined|null|NaN/);
        expect(text.length, entry.code).toBeGreaterThan(15);
      }
    }
    // Les scénarios couvrent l'essentiel des codes (les autres sont vérifiés par leur gabarit).
    expect(seen.size).toBeGreaterThan(40);
  });

  it("prévoit un gabarit pour chaque code de trace", () => {
    const names = buildNameIndex([]);
    for (const code of TRACE_CODES) {
      const entry: TraceEntry = { event: 1, parent: null, time: 0, deviceId: null, portId: null, exchange: null, code, params: {}, pdu: null };
      expect(() => formatTrace(entry, names), code).not.toThrow();
      expect(formatTrace(entry, names), code).not.toBe("");
    }
  });

  it("explique l'absence de route d'un routeur comme le prévoit la spécification", () => {
    const { trace, snapshot } = scenarios[6] ?? { trace: [], snapshot: undefined };
    const entry = trace.find((item) => item.code === "ip.no-route");
    if (!entry || !snapshot) throw new Error("décision attendue");
    expect(formatTrace(entry, buildNameIndex(snapshot.devices))).toBe(
      "R1 abandonne le paquet : aucune route ne correspond à 10.0.2.10 et aucune route par défaut n'est configurée.",
    );
  });

  it("annote les adresses MAC avec leur propriétaire", () => {
    const { trace, snapshot } = scenarios[0] ?? { trace: [], snapshot: undefined };
    const entry = trace.find((item) => item.code === "switch.learn");
    if (!entry || !snapshot) throw new Error("décision attendue");
    expect(formatTrace(entry, buildNameIndex(snapshot.devices))).toMatch(/^SW1 apprend que 02(:[0-9a-f]{2}){5} \(PC1 eth0\) se trouve derrière son port ge1/);
  });

  it("classe chaque code dans une catégorie", () => {
    expect(traceCategory("arp.request-sent")).toBe("arp");
    expect(traceCategory("nic.filtered")).toBe("link");
    expect(traceCategory("ping.reply")).toBe("icmp");
    expect(traceCategory("sim.interrupted")).toBe("system");
  });
});

describe("pertes et erreurs mises en évidence", () => {
  const codesWhere = (predicate: (entry: TraceEntry) => boolean) =>
    new Set(allScenarios().flatMap(({ trace }) => trace.filter(predicate).map((entry) => entry.code)));

  it("signale les pertes et erreurs réellement produites par le moteur", () => {
    const flagged = codesWhere(isLossOrError);
    for (const code of ["arp.failed", "ip.no-route", "ip.ttl-expired", "icmp.error-sent", "ping.error", "ping.failed", "ping.timeout", "command.link-down", "sim.interrupted"]) {
      expect(flagged, code).toContain(code);
    }
  });

  it("ne signale pas le fonctionnement normal", () => {
    const normal = codesWhere((entry) => !isLossOrError(entry));
    for (const code of ["arp.request-sent", "arp.reply-received", "switch.learn", "switch.flood-broadcast", "ip.forward", "ping.reply"]) {
      expect(normal, code).toContain(code);
    }
    expect(codesWhere(isLossOrError)).not.toContain("ping.reply");
  });

  it("classe une trame non émise comme une perte, une trame filtrée par une carte comme normale", () => {
    const entry = (code: TraceEntry["code"]): TraceEntry => ({ event: 1, parent: null, time: 0, deviceId: null, portId: null, exchange: null, code, params: {}, pdu: null });
    expect(isLossOrError(entry("eth.link-down"))).toBe(true);
    expect(isLossOrError(entry("eth.lost-in-transit"))).toBe(true);
    expect(isLossOrError(entry("nic.filtered"))).toBe(false);
    expect(isLossOrError({ ...entry("command.link-down"), params: { changed: false } })).toBe(false);
  });

  it("ne signale un bilan de ping que s'il y a eu des pertes", () => {
    const done = (lost: number): TraceEntry => ({
      event: 1,
      parent: null,
      time: 0,
      deviceId: null,
      portId: null,
      exchange: null,
      code: "ping.done",
      params: { sent: 4, received: 4 - lost, lost },
      pdu: null,
    });
    expect(isLossOrError(done(0))).toBe(false);
    expect(isLossOrError(done(1))).toBe(true);
  });
});

describe("résultats de ping", () => {
  it("décrit chaque écho et le bilan", () => {
    const { snapshot } = run(routedScenario(), [
      { type: "ping", deviceId: "pc1", destination: "192.168.2.10", count: 2 },
      { type: "ping", deviceId: "pc1", destination: "192.168.2.99", count: 1 },
    ]);
    const [success, unreachable] = snapshot.pings;
    const failedAttempt = unreachable?.attempts[0];
    if (!success || !unreachable || !failedAttempt) throw new Error("pings attendus");
    expect(success.attempts.map(pingAttemptText)[0]).toMatch(/^Réponse de 192\.168\.2\.10 : séquence 1, TTL 63, temps \d+,\d{3} µs$/);
    expect(pingSummary(success)?.summary).toBe("2 envoyé(s), 2 reçu(s), 0 perdu(s) (0 % de perte)");
    expect(pingSummary(success)?.hasLoss).toBe(false);
    expect(pingAttemptText(failedAttempt)).toBe(
      "Séquence 1 : hôte de destination inaccessible (signalé par 192.168.1.1)",
    );
    expect(pingSummary(unreachable)).toEqual({ summary: "1 envoyé(s), 0 reçu(s), 1 perdu(s) (100 % de perte)", rtt: null, hasLoss: true });
  });
});

describe("formats", () => {
  it("affiche instants et durées en français", () => {
    expect(formatSimTime(1_000_012_000)).toBe("1,000012 s");
    expect(formatDuration(500)).toBe("500 ns");
    expect(formatDuration(29_136)).toBe("29,136 µs");
    expect(formatDuration(4_000_000_000)).toBe("4,000 s");
  });

  it("explique chaque refus de commande", () => {
    for (const code of COMMAND_ERROR_CODES) {
      expect(formatCommandError(code, { max: 20, deviceName: "SW1", destination: "x", reason: "format", table: "arp" })).not.toMatch(/\{\w+\}/);
    }
    expect(formatCommandError("command.invalid-destination", { destination: "224.0.0.1", reason: "multicast" })).toBe(
      "« 224.0.0.1 » ne peut pas être pingée : plage multicast 224.0.0.0/4.",
    );
  });
});
