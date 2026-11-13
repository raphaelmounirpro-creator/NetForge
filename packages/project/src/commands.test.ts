import { describe, expect, it } from "vitest";
import {
  addDevice,
  connectDevices,
  connectPorts,
  createProject,
  disconnect,
  freePorts,
  moveDevice,
  parseIpv4Input,
  removeDevice,
  renameDevice,
  setDefaultGateway,
  setInterfaceIpv4,
} from "./commands.js";
import { emptyProject, expectOk, projectWith } from "./test-helpers.js";
import { validateDocument } from "./validation.js";

const codes = (result: { ok: boolean; errors?: Array<{ code: string }> }) => result.errors?.map((issue) => issue.code);

describe("projet", () => {
  it("crée un projet vide au format courant", () => {
    const doc = emptyProject();
    expect(doc.format).toBe("netforge-project");
    expect(doc.schemaVersion).toBe(10);
    expect(doc.faults).toEqual([]);
    expect(doc.topology).toEqual({ devices: [], links: [] });
  });

  it("refuse un nom de projet vide", () => {
    expect(codes(createProject({ id: "p", name: "   ", now: "2026-11-10T00:00:00.000Z" }))).toEqual(["project.invalid-name"]);
  });
});

describe("équipements", () => {
  it("nomme automatiquement avec le plus petit numéro libre", () => {
    let doc = projectWith(["pc1", "PC"], ["pc2", "PC"], ["r1", "R-200"]);
    expect(doc.topology.devices.map((device) => device.name)).toEqual(["PC1", "PC2", "R1"]);
    doc = expectOk(removeDevice(doc, { deviceId: "pc1" }));
    doc = expectOk(addDevice(doc, { id: "pc3", model: "PC", position: { x: 0, y: 0 } }));
    expect(doc.topology.devices.find((device) => device.id === "pc3")?.name).toBe("PC1");
  });

  it("refuse un nom en double (insensible à la casse) ou invalide", () => {
    const doc = projectWith(["pc1", "PC"], ["pc2", "PC"]);
    expect(codes(renameDevice(doc, { deviceId: "pc2", name: "pc1" }))).toEqual(["device.duplicate-name"]);
    expect(codes(renameDevice(doc, { deviceId: "pc2", name: "poste de Léa" }))).toEqual(["device.invalid-name"]);
    expect(expectOk(renameDevice(doc, { deviceId: "pc2", name: " Poste-Lea " })).topology.devices[1]?.name).toBe("Poste-Lea");
  });

  it("ne modifie jamais le document d'origine", () => {
    const doc = projectWith(["pc1", "PC"]);
    const snapshot = JSON.stringify(doc);
    expectOk(moveDevice(doc, { deviceId: "pc1", position: { x: 40.6, y: -12.2 } }));
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it("arrondit et borne la position", () => {
    const doc = expectOk(moveDevice(projectWith(["pc1", "PC"]), { deviceId: "pc1", position: { x: 40.6, y: 5e9 } }));
    expect(doc.layout.devices["pc1"]).toEqual({ x: 41, y: 1_000_000 });
  });

  it("supprime l'équipement avec ses liens, sa configuration et sa position", () => {
    let doc = projectWith(["pc1", "PC"], ["sw1", "S-24"], ["pc2", "PC"]);
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
    doc = expectOk(connectDevices(doc, { linkId: "l2", aDeviceId: "pc2", bDeviceId: "sw1" }));
    doc = expectOk(removeDevice(doc, { deviceId: "sw1" }));
    expect(doc.topology.links).toEqual([]);
    expect(doc.configurations["sw1"]).toBeUndefined();
    expect(doc.layout.devices["sw1"]).toBeUndefined();
    expect(validateDocument(doc)).toEqual([]);
  });
});

describe("liens", () => {
  it("relie automatiquement les premiers ports libres", () => {
    let doc = projectWith(["pc1", "PC"], ["sw1", "S-24"], ["pc2", "PC"]);
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
    doc = expectOk(connectDevices(doc, { linkId: "l2", aDeviceId: "pc2", bDeviceId: "sw1" }));
    expect(doc.topology.links.map((link) => link.endpoints.map((end) => end.portId))).toEqual([
      ["eth0", "ge1"],
      ["eth0", "ge2"],
    ]);
    expect(freePorts(doc, "sw1")).toHaveLength(22);
  });

  it("refuse un port déjà utilisé, un lien sur soi-même et un équipement saturé", () => {
    let doc = projectWith(["pc1", "PC"], ["sw1", "S-24"], ["pc2", "PC"]);
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
    const reuse = connectPorts(doc, {
      linkId: "l2",
      a: { deviceId: "pc2", portId: "eth0" },
      b: { deviceId: "sw1", portId: "ge1" },
    });
    expect(codes(reuse)).toEqual(["link.port-in-use"]);
    expect(codes(connectDevices(doc, { linkId: "l3", aDeviceId: "sw1", bDeviceId: "sw1" }))).toEqual(["link.same-device"]);
    expect(codes(connectDevices(doc, { linkId: "l4", aDeviceId: "pc1", bDeviceId: "pc2" }))).toEqual(["link.no-free-port"]);
  });

  it("refuse un port inexistant sur le modèle", () => {
    const doc = projectWith(["pc1", "PC"], ["r1", "R-200"]);
    const result = connectPorts(doc, {
      linkId: "l1",
      a: { deviceId: "pc1", portId: "eth0" },
      b: { deviceId: "r1", portId: "ge9" },
    });
    expect(codes(result)).toEqual(["link.unknown-port"]);
  });

  it("supprime un lien et libère ses ports", () => {
    let doc = projectWith(["pc1", "PC"], ["pc2", "PC"]);
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "pc2" }));
    doc = expectOk(disconnect(doc, { linkId: "l1" }));
    expect(freePorts(doc, "pc1")).toEqual(["eth0"]);
    expect(codes(disconnect(doc, { linkId: "l1" }))).toEqual(["link.not-found"]);
  });
});

describe("configuration IPv4", () => {
  it("analyse la saisie de l'adresse et du masque", () => {
    expect(parseIpv4Input("192.168.1.10", "255.255.255.0")).toEqual({
      ok: true,
      ipv4: { address: "192.168.1.10", prefixLength: 24 },
    });
    const invalid = parseIpv4Input("192.168.1", "255.0.255.0");
    expect(invalid.ok ? [] : invalid.errors.map((issue) => issue.code)).toEqual(["ipv4.invalid-address", "ipv4.invalid-mask"]);
  });

  it("configure puis efface une interface", () => {
    let doc = projectWith(["pc1", "PC"]);
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "10.0.0.2", prefixLength: 24 } }));
    expect(doc.configurations["pc1"]?.interfaces["eth0"]?.ipv4?.address).toBe("10.0.0.2");
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: null }));
    expect(doc.configurations["pc1"]?.interfaces).toEqual({});
  });

  it("refuse une adresse non attribuable et un switch sans IP", () => {
    const doc = projectWith(["pc1", "PC"], ["sw1", "S-24"]);
    const network = setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "10.0.0.0", prefixLength: 24 } });
    expect(codes(network)).toEqual(["ipv4.unassignable"]);
    const onSwitch = setInterfaceIpv4(doc, { deviceId: "sw1", portId: "ge1", ipv4: { address: "10.0.0.5", prefixLength: 24 } });
    expect(codes(onSwitch)).toEqual(["config.not-ip-capable"]);
  });

  it("refuse deux réseaux qui se chevauchent sur un routeur", () => {
    let doc = projectWith(["r1", "R-200"]);
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "10.0.0.1", prefixLength: 16 } }));
    const overlap = setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: { address: "10.0.5.1", prefixLength: 24 } });
    expect(codes(overlap)).toEqual(["ipv4.overlap"]);
  });

  it("accepte une adresse en double avec un avertissement (cas de dépannage)", () => {
    let doc = projectWith(["pc1", "PC"], ["pc2", "PC"]);
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "10.0.0.2", prefixLength: 24 } }));
    const result = setInterfaceIpv4(doc, { deviceId: "pc2", portId: "eth0", ipv4: { address: "10.0.0.2", prefixLength: 24 } });
    expect(result.ok && result.warnings.map((issue) => issue.code)).toEqual(["ipv4.duplicate-address"]);
  });

  it("signale une passerelle hors du réseau sans la refuser", () => {
    let doc = projectWith(["pc1", "PC"]);
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.10", prefixLength: 24 } }));
    const result = setDefaultGateway(doc, { deviceId: "pc1", gateway: "192.168.2.1" });
    expect(result.ok && result.warnings.map((issue) => issue.code)).toEqual(["gateway.outside-subnet"]);
    const cleared = expectOk(setDefaultGateway(expectOk(result), { deviceId: "pc1", gateway: "" }));
    expect(cleared.configurations["pc1"]?.defaultGateway).toBeNull();
  });

  it("réserve la passerelle par défaut aux PC", () => {
    const doc = projectWith(["r1", "R-200"]);
    expect(codes(setDefaultGateway(doc, { deviceId: "r1", gateway: "10.0.0.1" }))).toEqual(["config.gateway-not-supported"]);
  });
});
