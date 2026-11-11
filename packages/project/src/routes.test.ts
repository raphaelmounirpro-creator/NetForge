import { describe, expect, it } from "vitest";
import { addStaticRoute, connectDevices, parseRouteInput, removeStaticRoute, setInterfaceIpv4, type CommandResult } from "./commands.js";
import { LIMITS, type NfgDocument } from "./schema.js";
import { expectOk, projectWith } from "./test-helpers.js";

/** R1 : ge0 = 192.168.1.1/24, ge1 = 10.0.12.1/30 ; un PC et un switch pour les refus. */
function routerProject(): NfgDocument {
  let doc = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
  return expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: { address: "10.0.12.1", prefixLength: 30 } }));
}

const route = (destination: string, prefixLength: number, nextHop: string) => ({ destination, prefixLength, nextHop });
const codes = (result: CommandResult) => (result.ok ? result.warnings : result.errors).map((issue) => issue.code);

describe("routes statiques", () => {
  it("ajoute une route vers un réseau distant via un voisin connecté", () => {
    const doc = expectOk(addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.0", 24, "10.0.12.2") }));
    expect(doc.configurations["r1"]?.staticRoutes).toEqual([route("10.0.2.0", 24, "10.0.12.2")]);
  });

  it("accepte une route par défaut 0.0.0.0/0", () => {
    const result = addStaticRoute(routerProject(), { deviceId: "r1", route: route("0.0.0.0", 0, "10.0.12.2") });
    expect(result.ok).toBe(true);
    expect(codes(result)).toEqual([]);
  });

  it("refuse une route sur un PC ou un switch", () => {
    for (const deviceId of ["pc1", "sw1"]) {
      expect(codes(addStaticRoute(routerProject(), { deviceId, route: route("10.0.2.0", 24, "192.168.1.254") }))).toEqual([
        "config.routes-not-supported",
      ]);
    }
  });

  it("refuse une destination qui n'est pas l'adresse du réseau et indique la bonne", () => {
    const result = addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.7", 24, "10.0.12.2") });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatchObject({ code: "route.not-network-address", params: { network: "10.0.2.0" } });
  });

  it("refuse deux routes vers le même réseau (pas de partage de charge)", () => {
    const doc = expectOk(addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.0", 24, "10.0.12.2") }));
    expect(codes(addStaticRoute(doc, { deviceId: "r1", route: route("10.0.2.0", 24, "192.168.1.254") }))).toEqual(["route.duplicate"]);
    // Même adresse, préfixe différent : réseau différent, accepté.
    expect(addStaticRoute(doc, { deviceId: "r1", route: route("10.0.0.0", 16, "10.0.12.2") }).ok).toBe(true);
  });

  it("refuse un prochain saut qui n'est pas une adresse d'hôte", () => {
    const cases: Array<[string, string]> = [
      ["127.0.0.1", "loopback"],
      ["224.0.0.5", "multicast"],
      ["0.0.0.0", "this-network"],
      ["192.168.1.255", "broadcast-address"],
      ["10.0.12.0", "network-address"],
    ];
    for (const [nextHop, reason] of cases) {
      const result = addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.0", 24, nextHop) });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toMatchObject({ code: "route.invalid-next-hop", params: { reason } });
    }
  });

  it("refuse un prochain saut égal à une adresse du routeur lui-même", () => {
    expect(codes(addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.0", 24, "192.168.1.1") }))).toEqual([
      "route.next-hop-is-own-address",
    ]);
  });

  it("accepte un prochain saut hors des réseaux connectés avec un avertissement (route inactive)", () => {
    const result = addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.0", 24, "172.16.0.2") });
    expect(result.ok).toBe(true);
    expect(codes(result)).toEqual(["route.next-hop-not-connected"]);
  });

  it("limite le nombre de routes par routeur", () => {
    let doc = routerProject();
    for (let index = 0; index < LIMITS.maxStaticRoutes; index += 1) {
      doc = expectOk(addStaticRoute(doc, { deviceId: "r1", route: route(`10.${String(index)}.0.0`, 16, "10.0.12.2") }));
    }
    expect(codes(addStaticRoute(doc, { deviceId: "r1", route: route("172.16.0.0", 16, "10.0.12.2") }))).toEqual(["route.too-many"]);
  });

  it("retire une route identifiée par sa destination et son préfixe", () => {
    let doc = expectOk(addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.0", 24, "10.0.12.2") }));
    doc = expectOk(addStaticRoute(doc, { deviceId: "r1", route: route("10.0.3.0", 24, "10.0.12.2") }));
    doc = expectOk(removeStaticRoute(doc, { deviceId: "r1", destination: "10.0.2.0", prefixLength: 24 }));
    expect(doc.configurations["r1"]?.staticRoutes).toEqual([route("10.0.3.0", 24, "10.0.12.2")]);
    expect(codes(removeStaticRoute(doc, { deviceId: "r1", destination: "10.0.2.0", prefixLength: 24 }))).toEqual(["route.not-found"]);
  });

  it("ne signale plus le prochain saut une fois son réseau connecté", () => {
    let doc = projectWith(["r1", "R-200"]);
    const pending = addStaticRoute(doc, { deviceId: "r1", route: route("10.0.2.0", 24, "10.0.12.2") });
    expect(codes(pending)).toEqual(["route.next-hop-not-connected"]);
    doc = expectOk(pending);
    const configured = setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: { address: "10.0.12.1", prefixLength: 30 } });
    expect(codes(configured)).toEqual([]);
  });

  it("conserve les routes quand un lien est ajouté", () => {
    let doc = expectOk(addStaticRoute(routerProject(), { deviceId: "r1", route: route("10.0.2.0", 24, "10.0.12.2") }));
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "r1", bDeviceId: "sw1" }));
    expect(doc.configurations["r1"]?.staticRoutes).toHaveLength(1);
  });
});

describe("saisie d'une route", () => {
  it("accepte un masque décimal, un préfixe ou une barre oblique", () => {
    for (const mask of ["255.255.255.0", "24", "/24"]) {
      expect(parseRouteInput(" 10.0.2.0 ", mask, "10.0.12.2 ")).toEqual({ ok: true, route: route("10.0.2.0", 24, "10.0.12.2") });
    }
  });

  it("signale chaque champ invalide", () => {
    const result = parseRouteInput("10.0.2", "255.0.255.0", "routeur");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((issue) => issue.code)).toEqual(["ipv4.invalid-address", "ipv4.invalid-mask", "ipv4.invalid-address"]);
    }
  });
});
