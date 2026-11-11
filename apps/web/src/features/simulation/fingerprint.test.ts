import { ftthScenario, lanScenario } from "@netforge/engine";
import { addDevice, addFault, connectPorts, setFiber, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { networkFingerprint } from "./fingerprint";

function ok(result: CommandResult): NfgDocument {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
}

describe("empreinte du réseau simulé", () => {
  it("ignore le réseau optique : ajout d'équipements FTTH, réglage d'une fibre, panne", () => {
    const lan = lanScenario();
    let mixed = ok(addDevice(lan, { id: "olt1", model: "OLT-16", position: { x: 0, y: 0 } }));
    mixed = ok(addDevice(mixed, { id: "ont1", model: "ONT-1G", position: { x: 50, y: 0 } }));
    mixed = ok(connectPorts(mixed, { linkId: "f1", a: { deviceId: "olt1", portId: "pon1" }, b: { deviceId: "ont1", portId: "pon" } }));
    mixed = ok(setFiber(mixed, { linkId: "f1", fiber: { length: 900, type: "G.652.D", cable: "distribution" } }));
    mixed = ok(addFault(mixed, { id: "p1", kind: "cut", target: { kind: "link", linkId: "f1" }, extraLoss: null }));
    expect(networkFingerprint(mixed)).toBe(networkFingerprint(lan));
  });

  it("change dès qu'un équipement IP est ajouté", () => {
    const lan = lanScenario();
    const more = ok(addDevice(lan, { id: "pc9", model: "PC", position: { x: 0, y: 0 } }));
    expect(networkFingerprint(more)).not.toBe(networkFingerprint(lan));
  });

  it("est identique pour deux réseaux FTTH différents (aucun équipement simulé)", () => {
    expect(networkFingerprint(ftthScenario())).toBe(networkFingerprint(ftthScenario({ dirtyPto3: true })));
  });
});
