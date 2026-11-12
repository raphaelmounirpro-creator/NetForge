import { setDefaultGateway, setDnsRecord, setDnsServer, setInterfaceDhcp, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { dnsBytes, frameBytes, type DnsMessage, type EthernetFrame, type UdpDatagram } from "./pdu.js";
import { dhcpScenario, dnsScenario } from "./scenarios.js";
import type { Simulation } from "./simulation.js";
import { command, find, ping, settle, start } from "./test-support/helpers.js";
import { fromSeconds } from "./time.js";
import type { TraceEntry } from "./trace.js";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

const lookup = (sim: Simulation, id: string | null) => sim.snapshot().lookups.find((view) => view.id === id);
const dnsService = (sim: Simulation) => sim.snapshot().devices.find((device) => device.deviceId === "r1")?.dnsServer;

/** Datagrammes UDP portant du DNS, tels qu'émis sur les câbles. */
function dnsOnWire(trace: readonly TraceEntry[]): Array<{ frame: EthernetFrame; udp: UdpDatagram; dns: DnsMessage; source: string; destination: string }> {
  return find(trace, "eth.transmit").flatMap((entry) => {
    const frame = entry.pdu;
    if (frame?.kind !== "ethernet" || frame.payload.kind !== "ipv4" || frame.payload.payload.kind !== "udp") return [];
    const udp = frame.payload.payload;
    return udp.payload.kind === "dns" ? [{ frame, udp, dns: udp.payload, source: frame.payload.source, destination: frame.payload.destination }] : [];
  });
}

describe("DNS : résolution par le service d'un routeur", () => {
  it("nslookup : question A unicast vers le port 53, réponse d'autorité vers le port source, adresse obtenue", () => {
    const sim = start(dnsScenario());
    const id = command(sim, { type: "nslookup", deviceId: "pc1", name: "SRV.lab." });
    expect(lookup(sim, id)).toMatchObject({ name: "srv.lab", server: "192.168.1.1", status: "pending", attempts: 0 });
    const trace = settle(sim);
    expect(lookup(sim, id)).toEqual({ id, deviceId: "pc1", name: "srv.lab", server: "192.168.1.1", status: "resolved", address: "10.0.0.10", ttl: 300, attempts: 1 });
    // Ordre des décisions : commande, question, ARP vers le serveur, réponse du routeur, adresse appliquée.
    const steps = trace.filter((entry) => entry.code.startsWith("dns.") || entry.code === "command.nslookup").map((entry) => [entry.deviceId, entry.code]);
    expect(steps).toEqual([
      ["pc1", "command.nslookup"],
      ["pc1", "dns.query-sent"],
      ["r1", "dns.answer-sent"],
      ["pc1", "dns.resolved"],
    ]);
    const [question, answer] = dnsOnWire(trace).filter((item, index, all) => all.findIndex((other) => other.dns === item.dns) === index);
    if (!question || !answer) throw new Error("question et réponse attendues sur le câble");
    expect(question).toMatchObject({ source: "192.168.1.10", destination: "192.168.1.1", udp: { destinationPort: 53 } });
    expect(question.udp.sourcePort).toBeGreaterThanOrEqual(49152);
    expect(question.udp.sourcePort).toBeLessThanOrEqual(65535);
    expect(question.dns).toMatchObject({ response: false, recursionDesired: true, question: { name: "srv.lab", type: "A" }, answers: [] });
    expect(answer).toMatchObject({ source: "192.168.1.1", destination: "192.168.1.10", udp: { sourcePort: 53, destinationPort: question.udp.sourcePort } });
    expect(answer.dns).toMatchObject({
      id: question.dns.id,
      response: true,
      authoritative: true,
      recursionAvailable: false,
      rcode: "no-error",
      answers: [{ name: "srv.lab", type: "A", ttl: 300, address: "10.0.0.10" }],
    });
    expect(dnsService(sim)).toEqual({ records: [{ name: "pc1.lab", address: "192.168.1.10" }, { name: "srv.lab", address: "10.0.0.10" }], answered: 1, nameErrors: 0 });
  });

  it("calcule la taille des messages à partir des champs modélisés (référence comptée à la main)", () => {
    const question: DnsMessage = { kind: "dns", id: 1, response: false, authoritative: false, recursionDesired: true, recursionAvailable: false, rcode: "no-error", question: { name: "srv.lab", type: "A" }, answers: [] };
    // En-tête 12 + nom (3 « srv » 3 « lab » 0 : 9) + type et classe 4.
    expect(dnsBytes(question)).toBe(25);
    // + réponse A : pointeur 2, type 2, classe 2, TTL 4, longueur 2, adresse 4.
    expect(dnsBytes({ ...question, response: true, answers: [{ name: "srv.lab", type: "A", ttl: 300, address: "10.0.0.10" }] })).toBe(41);
    const sim = start(dnsScenario());
    command(sim, { type: "nslookup", deviceId: "pc1", name: "srv.lab" });
    const [sent] = dnsOnWire(settle(sim));
    // Ethernet 14 + IPv4 20 + UDP 8 + DNS 25 + FCS 4.
    expect(sent && frameBytes(sent.frame)).toBe(71);
  });

  it("ping par nom : la résolution précède le premier écho, puis les échos visent l'adresse obtenue", () => {
    const sim = start(dnsScenario());
    const result = ping(sim, "pc1", "srv.lab", 2);
    const trace = settle(sim);
    expect(result()).toMatchObject({ destination: "srv.lab", address: "10.0.0.10", resolution: "resolved", done: true });
    expect(result()?.attempts.map((attempt) => [attempt.status, attempt.from])).toEqual([
      ["reply", "10.0.0.10"],
      ["reply", "10.0.0.10"],
    ]);
    const resolvedAt = find(trace, "dns.resolved", "pc1")[0]?.time ?? Number.POSITIVE_INFINITY;
    const sends = find(trace, "ping.send", "pc1").map((entry) => entry.time);
    expect(sends[0]).toBe(resolvedAt);
    expect(sends[1]).toBe(resolvedAt + fromSeconds(1));
    expect(find(trace, "ping.send", "pc1").every((entry) => entry.params["destination"] === "srv.lab")).toBe(true);
  });

  it("résout aussi pour un poste d'un autre réseau, qui interroge l'autre adresse du routeur", () => {
    const sim = start(dnsScenario());
    const result = ping(sim, "srv", "pc1.lab");
    const trace = settle(sim);
    expect(result()).toMatchObject({ address: "192.168.1.10", resolution: "resolved" });
    expect(result()?.attempts[0]?.status).toBe("reply");
    expect(dnsOnWire(trace).find((item) => item.dns.response)?.source).toBe("10.0.0.1");
  });

  it("un poste en DHCP résout avec le serveur DNS saisi manuellement", () => {
    let doc = dhcpScenario();
    doc = ok(setDnsServer(doc, { deviceId: "pc1", server: "192.168.1.1" }));
    doc = ok(setDnsRecord(doc, { deviceId: "r1", name: "pc3.lab", address: "10.0.0.2" }));
    const sim = start(doc);
    settle(sim);
    const result = ping(sim, "pc1", "pc3.lab");
    settle(sim);
    expect(result()).toMatchObject({ address: "10.0.0.2", resolution: "resolved" });
    expect(result()?.attempts[0]?.status).toBe("reply");
  });
});

describe("DNS : échecs observables", () => {
  it("nom inexistant : NXDOMAIN d'autorité, ping terminé sans écho", () => {
    const sim = start(dnsScenario());
    const id = command(sim, { type: "nslookup", deviceId: "pc1", name: "inconnu.lab" });
    const result = ping(sim, "pc1", "inconnu.lab");
    const trace = settle(sim);
    expect(lookup(sim, id)).toMatchObject({ status: "name-error", address: null, attempts: 1 });
    expect(find(trace, "dns.name-error-sent", "r1")).toHaveLength(2);
    const reply = dnsOnWire(trace).find((item) => item.dns.response);
    expect(reply?.dns).toMatchObject({ rcode: "name-error", authoritative: true, answers: [] });
    expect(result()).toMatchObject({ resolution: "name-error", address: null, done: true, attempts: [] });
    expect(find(trace, "ping.unresolved", "pc1")[0]?.params).toEqual({ name: "inconnu.lab", reason: "name-error" });
    expect(find(trace, "ping.send")).toEqual([]);
    expect(dnsService(sim)).toMatchObject({ answered: 0, nameErrors: 2 });
  });

  it("aucun serveur configuré : échec immédiat, rien n'est émis", () => {
    const sim = start(dnsScenario());
    const id = command(sim, { type: "nslookup", deviceId: "pc2", name: "srv.lab" });
    const trace = settle(sim);
    expect(lookup(sim, id)).toMatchObject({ server: null, status: "no-server", attempts: 0 });
    expect(find(trace, "dns.no-server", "pc2")).toHaveLength(1);
    expect(find(trace, "eth.transmit")).toEqual([]);
  });

  it("service désactivé : port 53 fermé, retransmission à 5 s, abandon à 15 s", () => {
    const sim = start(dnsScenario({ serviceDisabled: true }));
    const result = ping(sim, "pc1", "srv.lab");
    const trace = settle(sim);
    expect(find(trace, "udp.no-service", "r1").map((entry) => entry.params["destinationPort"])).toEqual([53, 53]);
    expect(find(trace, "dns.query-sent", "pc1").map((entry) => [entry.time, entry.params["attempt"]])).toEqual([
      [0, 1],
      [fromSeconds(5), 2],
    ]);
    expect(find(trace, "dns.gave-up", "pc1").map((entry) => entry.time)).toEqual([fromSeconds(15)]);
    // Même identifiant et même port source pour la retransmission.
    const questions = dnsOnWire(trace).filter((item) => !item.dns.response);
    expect(new Set(questions.map((item) => `${String(item.dns.id)}:${String(item.udp.sourcePort)}`)).size).toBe(1);
    expect(result()).toMatchObject({ resolution: "timeout", done: true, attempts: [] });
    expect(sim.snapshot().activity).toBe(false);
  });

  it("serveur hors d'atteinte sans passerelle : question impossible à émettre", () => {
    let doc = ok(setDnsServer(dnsScenario(), { deviceId: "pc2", server: "10.0.0.1" }));
    doc = ok(setDefaultGateway(doc, { deviceId: "pc2", gateway: null }));
    const sim = start(doc);
    const id = command(sim, { type: "nslookup", deviceId: "pc2", name: "srv.lab" });
    const trace = settle(sim);
    expect(lookup(sim, id)).toMatchObject({ status: "no-route", attempts: 1 });
    expect(find(trace, "dns.send-failed", "pc2")[0]?.params).toMatchObject({ reason: "no-route" });
    expect(find(trace, "dns.query-sent", "pc2")).toHaveLength(1);
  });

  it("poste en DHCP encore sans adresse : question impossible à émettre faute d'adresse", () => {
    let doc = ok(setInterfaceDhcp(dnsScenario(), { deviceId: "pc1", portId: "eth0", enabled: true }));
    doc = ok(setDnsServer(doc, { deviceId: "pc1", server: "192.168.1.1" }));
    const sim = start(doc);
    const id = command(sim, { type: "nslookup", deviceId: "pc1", name: "srv.lab" });
    sim.run({ until: 0, maxEvents: 10_000 });
    expect(lookup(sim, id)?.status).toBe("no-address");
  });

  it("perte du lien vers le serveur : aucune réponse, abandon après les retransmissions", () => {
    const sim = start(dnsScenario());
    command(sim, { type: "set-link", linkId: "l3", up: false });
    const id = command(sim, { type: "nslookup", deviceId: "pc1", name: "srv.lab" });
    settle(sim);
    expect(lookup(sim, id)).toMatchObject({ status: "timeout", attempts: 2 });
  });
});

describe("DNS : commandes et déterminisme", () => {
  it("refuse un nom invalide, un équipement qui n'est pas un PC et trop de résolutions simultanées", () => {
    const sim = start(dnsScenario(), { parameters: { limits: { maxDnsLookups: 2 } } });
    expect(sim.enqueue({ type: "nslookup", deviceId: "pc1", name: "srv_lab" })).toMatchObject({ ok: false, code: "command.invalid-name" });
    expect(sim.enqueue({ type: "nslookup", deviceId: "r1", name: "srv.lab" })).toMatchObject({ ok: false, code: "command.not-a-pc" });
    expect(sim.enqueue({ type: "ping", deviceId: "pc1", destination: "10.0.0" })).toMatchObject({ ok: false, code: "command.invalid-destination", params: { reason: "format" } });
    command(sim, { type: "nslookup", deviceId: "pc1", name: "srv.lab" });
    command(sim, { type: "nslookup", deviceId: "pc1", name: "pc1.lab" });
    expect(sim.enqueue({ type: "nslookup", deviceId: "pc1", name: "srv.lab" })).toMatchObject({ ok: false, code: "command.too-many-lookups", params: { max: 2 } });
    // Une fois les résolutions terminées, la limite est libérée.
    settle(sim);
    expect(sim.enqueue({ type: "nslookup", deviceId: "pc1", name: "srv.lab" }).ok).toBe(true);
  });

  it("deux résolutions simultanées utilisent des ports sources distincts", () => {
    const sim = start(dnsScenario());
    command(sim, { type: "nslookup", deviceId: "pc1", name: "srv.lab" });
    command(sim, { type: "nslookup", deviceId: "pc1", name: "pc1.lab" });
    const questions = dnsOnWire(settle(sim)).filter((item) => !item.dns.response);
    expect(new Set(questions.map((item) => item.udp.sourcePort)).size).toBe(2);
    expect(sim.snapshot().lookups.map((view) => [view.name, view.address])).toEqual([
      ["srv.lab", "10.0.0.10"],
      ["pc1.lab", "192.168.1.10"],
    ]);
  });

  it("produit la même trace pour la même graine, et des identifiants différents pour une autre graine", () => {
    const run = (seed: number) => {
      const sim = start(dnsScenario(), { seed });
      command(sim, { type: "nslookup", deviceId: "pc1", name: "srv.lab" });
      ping(sim, "srv", "pc1.lab");
      return settle(sim);
    };
    expect(JSON.stringify(run(7))).toBe(JSON.stringify(run(7)));
    const ids = (trace: TraceEntry[]) => find(trace, "dns.query-sent").map((entry) => [entry.params["id"], entry.params["sourcePort"]]);
    expect(ids(run(7))).not.toEqual(ids(run(8)));
  });

  it("ne modifie pas le projet et rejoue la session à partir du journal des commandes", () => {
    const doc = dnsScenario();
    const original = JSON.stringify(doc);
    const sim = start(doc);
    command(sim, { type: "nslookup", deviceId: "pc1", name: "srv.lab" });
    ping(sim, "pc1", "pc1.lab");
    const trace = settle(sim);
    expect(JSON.stringify(doc)).toBe(original);
    expect(sim.commandLog.map((item) => item.command)).toEqual([
      { type: "nslookup", deviceId: "pc1", name: "srv.lab" },
      { type: "ping", deviceId: "pc1", destination: "pc1.lab", count: 1 },
    ]);
    const replay = start(doc);
    for (const item of sim.commandLog) command(replay, item.command);
    expect(JSON.stringify(settle(replay))).toBe(JSON.stringify(trace));
  });
});
