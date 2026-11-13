import { describe, expect, it } from "vitest";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { setInterfaceIpv4, setOspfInterface } from "./commands.js";
import { isOspfCost, isOspfPriority } from "./ospf.js";
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

const ACTIVE = { mode: "active", cost: 10, priority: 1 } as const;

describe("OSPF : participation des interfaces d'un routeur", () => {
  it("accepte un coût de 1 à 65535 et une priorité de 0 à 255", () => {
    expect([1, 10, 65535].every(isOspfCost)).toBe(true);
    expect([0, 65536, 1.5, -1].some(isOspfCost)).toBe(false);
    expect([0, 1, 255].every(isOspfPriority)).toBe(true);
    expect([256, -1, 0.5].some(isOspfPriority)).toBe(false);
  });

  it("active, rend passive, modifie coût et priorité puis retire une interface, sous-interface comprise", () => {
    let doc = expectOk(setOspfInterface(base(), { deviceId: "r1", interfaceId: "ge1", ospf: ACTIVE }));
    doc = expectOk(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge0", ospf: { mode: "passive", cost: 1, priority: 0 } }));
    doc = expectOk(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge2.10", ospf: { ...ACTIVE, cost: 65535, priority: 255 } }));
    expect(doc.configurations["r1"]?.ospfInterfaces).toEqual({
      ge1: ACTIVE,
      ge0: { mode: "passive", cost: 1, priority: 0 },
      "ge2.10": { mode: "active", cost: 65535, priority: 255 },
    });
    expect(validateDocument(doc)).toEqual([]);
    doc = expectOk(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge0", ospf: null }));
    expect(Object.keys(doc.configurations["r1"]?.ospfInterfaces ?? {})).toEqual(["ge1", "ge2.10"]);
  });

  it("refuse OSPF hors d'un routeur, sur un port inconnu, sans adresse, ou avec un coût ou une priorité hors bornes", () => {
    const doc = base();
    expect(codes(setOspfInterface(doc, { deviceId: "sw1", interfaceId: "ge1", ospf: ACTIVE }))).toEqual(["ospf.not-supported"]);
    expect(codes(setOspfInterface(doc, { deviceId: "pc1", interfaceId: "eth0", ospf: ACTIVE }))).toEqual(["ospf.not-supported"]);
    expect(codes(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge9", ospf: ACTIVE }))).toEqual(["config.unknown-port"]);
    expect(codes(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge3", ospf: ACTIVE }))).toEqual(["ospf.interface-not-addressed"]);
    expect(codes(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge1", ospf: { ...ACTIVE, cost: 0 } }))).toEqual(["ospf.invalid-cost"]);
    expect(codes(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge1", ospf: { ...ACTIVE, priority: 256 } }))).toEqual(["ospf.invalid-priority"]);
  });

  it("n'empêche pas de retirer l'adresse d'une interface OSPF, mais avertit qu'elle ne participe plus", () => {
    const doc = expectOk(setOspfInterface(base(), { deviceId: "r1", interfaceId: "ge1", ospf: ACTIVE }));
    const result = setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: null });
    expect(result.ok && result.warnings.map((issue) => issue.code)).toEqual(["ospf.interface-not-addressed"]);
  });

  it("refuse un document importé qui place OSPF sur un switch ou sur un port inexistant", () => {
    const doc = base();
    const sw = doc.configurations["sw1"];
    const r1 = doc.configurations["r1"];
    if (!sw || !r1) throw new Error("configurations attendues");
    const imported: NfgDocument = { ...doc, configurations: { ...doc.configurations, sw1: { ...sw, ospfInterfaces: { ge1: ACTIVE } }, r1: { ...r1, ospfInterfaces: { ge7: ACTIVE } } } };
    expect(validateDocument(imported).map((issue) => issue.code)).toEqual(expect.arrayContaining(["ospf.not-supported", "config.unknown-port"]));
  });
});

describe("OSPF : console équivalente aux formulaires", () => {
  it("ospf enable (valeurs par défaut), cost, priority, passive et disable donnent les documents du formulaire", () => {
    const doc = base();
    const active = session(doc, "r1", ["configure", "interface ge1", "ospf enable"]);
    expect(active).toEqual(expectOk(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge1", ospf: ACTIVE })));
    const tuned = session(active, "r1", ["configure", "interface ge1", "ospf cost 25", "ospf priority 0"]);
    expect(tuned).toEqual(expectOk(setOspfInterface(active, { deviceId: "r1", interfaceId: "ge1", ospf: { mode: "active", cost: 25, priority: 0 } })));
    // Passer en passif conserve coût et priorité.
    const passive = session(tuned, "r1", ["configure", "interface ge1", "ospf passive"]);
    expect(passive.configurations["r1"]?.ospfInterfaces["ge1"]).toEqual({ mode: "passive", cost: 25, priority: 0 });
    expect(session(passive, "r1", ["configure", "interface ge1", "ospf disable"])).toEqual(expectOk(setOspfInterface(passive, { deviceId: "r1", interfaceId: "ge1", ospf: null })));
    const show = interpret(doc, "r1", OPERATION_MODE, "show ospf");
    const database = interpret(doc, "r1", OPERATION_MODE, "sh ospf data");
    expect([show.ok && show.request, database.ok && database.request]).toEqual([{ kind: "show-ospf" }, { kind: "show-ospf-database" }]);
  });

  it("explique le mode attendu, l'interface sans OSPF ou sans adresse et les valeurs hors bornes", () => {
    const doc = base();
    const iface: CliMode = { kind: "interface", portId: "ge1" };
    const refusal = (mode: CliMode, line: string) => {
      const result = interpret(doc, "r1", mode, line);
      if (result.ok) return result.edit ? codes(result.edit(doc)) : null;
      return result.error?.code ?? result.issues.map((issue) => issue.code);
    };
    expect(refusal({ kind: "config" }, "ospf enable")).toBe("cli.wrong-mode");
    expect(refusal({ kind: "interface", portId: "ge3" }, "ospf enable")).toEqual(["ospf.interface-not-addressed"]);
    expect(refusal(iface, "ospf cost 20")).toEqual(["ospf.interface-not-enabled"]);
    expect(refusal(iface, "ospf cost 70000")).toEqual(["ospf.invalid-cost"]);
    expect(refusal(iface, "ospf priority x")).toEqual(["ospf.invalid-priority"]);
    expect(refusal(iface, "ospf p")).toBe("cli.ambiguous");
    expect(interpret(doc, "sw1", { kind: "interface", portId: "ge1" }, "ospf enable").ok).toBe(false);
  });

  it("réécrit OSPF en commandes rejouables, après les adresses, sans répéter les valeurs par défaut", () => {
    let doc = expectOk(setOspfInterface(base(), { deviceId: "r1", interfaceId: "ge1", ospf: ACTIVE }));
    doc = expectOk(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge0", ospf: { mode: "passive", cost: 1, priority: 1 } }));
    doc = expectOk(setOspfInterface(doc, { deviceId: "r1", interfaceId: "ge2.10", ospf: { mode: "active", cost: 10, priority: 200 } }));
    const lines = configurationCommands(doc, "r1");
    expect(lines).toEqual(expect.arrayContaining(["ospf enable", "ospf passive", "ospf cost 1", "ospf priority 200"]));
    expect(lines.filter((line) => line.startsWith("ospf cost"))).toEqual(["ospf cost 1"]);
    expect(lines.indexOf("ospf passive")).toBeGreaterThan(lines.indexOf("address 10.1.0.1/24"));
    const blank = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
    expect(session(blank, "r1", lines).configurations["r1"]).toEqual(doc.configurations["r1"]);
  });
});
