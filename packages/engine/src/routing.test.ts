import { addStaticRoute, setDefaultGateway, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { routedScenario, twoRoutersScenario } from "./scenarios.js";
import { command, find, ping, settle, start } from "./test-support/helpers.js";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

describe("destination distante via un routeur", () => {
  it("utilise la passerelle et résout l'adresse du prochain saut, pas celle de la destination", () => {
    const sim = start(routedScenario());
    const view = ping(sim, "pc1", "192.168.2.10");
    const trace = settle(sim);

    expect(find(trace, "ip.route", "pc1")[0]?.params).toMatchObject({
      routeKind: "gateway",
      route: "0.0.0.0/0",
      nextHop: "192.168.1.1",
      outPort: "eth0",
    });
    // PC1 cherche la MAC du routeur ; le routeur cherche celle de PC2.
    expect(find(trace, "arp.request-sent", "pc1").map((entry) => entry.params["targetIp"])).toEqual(["192.168.1.1"]);
    expect(find(trace, "arp.request-sent", "r1").map((entry) => entry.params["targetIp"])).toEqual(["192.168.2.10"]);

    const forward = find(trace, "ip.forward", "r1");
    expect(forward[0]?.params).toMatchObject({ route: "192.168.2.0/24", routeKind: "connected", nextHop: null, outPort: "ge1", ttl: 63 });
    expect(forward[1]?.params).toMatchObject({ route: "192.168.1.0/24", outPort: "ge0", ttl: 63 });

    expect(view()?.attempts[0]).toMatchObject({ status: "reply", from: "192.168.2.10", ttl: 63 });
  });

  it("traverse deux routeurs grâce aux routes statiques", () => {
    const sim = start(twoRoutersScenario());
    const view = ping(sim, "pc1", "10.0.2.10", 2);
    const trace = settle(sim);
    expect(find(trace, "ip.forward", "r1")[0]?.params).toMatchObject({ route: "10.0.2.0/24", routeKind: "static", nextHop: "10.0.12.2" });
    expect(view()?.attempts.map((attempt) => [attempt.status, attempt.ttl])).toEqual([
      ["reply", 62],
      ["reply", 62],
    ]);
  });

  it("préfère le plus long préfixe à la route par défaut", () => {
    let doc = twoRoutersScenario({ r1Route: false });
    doc = ok(addStaticRoute(doc, { deviceId: "r1", route: { destination: "0.0.0.0", prefixLength: 0, nextHop: "10.0.12.2" } }));
    doc = ok(addStaticRoute(doc, { deviceId: "r1", route: { destination: "10.0.2.0", prefixLength: 25, nextHop: "10.0.12.2" } }));
    const sim = start(doc);
    ping(sim, "pc1", "10.0.2.10");
    const trace = settle(sim);
    expect(find(trace, "ip.forward", "r1")[0]?.params).toMatchObject({ route: "10.0.2.0/25" });
  });
});

describe("échecs expliqués", () => {
  it("PC sans passerelle : aucune route, aucune trame émise", () => {
    const doc = ok(setDefaultGateway(routedScenario(), { deviceId: "pc1", gateway: null }));
    const sim = start(doc);
    const view = ping(sim, "pc1", "192.168.2.10");
    const trace = settle(sim);
    expect(find(trace, "ip.no-route", "pc1")[0]?.params).toMatchObject({ reason: "no-gateway", gateway: null });
    expect(find(trace, "eth.transmit")).toEqual([]);
    expect(view()?.attempts[0]).toMatchObject({ status: "failed", failure: "no-route" });
  });

  it("passerelle hors du réseau : route inactive, échec expliqué", () => {
    const doc = ok(setDefaultGateway(routedScenario(), { deviceId: "pc1", gateway: "10.9.9.9" }));
    const sim = start(doc);
    ping(sim, "pc1", "192.168.2.10");
    const trace = settle(sim);
    expect(find(trace, "ip.no-route", "pc1")[0]?.params).toMatchObject({ reason: "gateway-unreachable", gateway: "10.9.9.9" });
    const routes = sim.snapshot().devices.find((device) => device.deviceId === "pc1")?.routes;
    expect(routes).toContainEqual(expect.objectContaining({ kind: "gateway", active: false, reason: "next-hop-unreachable" }));
  });

  it("routeur sans route : il abandonne le paquet et le signale par ICMP (réseau inaccessible)", () => {
    const sim = start(twoRoutersScenario({ r1Route: false }));
    const view = ping(sim, "pc1", "10.0.2.10");
    const trace = settle(sim);
    expect(find(trace, "ip.no-route", "r1")[0]?.params).toMatchObject({ destination: "10.0.2.10", reason: "no-match" });
    expect(find(trace, "icmp.error-sent", "r1")[0]?.params).toMatchObject({ type: "destination-unreachable", code: 0, destination: "10.0.1.10" });
    expect(view()?.attempts[0]).toMatchObject({ status: "error", from: "10.0.1.1", errorType: "destination-unreachable", errorCode: 0 });
  });

  it("retour impossible depuis la destination : la cause est identifiable chez PC2", () => {
    const doc = ok(setDefaultGateway(routedScenario(), { deviceId: "pc2", gateway: null }));
    const sim = start(doc);
    const view = ping(sim, "pc1", "192.168.2.10");
    const trace = settle(sim);
    // L'aller fonctionne : PC2 reçoit l'écho…
    expect(find(trace, "icmp.echo-request", "pc2")).toHaveLength(1);
    // … mais ne peut pas répondre faute de route vers 192.168.1.10.
    const noRoute = find(trace, "ip.no-route", "pc2");
    expect(noRoute).toEqual([
      expect.objectContaining({ exchange: "ping-1#1", params: expect.objectContaining({ destination: "192.168.1.10", reason: "no-gateway" }) as unknown }),
    ]);
    expect(view()?.attempts[0]?.status).toBe("timeout");
  });

  it("retour impossible depuis un routeur intermédiaire : R2 ne connaît pas le réseau de PC1", () => {
    const sim = start(twoRoutersScenario({ r2Route: false }));
    const view = ping(sim, "pc1", "10.0.2.10");
    const trace = settle(sim);
    expect(find(trace, "icmp.echo-request", "pc2")).toHaveLength(1);
    expect(find(trace, "ip.no-route", "r2")[0]?.params).toMatchObject({ destination: "10.0.1.10", reason: "no-match" });
    // R2 prévient PC2 (source de la réponse), jamais PC1 : le ping expire.
    expect(find(trace, "icmp.error-sent", "r2")[0]?.params).toMatchObject({ destination: "10.0.2.10" });
    expect(find(trace, "icmp.error-received", "pc2")).toHaveLength(1);
    expect(view()?.attempts[0]?.status).toBe("timeout");
  });

  it("boucle de routage : le TTL s'épuise et le routeur renvoie « temps dépassé »", () => {
    let doc = twoRoutersScenario();
    doc = ok(addStaticRoute(doc, { deviceId: "r1", route: { destination: "10.0.9.0", prefixLength: 24, nextHop: "10.0.12.2" } }));
    doc = ok(addStaticRoute(doc, { deviceId: "r2", route: { destination: "10.0.9.0", prefixLength: 24, nextHop: "10.0.12.1" } }));
    const sim = start(doc);
    const view = ping(sim, "pc1", "10.0.9.9");
    const trace = settle(sim);
    // TTL 64 au départ : les routeurs reçoivent 64, 63… 2 et relaient (63 fois) ;
    // le 64e saut (R2, sauts pairs) reçoit TTL 1 et abandonne. R1 relaie ensuite l'erreur vers PC1.
    const echoForwards = find(trace, "ip.forward").filter((entry) => entry.pdu?.kind === "ipv4" && entry.pdu.payload.type === "echo-request");
    expect(echoForwards).toHaveLength(63);
    expect(find(trace, "ip.forward").length - echoForwards.length).toBe(1);
    expect(find(trace, "ip.ttl-expired")).toEqual([expect.objectContaining({ deviceId: "r2", params: { ttl: 1 } })]);
    expect(view()?.attempts[0]).toMatchObject({ status: "error", errorType: "time-exceeded", errorCode: 0, from: "10.0.12.2" });
  });

  it("routeur : hôte absent du réseau de destination, « hôte inaccessible » après l'échec ARP", () => {
    const sim = start(routedScenario());
    const view = ping(sim, "pc1", "192.168.2.99");
    const trace = settle(sim);
    expect(find(trace, "arp.failed", "r1")[0]?.params).toMatchObject({ ip: "192.168.2.99", attempts: 3, dropped: 1 });
    expect(find(trace, "icmp.error-sent", "r1")[0]?.params).toMatchObject({ type: "destination-unreachable", code: 1 });
    expect(view()?.attempts[0]).toMatchObject({ status: "error", errorCode: 1, from: "192.168.1.1" });
  });

  it("n'envoie jamais d'erreur ICMP au sujet d'une erreur ICMP", () => {
    // R2 n'a pas de route vers 10.0.9.0/24 et prévient PC1 ; entre-temps le lien PC1–R1 tombe :
    // R1 ne peut plus relayer l'erreur et l'abandonne sans produire une nouvelle erreur.
    const doc = ok(addStaticRoute(twoRoutersScenario(), { deviceId: "r1", route: { destination: "10.0.9.0", prefixLength: 24, nextHop: "10.0.12.2" } }));
    const sim = start(doc);
    ping(sim, "pc1", "10.0.9.9");
    let forwarded = false;
    for (let index = 0; index < 100 && !forwarded; index += 1) {
      forwarded = find(sim.step().trace, "ip.forward", "r1").length > 0;
    }
    expect(forwarded).toBe(true);
    command(sim, { type: "set-link", linkId: "l1", up: false });
    const trace = settle(sim);
    expect(find(trace, "icmp.error-sent", "r2")[0]?.params).toMatchObject({ type: "destination-unreachable", code: 0 });
    expect(find(trace, "ip.no-route", "r1")[0]?.params).toMatchObject({ destination: "10.0.1.10" });
    expect(find(trace, "icmp.error-suppressed", "r1")).toHaveLength(1);
    expect(find(trace, "icmp.error-sent", "r1")).toHaveLength(0);
  });

  it("routeur : abandonne un paquet vers l'adresse de diffusion d'un réseau connecté", () => {
    const sim = start(routedScenario());
    ping(sim, "pc1", "192.168.2.255");
    const trace = settle(sim);
    expect(find(trace, "ip.broadcast-dropped", "r1")).toHaveLength(1);
  });
});
