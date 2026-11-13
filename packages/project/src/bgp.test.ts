import { describe, expect, it } from "vitest";
import { isBgpAs } from "./bgp.js";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { setBgpAs, setBgpNeighbor, setBgpNetwork, setInterfaceIpv4 } from "./commands.js";
import type { NfgDocument } from "./schema.js";
import { expectOk, projectWith } from "./test-helpers.js";
import { validateDocument } from "./validation.js";

const codes = (result: { ok: boolean; errors?: Array<{ code: string }> }) => result.errors?.map((issue) => issue.code);

function session(doc: NfgDocument, deviceId: string, lines: readonly string[]): NfgDocument {
  let mode: CliMode = OPERATION_MODE;
  let current = doc;
  for (const line of lines) {
    const result = interpret(current, deviceId, mode, line);
    mode = result.mode;
    if (!result.ok) throw new Error(`refus : ${line} ${JSON.stringify(result.error ?? result.issues)}`);
    if (result.edit) current = expectOk(result.edit(current));
  }
  return current;
}

/** Routeur r1 : ge0 en 10.1.0.1/24 (réseau de postes), ge1 en 10.12.0.1/30 (lien vers l'AS voisin) ; switch sw1. */
function base(): NfgDocument {
  let doc = projectWith(["r1", "R-200"], ["sw1", "S-24"]);
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "10.1.0.1", prefixLength: 24 } }));
  return expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: { address: "10.12.0.1", prefixLength: 30 } }));
}

function configured(): NfgDocument {
  let doc = expectOk(setBgpAs(base(), { deviceId: "r1", as: 65001 }));
  doc = expectOk(setBgpNeighbor(doc, { deviceId: "r1", address: "10.12.0.2", remoteAs: 65002 }));
  return expectOk(setBgpNetwork(doc, { deviceId: "r1", network: { address: "10.1.0.0", prefixLength: 24 }, present: true }));
}

describe("BGP : configuration d'un routeur", () => {
  it("accepte un AS de 1 à 65535 (champ de 2 octets de l'OPEN)", () => {
    expect([1, 65001, 65535].every(isBgpAs)).toBe(true);
    expect([0, 65536, 1.5].some(isBgpAs)).toBe(false);
  });

  it("active BGP, ajoute un voisin et un réseau, puis les retire ; désactiver efface tout", () => {
    const doc = configured();
    expect(doc.configurations["r1"]?.bgp).toEqual({ as: 65001, neighbors: [{ address: "10.12.0.2", remoteAs: 65002 }], networks: [{ address: "10.1.0.0", prefixLength: 24 }] });
    expect(validateDocument(doc)).toEqual([]);
    // Changer d'AS conserve voisins et réseaux.
    expect(expectOk(setBgpAs(doc, { deviceId: "r1", as: 65010 })).configurations["r1"]?.bgp?.neighbors).toHaveLength(1);
    const withoutNeighbor = expectOk(setBgpNeighbor(doc, { deviceId: "r1", address: "10.12.0.2", remoteAs: null }));
    expect(withoutNeighbor.configurations["r1"]?.bgp?.neighbors).toEqual([]);
    expect(expectOk(setBgpNetwork(doc, { deviceId: "r1", network: { address: "10.1.0.0", prefixLength: 24 }, present: false })).configurations["r1"]?.bgp?.networks).toEqual([]);
    expect(expectOk(setBgpAs(doc, { deviceId: "r1", as: null })).configurations["r1"]?.bgp).toBeNull();
  });

  it("refuse BGP hors d'un routeur, un voisin interne ou en double, un réseau mal formé ou en double", () => {
    expect(codes(setBgpAs(base(), { deviceId: "sw1", as: 65001 }))).toEqual(["bgp.not-supported"]);
    expect(codes(setBgpAs(base(), { deviceId: "r1", as: 70000 }))).toEqual(["bgp.invalid-as"]);
    expect(codes(setBgpNeighbor(base(), { deviceId: "r1", address: "10.12.0.2", remoteAs: 65002 }))).toEqual(["bgp.not-enabled"]);
    const doc = configured();
    expect(codes(setBgpNeighbor(doc, { deviceId: "r1", address: "10.12.0.2", remoteAs: 65001 }))).toEqual(["bgp.internal-neighbor"]);
    expect(codes(setBgpNeighbor(doc, { deviceId: "r1", address: "10.99.0.9", remoteAs: null }))).toEqual(["bgp.neighbor-not-found"]);
    expect(codes(setBgpNetwork(doc, { deviceId: "r1", network: { address: "10.1.0.1", prefixLength: 24 }, present: true }))).toEqual(["bgp.not-network-address"]);
    expect(codes(setBgpNetwork(doc, { deviceId: "r1", network: { address: "10.1.0.0", prefixLength: 24 }, present: true }))).toEqual(["bgp.duplicate-network"]);
  });

  it("avertit d'un voisin hors des réseaux directement connectés (eBGP à un saut)", () => {
    const result = setBgpNeighbor(configured(), { deviceId: "r1", address: "10.99.0.2", remoteAs: 65009 });
    expect(result.ok && result.warnings.map((issue) => [issue.code, issue.params["address"]])).toEqual([["bgp.neighbor-not-connected", "10.99.0.2"]]);
  });
});

describe("BGP : console équivalente aux formulaires", () => {
  it("bgp as, neighbor, network et leurs retraits donnent les mêmes documents", () => {
    const doc = base();
    const viaCli = session(doc, "r1", ["configure", "bgp as 65001", "bgp neighbor 10.12.0.2 remote-as 65002", "bgp network 10.1.0.0/24"]);
    expect(viaCli).toEqual(configured());
    expect(session(viaCli, "r1", ["configure", "bgp network 10.1.0.0 255.255.255.0 delete"]).configurations["r1"]?.bgp?.networks).toEqual([]);
    expect(session(viaCli, "r1", ["configure", "bgp neighbor 10.12.0.2 delete"]).configurations["r1"]?.bgp?.neighbors).toEqual([]);
    expect(session(viaCli, "r1", ["configure", "bgp disable"]).configurations["r1"]?.bgp).toBeNull();
    const show = interpret(doc, "r1", OPERATION_MODE, "show bgp");
    expect(show.ok && show.request).toEqual({ kind: "show-bgp" });
  });

  it("explique un AS invalide, un mot-clé manquant ou inconnu", () => {
    const config: CliMode = { kind: "config" };
    const refusal = (line: string) => {
      const result = interpret(configured(), "r1", config, line);
      return result.ok ? null : (result.error?.code ?? result.issues.map((issue) => issue.code));
    };
    expect(refusal("bgp as 0")).toEqual(["bgp.invalid-as"]);
    expect(refusal("bgp neighbor 10.12.0.2")).toBe("cli.missing-argument");
    expect(refusal("bgp neighbor 10.12.0.2 remote 65002")).toBe("cli.unexpected-argument");
    expect(refusal("bgp neighbor 10.12.0.2 remote-as")).toBe("cli.missing-argument");
    expect(refusal("bgp network 10.1.0.0/24 maintenant")).toBe("cli.unexpected-argument");
  });

  it("réécrit BGP en commandes rejouables sur un routeur vierge", () => {
    const doc = configured();
    const lines = configurationCommands(doc, "r1");
    expect(lines).toEqual(expect.arrayContaining(["bgp as 65001", "bgp neighbor 10.12.0.2 remote-as 65002", "bgp network 10.1.0.0/24"]));
    const blank = projectWith(["r1", "R-200"], ["sw1", "S-24"]);
    expect(session(blank, "r1", lines).configurations["r1"]).toEqual(doc.configurations["r1"]);
  });
});
