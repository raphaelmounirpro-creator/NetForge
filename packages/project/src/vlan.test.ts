import { describe, expect, it } from "vitest";
import { connectPorts, setInterfaceIpv4, setSwitchport } from "./commands.js";
import { expectOk, projectWith } from "./test-helpers.js";
import { validateDocument } from "./validation.js";
import { carriesVlan, formatVlanList, parseSubinterface, parseVlanList, switchportOf } from "./vlan.js";

const codes = (result: { ok: boolean; errors?: Array<{ code: string }> }) => result.errors?.map((issue) => issue.code);
const warnings = (doc: Parameters<typeof validateDocument>[0]) => validateDocument(doc).filter((issue) => issue.severity === "warning").map((issue) => issue.code);

describe("listes de VLAN et sous-interfaces", () => {
  it("lit et écrit les listes avec plages", () => {
    expect(parseVlanList("10, 20,30-33")).toEqual([10, 20, 30, 31, 32, 33]);
    expect(parseVlanList("ALL")).toBe("all");
    expect(parseVlanList("20,10,10")).toEqual([10, 20]);
    for (const invalid of ["", "0", "4095", "10-5", "abc", "10,,20"]) expect(parseVlanList(invalid), invalid).toBeNull();
    expect(formatVlanList([30, 10, 31, 32, 20, 21])).toBe("10,20,21,30-32");
    expect(formatVlanList("all")).toBe("all");
  });

  it("reconnaît une sous-interface « port.vlan » seulement pour un VLAN valide écrit sans zéro initial", () => {
    expect(parseSubinterface("ge0.10")).toEqual({ parent: "ge0", vlan: 10 });
    for (const invalid of ["ge0", "ge0.0", "ge0.4095", "ge0.010", "ge0.", ".10"]) expect(parseSubinterface(invalid), invalid).toBeNull();
  });

  it("transporte un VLAN : accès (le sien), trunk (natif ou autorisé)", () => {
    expect(carriesVlan({ mode: "access", vlan: 10 }, 10)).toBe(true);
    expect(carriesVlan({ mode: "access", vlan: 10 }, 20)).toBe(false);
    const trunk = { mode: "trunk", nativeVlan: 99, allowedVlans: [10, 20] } as const;
    expect([10, 20, 99, 30].map((vlan) => carriesVlan(trunk, vlan))).toEqual([true, true, true, false]);
    expect(carriesVlan({ mode: "trunk", nativeVlan: 1, allowedVlans: "all" }, 4094)).toBe(true);
    expect(switchportOf({}, "ge1")).toEqual({ mode: "access", vlan: 1 });
  });
});

describe("ports de switch", () => {
  it("enregistre accès et trunk ; l'accès au VLAN 1 revient au défaut (aucune entrée)", () => {
    let doc = projectWith(["sw1", "S-24"]);
    doc = expectOk(setSwitchport(doc, { deviceId: "sw1", portId: "ge1", switchport: { mode: "access", vlan: 10 } }));
    doc = expectOk(setSwitchport(doc, { deviceId: "sw1", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 99, allowedVlans: [20, 10, 20] } }));
    expect(doc.configurations["sw1"]?.switchports).toEqual({ ge1: { mode: "access", vlan: 10 }, ge24: { mode: "trunk", nativeVlan: 99, allowedVlans: [10, 20] } });
    doc = expectOk(setSwitchport(doc, { deviceId: "sw1", portId: "ge1", switchport: { mode: "access", vlan: 1 } }));
    doc = expectOk(setSwitchport(doc, { deviceId: "sw1", portId: "ge24", switchport: null }));
    expect(doc.configurations["sw1"]?.switchports).toEqual({});
  });

  it("refuse un VLAN hors de 1 à 4094, un port inconnu ou un équipement qui n'est pas un switch", () => {
    const doc = projectWith(["sw1", "S-24"], ["r1", "R-200"]);
    expect(codes(setSwitchport(doc, { deviceId: "sw1", portId: "ge1", switchport: { mode: "access", vlan: 4095 } }))).toEqual(["vlan.invalid-id"]);
    expect(codes(setSwitchport(doc, { deviceId: "sw1", portId: "ge1", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: [] } }))).toEqual(["vlan.invalid-id"]);
    expect(codes(setSwitchport(doc, { deviceId: "sw1", portId: "ge99", switchport: { mode: "access", vlan: 10 } }))).toEqual(["config.unknown-port"]);
    expect(codes(setSwitchport(doc, { deviceId: "r1", portId: "ge0", switchport: { mode: "access", vlan: 10 } }))).toEqual(["config.switchports-not-supported"]);
  });
});

describe("sous-interfaces de routeur", () => {
  it("s'adressent comme une interface, sur un routeur seulement, avec un port parent existant", () => {
    let doc = projectWith(["r1", "R-200"], ["pc1", "PC"]);
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0.10", ipv4: { address: "192.168.10.1", prefixLength: 24 } }));
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0.20", ipv4: { address: "192.168.20.1", prefixLength: 24 } }));
    expect(Object.keys(doc.configurations["r1"]?.interfaces ?? {})).toEqual(["ge0.10", "ge0.20"]);
    expect(codes(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0.10", ipv4: { address: "192.168.30.1", prefixLength: 24 } }))).toEqual(["config.subinterface-not-supported"]);
    expect(codes(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge9.10", ipv4: { address: "192.168.30.1", prefixLength: 24 } }))).toEqual(["config.unknown-port"]);
    expect(codes(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0.0", ipv4: { address: "192.168.30.1", prefixLength: 24 } }))).toEqual(["config.invalid-subinterface"]);
    // Deux sous-interfaces dans des réseaux qui se chevauchent : refusé comme deux ports.
    expect(codes(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1.30", ipv4: { address: "192.168.10.2", prefixLength: 24 } }))).toEqual(["ipv4.overlap"]);
  });
});

describe("avertissements VLAN", () => {
  function twoSwitches() {
    let doc = projectWith(["sw1", "S-24"], ["sw2", "S-24"]);
    doc = expectOk(connectPorts(doc, { linkId: "l1", a: { deviceId: "sw1", portId: "ge24" }, b: { deviceId: "sw2", portId: "ge24" } }));
    return doc;
  }

  it("signalent un lien entre switches en accès d'un côté et trunk de l'autre, puis des VLAN natifs différents", () => {
    let doc = expectOk(setSwitchport(twoSwitches(), { deviceId: "sw1", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: "all" } }));
    expect(warnings(doc)).toEqual(["vlan.mode-mismatch"]);
    doc = expectOk(setSwitchport(doc, { deviceId: "sw2", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 99, allowedVlans: "all" } }));
    expect(warnings(doc)).toEqual(["vlan.native-mismatch"]);
    doc = expectOk(setSwitchport(doc, { deviceId: "sw2", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: "all" } }));
    expect(warnings(doc)).toEqual([]);
  });

  it("signalent des sous-interfaces de routeur reliées à un port d'accès", () => {
    let doc = projectWith(["r1", "R-200"], ["sw1", "S-24"]);
    doc = expectOk(connectPorts(doc, { linkId: "l1", a: { deviceId: "r1", portId: "ge0" }, b: { deviceId: "sw1", portId: "ge24" } }));
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0.10", ipv4: { address: "192.168.10.1", prefixLength: 24 } }));
    expect(warnings(doc)).toEqual(["vlan.subinterfaces-on-access-port"]);
    doc = expectOk(setSwitchport(doc, { deviceId: "sw1", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 1, allowedVlans: [10] } }));
    expect(warnings(doc)).toEqual([]);
  });
});
