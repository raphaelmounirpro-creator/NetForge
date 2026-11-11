import { describe, expect, it } from "vitest";
import {
  addFault,
  connectDevices,
  connectPorts,
  DEFAULT_FIBER,
  disconnect,
  removeDevice,
  removeFault,
  repair,
  setFiber,
  type CommandResult,
} from "./commands.js";
import { parseNfgValue } from "./io.js";
import type { FaultTarget, NfgDocument } from "./schema.js";
import { expectOk, projectWith } from "./test-helpers.js";

const errorCodes = (result: CommandResult) => (result.ok ? [] : result.errors.map((issue) => issue.code));
const port = (deviceId: string, portId: string): FaultTarget => ({ kind: "port", deviceId, portId });
const cable = (linkId: string): FaultTarget => ({ kind: "link", linkId });
const endpoints = (doc: NfgDocument, linkId: string) =>
  doc.topology.links.find((link) => link.id === linkId)?.endpoints.map((end) => `${end.deviceId}/${end.portId}`);

/** Chaîne OLT → ODF → coupleur 1:8 → coupleur 1:4 → PBO → PTO → ONT, raccordée automatiquement. */
function ftthChain(): NfgDocument {
  let doc = projectWith(["olt1", "OLT-16"], ["odf1", "ODF-12"], ["cpl1", "SPL-8"], ["cpl2", "SPL-4"], ["pbo1", "PBO-8"], ["pto1", "PTO"], ["ont1", "ONT-1G"]);
  const chain = ["olt1", "odf1", "cpl1", "cpl2", "pbo1", "pto1", "ont1"];
  chain.slice(1).forEach((deviceId, index) => {
    doc = expectOk(connectDevices(doc, { linkId: `l${String(index + 1)}`, aDeviceId: chain[index] ?? "", bDeviceId: deviceId }));
  });
  return doc;
}

describe("liens optiques et compatibilité des connectiques", () => {
  it("attribue une fibre par défaut à un lien fibre et aucune à un câble cuivre", () => {
    let doc = projectWith(["pto1", "PTO"], ["ont1", "ONT-1G"], ["pc1", "PC"], ["sw1", "S-24"]);
    doc = expectOk(connectPorts(doc, { linkId: "l1", a: { deviceId: "pto1", portId: "out" }, b: { deviceId: "ont1", portId: "pon" } }));
    doc = expectOk(connectPorts(doc, { linkId: "l2", a: { deviceId: "pc1", portId: "eth0" }, b: { deviceId: "sw1", portId: "ge1" } }));
    expect(doc.topology.links.map((link) => link.fiber)).toEqual([DEFAULT_FIBER, null]);
  });

  it("refuse de relier un port cuivre à un port fibre", () => {
    const doc = projectWith(["pc1", "PC"], ["ont1", "ONT-1G"]);
    const result = connectPorts(doc, { linkId: "l1", a: { deviceId: "pc1", portId: "eth0" }, b: { deviceId: "ont1", portId: "pon" } });
    expect(errorCodes(result)).toEqual(["link.incompatible-media"]);
    expect(errorCodes(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "ont1" }))).toEqual(["link.incompatible-media"]);
  });

  it("raccorde automatiquement une chaîne FTTH en prolongeant chaque chemin", () => {
    const doc = ftthChain();
    expect(doc.topology.links.map((link) => endpoints(doc, link.id))).toEqual([
      ["olt1/pon1", "odf1/f1"], // jarretière : connecteur ↔ connecteur
      ["odf1/r1", "cpl1/com"], // câble de transport épissuré à l'arrière du tiroir
      ["cpl1/o1", "cpl2/com"],
      ["cpl2/o1", "pbo1/in1"],
      ["pbo1/out1", "pto1/in"], // câble de raccordement
      ["pto1/out", "ont1/pon"],
    ]);
    expect(doc.topology.links.every((link) => link.fiber !== null)).toBe(true);
  });

  it("modifie la longueur et le type d'une fibre dans les limites", () => {
    const doc = ftthChain();
    const updated = expectOk(setFiber(doc, { linkId: "l2", fiber: { length: 3200, type: "G.652.D", cable: "distribution" } }));
    expect(updated.topology.links[1]?.fiber).toEqual({ length: 3200, type: "G.652.D", cable: "distribution" });
    expect(errorCodes(setFiber(doc, { linkId: "l2", fiber: { length: 0, type: "G.652.D", cable: "distribution" } }))).toEqual(["link.invalid-fiber"]);
    expect(errorCodes(setFiber(doc, { linkId: "l2", fiber: { length: 200_000, type: "G.652.D", cable: "distribution" } }))).toEqual(["link.invalid-fiber"]);
    expect(errorCodes(setFiber(doc, { linkId: "absent", fiber: DEFAULT_FIBER }))).toEqual(["link.not-found"]);
  });

  it("refuse de donner une fibre à un câble cuivre", () => {
    let doc = projectWith(["pc1", "PC"], ["sw1", "S-24"]);
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
    expect(errorCodes(setFiber(doc, { linkId: "l1", fiber: DEFAULT_FIBER }))).toEqual(["link.fiber-unexpected"]);
  });

  it("détecte à l'import une fibre absente, en trop ou une connectique incompatible", () => {
    const codes = (doc: unknown) => {
      const result = parseNfgValue(doc);
      return result.ok ? [] : result.errors.map((issue) => issue.code);
    };
    const doc = ftthChain();
    const withLinks = (links: NfgDocument["topology"]["links"]) => ({ ...doc, topology: { ...doc.topology, links } });
    expect(codes(withLinks(doc.topology.links.map((link) => (link.id === "l1" ? { ...link, fiber: null } : link))))).toEqual(["link.fiber-missing"]);

    let copper = projectWith(["pc1", "PC"], ["sw1", "S-24"]);
    copper = expectOk(connectDevices(copper, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
    const copperLinks = copper.topology.links.map((link) => ({ ...link, fiber: DEFAULT_FIBER }));
    expect(codes({ ...copper, topology: { ...copper.topology, links: copperLinks } })).toEqual(["link.fiber-unexpected"]);

    const mixed = projectWith(["pc1", "PC"], ["ont1", "ONT-1G"]);
    const mixedLink = { id: "l1", endpoints: [{ deviceId: "pc1", portId: "eth0" }, { deviceId: "ont1", portId: "pon" }], fiber: null };
    expect(codes({ ...mixed, topology: { ...mixed.topology, links: [mixedLink] } })).toEqual(["link.incompatible-media"]);
  });
});

describe("pannes optiques (formateur)", () => {
  it("accepte chaque type de panne sur une cible adaptée", () => {
    let doc = ftthChain();
    doc = expectOk(addFault(doc, { id: "f1", kind: "dirty-connector", target: port("pto1", "out"), extraLoss: 4.5 }));
    doc = expectOk(addFault(doc, { id: "f2", kind: "bad-splice", target: port("pbo1", "in1"), extraLoss: 1.2 }));
    doc = expectOk(addFault(doc, { id: "f3", kind: "bend", target: cable("l2"), extraLoss: 2 }));
    doc = expectOk(addFault(doc, { id: "f4", kind: "cut", target: cable("l5"), extraLoss: null }));
    doc = expectOk(addFault(doc, { id: "f5", kind: "polish-mismatch", target: port("olt1", "pon1"), extraLoss: null }));
    expect(doc.faults.map((fault) => fault.id)).toEqual(["f1", "f2", "f3", "f4", "f5"]);
  });

  it("refuse une panne sur une cible qui ne peut pas la porter", () => {
    const doc = ftthChain();
    // Entrée de câble : pas de connecteur à salir ; sortie de PTO : pas d'épissure.
    expect(errorCodes(addFault(doc, { id: "f1", kind: "dirty-connector", target: port("pto1", "in"), extraLoss: 1 }))).toEqual(["fault.invalid-target"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "bad-splice", target: port("pto1", "out"), extraLoss: 1 }))).toEqual(["fault.invalid-target"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "cut", target: port("pto1", "out"), extraLoss: null }))).toEqual(["fault.invalid-target"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "dirty-connector", target: cable("l1"), extraLoss: 1 }))).toEqual(["fault.invalid-target"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "cut", target: cable("absent"), extraLoss: null }))).toEqual(["fault.unknown-target"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "dirty-connector", target: port("pto1", "zz9"), extraLoss: 1 }))).toEqual(["fault.unknown-target"]);
  });

  it("refuse une coupure sur un câble cuivre", () => {
    let doc = projectWith(["pc1", "PC"], ["sw1", "S-24"]);
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
    expect(errorCodes(addFault(doc, { id: "f1", kind: "cut", target: cable("l1"), extraLoss: null }))).toEqual(["fault.invalid-target"]);
  });

  it("exige une perte pour les pannes atténuantes, et seulement pour elles", () => {
    const doc = ftthChain();
    expect(errorCodes(addFault(doc, { id: "f1", kind: "bend", target: cable("l2"), extraLoss: null }))).toEqual(["fault.invalid-loss"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "cut", target: cable("l2"), extraLoss: 3 }))).toEqual(["fault.invalid-loss"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "bend", target: cable("l2"), extraLoss: 0 }))).toEqual(["fault.invalid-loss"]);
    expect(errorCodes(addFault(doc, { id: "f1", kind: "bend", target: cable("l2"), extraLoss: 31 }))).toEqual(["fault.invalid-loss"]);
  });

  it("refuse une panne en double et au-delà de la limite", () => {
    const doc = expectOk(addFault(ftthChain(), { id: "f1", kind: "cut", target: cable("l2"), extraLoss: null }));
    expect(errorCodes(addFault(doc, { id: "f2", kind: "cut", target: cable("l2"), extraLoss: null }))).toEqual(["fault.duplicate"]);
    const full = { ...doc, faults: Array.from({ length: 100 }, (_, index) => ({ ...doc.faults[0], id: `f${String(index)}` })) } as NfgDocument;
    expect(errorCodes(addFault(full, { id: "x", kind: "bend", target: cable("l3"), extraLoss: 1 }))).toEqual(["fault.too-many"]);
  });

  it("supprime une panne et signale une panne inconnue", () => {
    const doc = expectOk(addFault(ftthChain(), { id: "f1", kind: "cut", target: cable("l2"), extraLoss: null }));
    expect(expectOk(removeFault(doc, { id: "f1" })).faults).toEqual([]);
    expect(errorCodes(removeFault(doc, { id: "f9" }))).toEqual(["fault.not-found"]);
  });

  it("retire les pannes d'un équipement ou d'un câble supprimé", () => {
    let doc = ftthChain();
    doc = expectOk(addFault(doc, { id: "f1", kind: "dirty-connector", target: port("pto1", "out"), extraLoss: 4.5 }));
    doc = expectOk(addFault(doc, { id: "f2", kind: "cut", target: cable("l4"), extraLoss: null }));
    doc = expectOk(addFault(doc, { id: "f3", kind: "bend", target: cable("l2"), extraLoss: 1 }));
    // Supprimer la PTO supprime sa panne et celles de ses câbles (l5, l6), pas les autres.
    expect(expectOk(removeDevice(doc, { deviceId: "pto1" })).faults.map((fault) => fault.id)).toEqual(["f2", "f3"]);
    // Supprimer le PBO emporte le câble l4 et sa coupure.
    expect(expectOk(removeDevice(doc, { deviceId: "pbo1" })).faults.map((fault) => fault.id)).toEqual(["f1", "f3"]);
    expect(expectOk(disconnect(doc, { linkId: "l2" })).faults.map((fault) => fault.id)).toEqual(["f1", "f2"]);
  });
});

describe("interventions de réparation", () => {
  const faulty = () => {
    let doc = ftthChain();
    doc = expectOk(addFault(doc, { id: "f1", kind: "dirty-connector", target: port("pto1", "out"), extraLoss: 4.5 }));
    doc = expectOk(addFault(doc, { id: "f2", kind: "bend", target: cable("l2"), extraLoss: 2 }));
    doc = expectOk(addFault(doc, { id: "f3", kind: "cut", target: cable("l2"), extraLoss: null }));
    doc = expectOk(addFault(doc, { id: "f4", kind: "bad-splice", target: port("pbo1", "in1"), extraLoss: 1 }));
    doc = expectOk(addFault(doc, { id: "f5", kind: "polish-mismatch", target: port("olt1", "pon1"), extraLoss: null }));
    return doc;
  };

  it("chaque intervention corrige la panne correspondante à cet endroit", () => {
    const doc = faulty();
    const remaining = (result: CommandResult) => expectOk(result).faults.map((fault) => fault.id);
    expect(remaining(repair(doc, { action: "clean", target: port("pto1", "out") }))).toEqual(["f2", "f3", "f4", "f5"]);
    expect(remaining(repair(doc, { action: "replace-fiber", target: cable("l2") }))).toEqual(["f1", "f4", "f5"]);
    expect(remaining(repair(doc, { action: "resplice", target: port("pbo1", "in1") }))).toEqual(["f1", "f2", "f3", "f5"]);
    expect(remaining(repair(doc, { action: "reconnect", target: port("olt1", "pon1") }))).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("refuse une intervention qui ne corrige rien (mauvais endroit ou mauvais geste)", () => {
    const doc = faulty();
    expect(errorCodes(repair(doc, { action: "clean", target: port("ont1", "pon") }))).toEqual(["repair.nothing-found"]);
    expect(errorCodes(repair(doc, { action: "resplice", target: port("pto1", "out") }))).toEqual(["repair.nothing-found"]);
    expect(errorCodes(repair(doc, { action: "replace-fiber", target: cable("l1") }))).toEqual(["repair.nothing-found"]);
  });
});
