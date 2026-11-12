import { describe, expect, it } from "vitest";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { setInterfaceIpv4, setRipInterface } from "./commands.js";
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

/** Routeur r1 : ge0 en 10.1.0.1/24, ge1 en 10.12.0.1/30, sous-interface ge2.10 ; poste pc1 et switch sw1. */
function base(): NfgDocument {
  let doc = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "10.1.0.1", prefixLength: 24 } }));
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: { address: "10.12.0.1", prefixLength: 30 } }));
  return expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge2.10", ipv4: { address: "10.10.0.1", prefixLength: 24 } }));
}

describe("RIP : participation des interfaces d'un routeur", () => {
  it("active, rend passive puis retire une interface, sous-interface comprise", () => {
    let doc = expectOk(setRipInterface(base(), { deviceId: "r1", interfaceId: "ge1", mode: "active" }));
    doc = expectOk(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge0", mode: "passive" }));
    doc = expectOk(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge2.10", mode: "active" }));
    expect(doc.configurations["r1"]?.ripInterfaces).toEqual({ ge1: "active", ge0: "passive", "ge2.10": "active" });
    expect(validateDocument(doc)).toEqual([]);
    doc = expectOk(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge0", mode: null }));
    expect(doc.configurations["r1"]?.ripInterfaces).toEqual({ ge1: "active", "ge2.10": "active" });
  });

  it("refuse RIP hors d'un routeur, sur un port inconnu ou sur une interface sans adresse", () => {
    const doc = base();
    expect(codes(setRipInterface(doc, { deviceId: "sw1", interfaceId: "ge1", mode: "active" }))).toEqual(["rip.not-supported"]);
    expect(codes(setRipInterface(doc, { deviceId: "pc1", interfaceId: "eth0", mode: "active" }))).toEqual(["rip.not-supported"]);
    expect(codes(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge9", mode: "active" }))).toEqual(["config.unknown-port"]);
    expect(codes(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge3", mode: "active" }))).toEqual(["rip.interface-not-addressed"]);
  });

  it("n'empêche pas de retirer l'adresse d'une interface RIP, mais avertit qu'elle ne participe plus", () => {
    const doc = expectOk(setRipInterface(base(), { deviceId: "r1", interfaceId: "ge1", mode: "active" }));
    const result = setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: null });
    expect(result.ok && result.warnings.map((issue) => issue.code)).toEqual(["rip.interface-not-addressed"]);
  });

  it("refuse un document importé qui place RIP sur un switch ou sur un port inexistant", () => {
    const doc = base();
    const sw = doc.configurations["sw1"];
    const r1 = doc.configurations["r1"];
    if (!sw || !r1) throw new Error("configurations attendues");
    const imported: NfgDocument = { ...doc, configurations: { ...doc.configurations, sw1: { ...sw, ripInterfaces: { ge1: "active" } }, r1: { ...r1, ripInterfaces: { ge7: "active" } } } };
    expect(validateDocument(imported).map((issue) => issue.code)).toEqual(expect.arrayContaining(["rip.not-supported", "config.unknown-port"]));
  });
});

describe("RIP : console équivalente aux formulaires", () => {
  it("rip enable, passive et disable donnent les mêmes documents que le formulaire", () => {
    const doc = base();
    const active = session(doc, "r1", ["configure", "interface ge1", "rip enable"]);
    expect(active).toEqual(expectOk(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge1", mode: "active" })));
    const passive = session(active, "r1", ["configure", "interface ge1", "rip passive"]);
    expect(passive).toEqual(expectOk(setRipInterface(active, { deviceId: "r1", interfaceId: "ge1", mode: "passive" })));
    expect(session(passive, "r1", ["configure", "interface ge1", "rip disable"])).toEqual(expectOk(setRipInterface(passive, { deviceId: "r1", interfaceId: "ge1", mode: null })));
    const show = interpret(doc, "r1", OPERATION_MODE, "show rip");
    expect(show.ok && show.request).toEqual({ kind: "show-rip" });
  });

  it("explique le mode attendu et l'interface sans adresse", () => {
    const doc = base();
    const refusal = (mode: CliMode, line: string) => {
      const result = interpret(doc, "r1", mode, line);
      if (result.ok) return result.edit ? codes(result.edit(doc)) : null;
      return result.error?.code ?? result.issues.map((issue) => issue.code);
    };
    expect(refusal({ kind: "config" }, "rip enable")).toBe("cli.wrong-mode");
    expect(refusal({ kind: "interface", portId: "ge3" }, "rip enable")).toEqual(["rip.interface-not-addressed"]);
    expect(interpret(doc, "sw1", { kind: "interface", portId: "ge1" }, "rip enable").ok).toBe(false);
  });

  it("réécrit la participation à RIP en commandes rejouables, après les adresses", () => {
    let doc = expectOk(setRipInterface(base(), { deviceId: "r1", interfaceId: "ge1", mode: "active" }));
    doc = expectOk(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge0", mode: "passive" }));
    doc = expectOk(setRipInterface(doc, { deviceId: "r1", interfaceId: "ge2.10", mode: "active" }));
    const lines = configurationCommands(doc, "r1");
    expect(lines).toEqual(expect.arrayContaining(["rip enable", "rip passive"]));
    expect(lines.indexOf("rip passive")).toBeGreaterThan(lines.indexOf("address 10.1.0.1/24"));
    const blank = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
    expect(session(blank, "r1", lines).configurations["r1"]).toEqual(doc.configurations["r1"]);
  });
});
