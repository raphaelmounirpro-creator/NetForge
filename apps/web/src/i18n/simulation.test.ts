import {
  COMMAND_ERROR_CODES,
  TRACE_CODES,
  createSimulation,
  dhcpScenario,
  dnsScenario,
  lanScenario,
  routedScenario,
  twoRoutersScenario,
  VLAN_SCENARIO,
  stpTriangleScenario,
  vlanScenario,
  type SimCommand,
  type TraceEntry,
} from "@netforge/engine";
import { addStaticRoute, disconnect, setDefaultGateway, setDnsServer, setInterfaceIpv4, setSwitchport, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import {
  buildNameIndex,
  formatCommandError,
  formatDuration,
  formatSimTime,
  formatTrace,
  isLossOrError,
  lookupLines,
  pingAttemptText,
  pingResolutionLine,
  pingSummary,
  traceCategory,
  pduLayers,
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
    // VLAN : trunk étiqueté, routage inter-VLAN, puis chaque refus (accès, trunk, sous-interface, poste).
    run(vlanScenario(), [
      { type: "ping", deviceId: "pc1", destination: VLAN_SCENARIO.pc3, count: 1 },
      { type: "ping", deviceId: "pc1", destination: VLAN_SCENARIO.pc2, count: 1 },
    ]),
    run(ok(setSwitchport(vlanScenario({ trunkAllowed: "all" }), { deviceId: "sw2", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: [20] } })).document, [
      { type: "ping", deviceId: "pc1", destination: VLAN_SCENARIO.pc3, count: 1 },
    ]),
    run(ok(setSwitchport(vlanScenario(), { deviceId: "sw2", portId: "ge1", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: [10] } })).document, [
      { type: "ping", deviceId: "pc1", destination: VLAN_SCENARIO.pc3, count: 1 },
    ]),
    run(
      ok(setSwitchport(ok(setSwitchport(vlanScenario(), { deviceId: "sw1", portId: "ge23", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: "all" } })).document, { deviceId: "sw1", portId: "ge2", switchport: { mode: "access", vlan: 30 } }))
        .document,
      [{ type: "ping", deviceId: "pc2", destination: "192.168.20.1", count: 1 }],
    ),
    run(ok(setSwitchport(vlanScenario(), { deviceId: "sw2", portId: "ge24", switchport: { mode: "access", vlan: 10 } })).document, [
      { type: "ping", deviceId: "pc1", destination: VLAN_SCENARIO.pc3, count: 1 },
    ]),
    // Spanning Tree : trame écartée par un port bloqué, coupure (écoute, apprentissage, transmission), lien rétabli.
    run(stpTriangleScenario(), [
      { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 },
      { type: "set-link", linkId: "l3", up: false },
      { type: "ping", deviceId: "pc1", destination: "192.168.1.11", count: 1 },
      { type: "set-link", linkId: "l3", up: true },
    ]),
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
    for (const code of ["vlan.tagged-dropped", "vlan.not-allowed", "vlan.no-subinterface", "nic.tagged-dropped", "stp.discarded", "stp.port-state", "stp.topology-change"]) expect(seen, code).toContain(code);
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

describe("observation DHCP sur des échanges réels", () => {
  it("explique DORA aux deux niveaux et inspecte les couches UDP/DHCP avec leurs seuls champs modélisés", () => {
    const { simulation } = ok(createSimulation(dhcpScenario()));
    const trace = simulation.run({ stopWhenIdle: true, maxEvents: 10_000 }).trace;
    const names = buildNameIndex(simulation.snapshot().devices);
    for (const entry of trace) {
      for (const level of ["beginner", "technical"] as const) {
        expect(formatTrace(entry, names, level)).not.toMatch(/\{\w+\}|undefined/);
      }
    }
    const discover = trace.find((e) => e.code === "eth.transmit" && e.deviceId === "pc1");
    if (!discover?.pdu) throw new Error("DISCOVER attendu");
    const layers = pduLayers(discover.pdu, names);
    expect(layers.map((l) => l.id)).toEqual(["ethernet", "ipv4", "udp", "dhcp"]);
    expect(layers[1]?.fields).toContainEqual(["Protocole transporté", "17 (UDP)"]);
    expect(layers[2]?.fields).toEqual([["Port source", "68"], ["Port destination", "67"]]);
    expect(layers[3]?.fields).toContainEqual(["Type", "DHCPDISCOVER"]);
    expect(layers[3]?.fields.some(([key]) => key === "Serveur (option 54)")).toBe(false);
    expect(traceCategory("dhcp.bound")).toBe("dhcp");
  });
});

describe("observation DNS sur des échanges réels", () => {
  const noRoute = ok(setDefaultGateway(ok(setDnsServer(dnsScenario(), { deviceId: "pc2", server: "10.0.0.1" })).document, { deviceId: "pc2", gateway: null })).document;
  const runs = [
    run(dnsScenario(), [
      { type: "nslookup", deviceId: "pc1", name: "srv.lab" },
      { type: "nslookup", deviceId: "pc1", name: "inconnu.lab" },
      { type: "ping", deviceId: "pc1", destination: "srv.lab", count: 1 },
      { type: "ping", deviceId: "pc1", destination: "inconnu.lab", count: 1 },
      { type: "nslookup", deviceId: "pc2", name: "srv.lab" },
    ]),
    run(dnsScenario({ serviceDisabled: true }), [{ type: "ping", deviceId: "pc1", destination: "srv.lab", count: 1 }]),
    run(noRoute, [{ type: "nslookup", deviceId: "pc2", name: "srv.lab" }]),
  ];
  const first = () => {
    const result = runs[0];
    if (!result) throw new Error("scénario attendu");
    return { ...result, names: buildNameIndex(result.snapshot.devices) };
  };
  const decision = (trace: readonly TraceEntry[], code: TraceEntry["code"], deviceId?: string) => {
    const entry = trace.find((item) => item.code === code && (deviceId === undefined || item.deviceId === deviceId));
    if (!entry) throw new Error(code);
    return entry;
  };

  it("explique chaque décision DNS aux deux niveaux, sans paramètre manquant", () => {
    const seen = new Set<string>();
    for (const { trace, snapshot } of runs) {
      const names = buildNameIndex(snapshot.devices);
      for (const entry of trace) {
        seen.add(entry.code);
        for (const level of ["beginner", "technical"] as const) {
          expect(formatTrace(entry, names, level), entry.code + " " + level).not.toMatch(/\{\w+\}|undefined|null|NaN/);
        }
      }
    }
    for (const code of ["command.nslookup", "dns.no-server", "dns.query-sent", "dns.send-failed", "dns.answer-sent", "dns.name-error-sent", "dns.resolved", "dns.name-error", "dns.gave-up", "ping.unresolved", "udp.no-service"]) {
      expect(seen, code).toContain(code);
    }
  });

  it("formule les explications attendues", () => {
    const { trace, names } = first();
    const text = (code: TraceEntry["code"], level: "beginner" | "technical" = "beginner", deviceId?: string) => formatTrace(decision(trace, code, deviceId), names, level);
    expect(text("dns.resolved")).toBe("PC1 apprend que srv.lab correspond à 10.0.0.10 (réponse de 192.168.1.1).");
    expect(text("dns.name-error-sent")).toBe("R1 répond à 192.168.1.10 que inconnu.lab n'existe pas : aucun enregistrement à ce nom.");
    expect(text("ping.unresolved")).toBe("Ping de PC1 vers inconnu.lab abandonné avant le premier écho : nom inexistant (NXDOMAIN).");
    expect(text("command.nslookup", "beginner", "pc1")).toBe("PC1 demande l'adresse de srv.lab à son serveur DNS 192.168.1.1.");
    expect(text("command.nslookup", "beginner", "pc2")).toBe("PC2 cherche l'adresse de srv.lab, mais aucun serveur DNS n'est configuré.");
    expect(text("dns.query-sent", "technical")).toMatch(/^Question DNS : identifiant \d+, QR=0, RD=1, type A, classe IN ; UDP \d+ → 192\.168\.1\.1:53\./);
    expect(traceCategory("dns.resolved")).toBe("dns");
    expect(traceCategory("command.nslookup")).toBe("dns");
    expect(isLossOrError(decision(trace, "dns.name-error"))).toBe(true);
    expect(isLossOrError(decision(trace, "dns.resolved"))).toBe(false);
  });

  it("inspecte question et réponse avec leurs seuls champs modélisés", () => {
    const { trace, names } = first();
    const frames = trace.flatMap((entry) =>
      entry.code === "eth.transmit" && entry.pdu?.kind === "ethernet" && entry.pdu.payload.kind === "ipv4" && entry.pdu.payload.payload.kind === "udp" ? [entry.pdu] : [],
    );
    const query = frames[0];
    const answer = frames.find((frame) => frame.destination === query?.source);
    if (!query || !answer) throw new Error("question et réponse attendues");
    const queryLayers = pduLayers(query, names);
    expect(queryLayers.map((layer) => layer.id)).toEqual(["ethernet", "ipv4", "udp", "dns"]);
    expect(queryLayers[2]?.fields[1]).toEqual(["Port destination", "53"]);
    expect(queryLayers[3]?.fields.slice(1)).toEqual([
      ["QR", "0 (question)"],
      ["Drapeaux", "AA=0, RD=1, RA=0"],
      ["RCODE", "0 (pas d'erreur)"],
      ["Question", "srv.lab, type A (1), classe IN (1)"],
    ]);
    expect(pduLayers(answer, names)[3]?.fields.slice(1)).toEqual([
      ["QR", "1 (réponse)"],
      ["Drapeaux", "AA=1, RD=1, RA=0"],
      ["RCODE", "0 (pas d'erreur)"],
      ["Question", "srv.lab, type A (1), classe IN (1)"],
      ["Réponse", "srv.lab → 10.0.0.10, type A, TTL 300 s"],
    ]);
  });

  it("présente les résultats de nslookup et des pings par nom", () => {
    const { snapshot } = first();
    const [found, unknown, noServer] = snapshot.lookups;
    if (!found || !unknown || !noServer) throw new Error("résolutions attendues");
    expect(lookupLines(found)).toEqual({ lines: ["Serveur : 192.168.1.1", "Nom : srv.lab", "Adresse : 10.0.0.10 (TTL 300 s)"], error: null });
    expect(lookupLines(unknown)).toEqual({ lines: ["Serveur : 192.168.1.1"], error: "*** inconnu.lab : nom inexistant (NXDOMAIN)" });
    expect(lookupLines(noServer)).toEqual({ lines: [], error: "*** srv.lab : aucun serveur DNS configuré sur le poste" });
    const [byName, unresolved] = snapshot.pings;
    if (!byName || !unresolved) throw new Error("pings attendus");
    expect(pingResolutionLine(byName)).toEqual({ text: "srv.lab correspond à 10.0.0.10.", failed: false });
    expect(pingSummary(byName)?.summary).toBe("1 envoyé(s), 1 reçu(s), 0 perdu(s) (0 % de perte)");
    expect(pingResolutionLine(unresolved)).toEqual({ text: "La requête ping n'a pas trouvé l'hôte inconnu.lab : nom inexistant (NXDOMAIN).", failed: true });
    expect(pingSummary(unresolved)).toBeNull();
    const timeout = runs[1]?.snapshot.pings[0];
    expect(timeout && pingResolutionLine(timeout)?.text).toBe("La requête ping n'a pas trouvé l'hôte srv.lab : aucune réponse du serveur DNS.");
  });

  it("explique les commandes DNS refusées", () => {
    expect(formatCommandError("command.invalid-name", { name: "srv_lab" })).toBe("« srv_lab » n'est pas un nom d'hôte valide (exemple : srv.lab).");
    expect(formatCommandError("command.invalid-destination", { destination: "10.0.0", reason: "format" })).toBe(
      "« 10.0.0 » ne peut pas être pingée : ni adresse IPv4 (exemple : 192.168.1.11) ni nom d'hôte (exemple : srv.lab).",
    );
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
      expect(formatCommandError(code, { max: 20, deviceName: "SW1", destination: "x", name: "x", reason: "format", table: "arp" })).not.toMatch(/\{\w+\}/);
    }
    expect(formatCommandError("command.invalid-destination", { destination: "224.0.0.1", reason: "multicast" })).toBe(
      "« 224.0.0.1 » ne peut pas être pingée : plage multicast 224.0.0.0/4.",
    );
  });
});
