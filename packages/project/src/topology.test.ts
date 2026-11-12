import { describe, expect, it } from "vitest";
import { connectPorts, type CommandResult, setStp } from "./commands.js";
import { expectOk, projectWith } from "./test-helpers.js";

const codes = (result: CommandResult) => (result.ok ? result.warnings : result.errors).map((issue) => issue.code);
const link = (linkId: string, a: string, aPort: string, b: string, bPort: string) => ({
  linkId,
  a: { deviceId: a, portId: aPort },
  b: { deviceId: b, portId: bPort },
});

describe("boucle de commutation", () => {
  it("signale un second câble entre deux mêmes switches quand l'un n'a pas STP", () => {
    let doc = projectWith(["sw1", "S-24"], ["sw2", "S-24"]);
    doc = expectOk(setStp(doc, { deviceId: "sw2", enabled: false, priority: 32768 }));
    doc = expectOk(connectPorts(doc, link("l1", "sw1", "ge1", "sw2", "ge1")));
    const second = connectPorts(doc, link("l2", "sw1", "ge2", "sw2", "ge2"));
    expect(second.ok).toBe(true);
    expect(codes(second)).toEqual(["topology.switch-loop"]);
  });

  it("ne signale pas une boucle entre switches qui ont tous STP activé (redondance normale)", () => {
    let doc = projectWith(["sw1", "S-24"], ["sw2", "S-24"]);
    doc = expectOk(connectPorts(doc, link("l1", "sw1", "ge1", "sw2", "ge1")));
    expect(codes(connectPorts(doc, link("l2", "sw1", "ge2", "sw2", "ge2")))).toEqual([]);
  });

  it("signale le câble qui ferme un triangle de switches dont un n'a pas STP", () => {
    let doc = projectWith(["sw1", "S-24"], ["sw2", "S-24"], ["sw3", "S-24"]);
    doc = expectOk(setStp(doc, { deviceId: "sw3", enabled: false, priority: 32768 }));
    doc = expectOk(connectPorts(doc, link("l1", "sw1", "ge1", "sw2", "ge1")));
    doc = expectOk(connectPorts(doc, link("l2", "sw2", "ge2", "sw3", "ge1")));
    const closing = connectPorts(doc, link("l3", "sw3", "ge2", "sw1", "ge2"));
    expect(codes(closing)).toEqual(["topology.switch-loop"]);
  });

  it("ne signale rien pour une arborescence ou un chemin passant par un routeur", () => {
    let doc = projectWith(["sw1", "S-24"], ["sw2", "S-24"], ["r1", "R-200"], ["pc1", "PC"]);
    doc = expectOk(connectPorts(doc, link("l1", "sw1", "ge1", "sw2", "ge1")));
    doc = expectOk(connectPorts(doc, link("l2", "sw1", "ge2", "r1", "ge0")));
    doc = expectOk(connectPorts(doc, link("l3", "pc1", "eth0", "sw2", "ge2")));
    // Le routeur termine le domaine de diffusion : pas de boucle de commutation.
    expect(codes(connectPorts(doc, link("l4", "sw2", "ge3", "r1", "ge1")))).toEqual([]);
  });
});
