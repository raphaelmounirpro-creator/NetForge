import { describe, expect, it } from "vitest";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { setInterfaceIpv4, setVrrpGroup } from "./commands.js";
import type { NfgDocument } from "./schema.js";
import { expectOk, projectWith } from "./test-helpers.js";
import { validateDocument } from "./validation.js";
import { isVrid, isVrrpPriority } from "./vrrp.js";

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

/** Routeurs r1 et r2 sur 192.168.1.0/24 (ge0), r1 avec une sous-interface ge1.10 ; poste pc1 et switch sw1. */
function base(): NfgDocument {
  let doc = projectWith(["r1", "R-200"], ["r2", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.2", prefixLength: 24 } }));
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r2", portId: "ge0", ipv4: { address: "192.168.1.3", prefixLength: 24 } }));
  return expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1.10", ipv4: { address: "10.10.0.2", prefixLength: 24 } }));
}

const GROUP = { vrid: 1, address: "192.168.1.1", priority: 100, preempt: true };

describe("VRRP : groupes des routeurs", () => {
  it("accepte un VRID de 1 à 255 et une priorité de 1 à 254 (255 réservée au propriétaire)", () => {
    expect([1, 255].every(isVrid)).toBe(true);
    expect([0, 256, 1.5].some(isVrid)).toBe(false);
    expect([1, 100, 254].every(isVrrpPriority)).toBe(true);
    expect([0, 255, 300].some(isVrrpPriority)).toBe(false);
  });

  it("enregistre, modifie et retire un groupe, sous-interface comprise", () => {
    let doc = expectOk(setVrrpGroup(base(), { deviceId: "r1", interfaceId: "ge0", group: { ...GROUP, priority: 110 } }));
    doc = expectOk(setVrrpGroup(doc, { deviceId: "r2", interfaceId: "ge0", group: GROUP }));
    doc = expectOk(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge1.10", group: { vrid: 10, address: "10.10.0.1", priority: 100, preempt: false } }));
    expect(doc.configurations["r1"]?.vrrpGroups).toEqual({ ge0: { ...GROUP, priority: 110 }, "ge1.10": { vrid: 10, address: "10.10.0.1", priority: 100, preempt: false } });
    expect(validateDocument(doc)).toEqual([]);
    expect(expectOk(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge0", group: null })).configurations["r1"]?.vrrpGroups).toEqual({
      "ge1.10": { vrid: 10, address: "10.10.0.1", priority: 100, preempt: false },
    });
  });

  it("refuse un groupe hors d'un routeur, sans adresse, hors du réseau ou avec des valeurs hors bornes", () => {
    const doc = base();
    expect(codes(setVrrpGroup(doc, { deviceId: "sw1", interfaceId: "ge1", group: GROUP }))).toEqual(["vrrp.not-supported"]);
    expect(codes(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge9", group: GROUP }))).toEqual(["config.unknown-port"]);
    expect(codes(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge2", group: GROUP }))).toEqual(["vrrp.interface-not-addressed"]);
    expect(codes(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge0", group: { ...GROUP, address: "10.0.0.1" } }))).toEqual(["vrrp.address-outside-subnet"]);
    expect(codes(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge0", group: { ...GROUP, address: "192.168.1.255" } }))).toEqual(["vrrp.address-outside-subnet"]);
    expect(codes(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge0", group: { ...GROUP, vrid: 0 } }))).toEqual(["vrrp.invalid-vrid"]);
    expect(codes(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge0", group: { ...GROUP, priority: 255 } }))).toEqual(["vrrp.invalid-priority"]);
  });

  it("avertit quand deux routeurs du même réseau annoncent le même VRID avec des adresses différentes", () => {
    const doc = expectOk(setVrrpGroup(base(), { deviceId: "r1", interfaceId: "ge0", group: GROUP }));
    const result = setVrrpGroup(doc, { deviceId: "r2", interfaceId: "ge0", group: { ...GROUP, address: "192.168.1.254" } });
    expect(result.ok && result.warnings.map((issue) => [issue.code, issue.params["otherAddress"]])).toEqual([["vrrp.address-mismatch", "192.168.1.1"]]);
  });

  it("avertit qu'une interface VRRP dont on retire l'adresse ne participe plus", () => {
    const doc = expectOk(setVrrpGroup(base(), { deviceId: "r1", interfaceId: "ge0", group: GROUP }));
    const result = setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: null });
    expect(result.ok && result.warnings.map((issue) => issue.code)).toEqual(["vrrp.interface-not-addressed"]);
  });
});

describe("VRRP : console équivalente aux formulaires", () => {
  it("vrrp <vrid> <adresse> (valeurs par défaut), avec priorité et préemption, puis vrrp clear", () => {
    const doc = base();
    expect(session(doc, "r1", ["configure", "interface ge0", "vrrp 1 192.168.1.1"])).toEqual(expectOk(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge0", group: GROUP })));
    const tuned = session(doc, "r1", ["configure", "interface ge0", "vrrp 1 192.168.1.1 priority 110 preempt off"]);
    expect(tuned).toEqual(expectOk(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge0", group: { ...GROUP, priority: 110, preempt: false } })));
    expect(session(tuned, "r1", ["configure", "interface ge0", "vrrp clear"]).configurations["r1"]?.vrrpGroups).toEqual({});
    const show = interpret(doc, "r1", OPERATION_MODE, "show vrrp");
    expect(show.ok && show.request).toEqual({ kind: "show-vrrp" });
  });

  it("explique les valeurs invalides, le mode attendu et les options inconnues", () => {
    const doc = base();
    const iface: CliMode = { kind: "interface", portId: "ge0" };
    const refusal = (mode: CliMode, line: string) => {
      const result = interpret(doc, "r1", mode, line);
      if (result.ok) return result.edit ? codes(result.edit(doc)) : null;
      return result.error?.code ?? result.issues.map((issue) => issue.code);
    };
    expect(refusal({ kind: "config" }, "vrrp 1 192.168.1.1")).toBe("cli.wrong-mode");
    expect(refusal(iface, "vrrp 300 192.168.1.1")).toEqual(["vrrp.invalid-vrid"]);
    expect(refusal(iface, "vrrp 1 192.168.1")).toEqual(["ipv4.invalid-address"]);
    expect(refusal(iface, "vrrp 1 192.168.1.1 priority 255")).toEqual(["vrrp.invalid-priority"]);
    expect(refusal(iface, "vrrp 1 192.168.1.1 preempt maybe")).toBe("cli.unexpected-argument");
    expect(refusal(iface, "vrrp 1 192.168.1.1 track ge1")).toBe("cli.unexpected-argument");
    expect(refusal(iface, "vrrp 1 10.0.0.1")).toEqual(["vrrp.address-outside-subnet"]);
  });

  it("réécrit le groupe en commande rejouable, sans répéter les valeurs par défaut", () => {
    let doc = expectOk(setVrrpGroup(base(), { deviceId: "r1", interfaceId: "ge0", group: { ...GROUP, priority: 110, preempt: false } }));
    doc = expectOk(setVrrpGroup(doc, { deviceId: "r1", interfaceId: "ge1.10", group: { vrid: 10, address: "10.10.0.1", priority: 100, preempt: true } }));
    const lines = configurationCommands(doc, "r1");
    expect(lines).toEqual(expect.arrayContaining(["vrrp 1 192.168.1.1 priority 110 preempt off", "vrrp 10 10.10.0.1"]));
    expect(lines.indexOf("vrrp 1 192.168.1.1 priority 110 preempt off")).toBeGreaterThan(lines.indexOf("address 192.168.1.2/24"));
    const blank = projectWith(["r1", "R-200"], ["r2", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
    expect(session(blank, "r1", lines).configurations["r1"]).toEqual(doc.configurations["r1"]);
  });
});
