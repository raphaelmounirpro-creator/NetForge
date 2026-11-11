import { describe, expect, it } from "vitest";
import { connectDevices, setInterfaceIpv4 } from "./commands.js";
import { parseNfgText, parseNfgValue, serializeNfg } from "./io.js";
import { expectOk, projectWith } from "./test-helpers.js";

/** Document écrit à la main au format version 1 (phase 1), sans routes statiques. */
const versionOne = {
  format: "netforge-project",
  schemaVersion: 1,
  models: { catalog: 1 },
  metadata: {
    id: "ancien",
    name: "Projet v1",
    description: "",
    createdAt: "2026-11-10T12:00:00.000Z",
    updatedAt: "2026-11-10T12:00:00.000Z",
  },
  topology: {
    devices: [
      { id: "pc1", model: "PC", name: "PC1" },
      { id: "r1", model: "R-200", name: "R1" },
    ],
    links: [{ id: "l1", endpoints: [{ deviceId: "pc1", portId: "eth0" }, { deviceId: "r1", portId: "ge0" }] }],
  },
  configurations: {
    pc1: { interfaces: { eth0: { ipv4: { address: "192.168.1.10", prefixLength: 24 } } }, defaultGateway: "192.168.1.1" },
    r1: { interfaces: { ge0: { ipv4: { address: "192.168.1.1", prefixLength: 24 } } }, defaultGateway: null },
  },
  layout: { devices: { pc1: { x: 0, y: 0 }, r1: { x: 200, y: 0 } } },
};

const errorCodes = (value: unknown) => {
  const result = parseNfgValue(value);
  return result.ok ? [] : result.errors.map((issue) => issue.code);
};

describe("migration du format version 1 → 4", () => {
  it("migre un fichier version 1 sans perte et ajoute des routes vides", () => {
    const result = parseNfgText(JSON.stringify(versionOne));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(4);
    expect(result.document.models).toEqual({ catalog: 2 });
    expect(result.document.faults).toEqual([]);
    expect(result.document.configurations["pc1"]).toEqual({ ...versionOne.configurations.pc1, staticRoutes: [] });
    expect(result.document.configurations["r1"]).toEqual({ ...versionOne.configurations.r1, staticRoutes: [] });
    // Tous les liens d'une version antérieure sont en cuivre : aucune propriété de fibre.
    expect(result.document.topology).toEqual({
      ...versionOne.topology,
      links: versionOne.topology.links.map((link) => ({ ...link, fiber: null })),
    });
    expect(result.document.layout).toEqual({ ...versionOne.layout, annotations: [] });
    expect(result.document.metadata).toEqual(versionOne.metadata);
  });

  it("produit après migration un document qui fait l'aller-retour à l'identique", () => {
    const migrated = parseNfgValue(versionOne);
    if (!migrated.ok) throw new Error("migration attendue");
    const again = parseNfgText(serializeNfg(migrated.document));
    expect(again.ok && again.document).toEqual(migrated.document);
  });

  it("ne modifie pas la valeur d'origine", () => {
    const copy = JSON.parse(JSON.stringify(versionOne)) as typeof versionOne;
    parseNfgValue(copy);
    expect(copy).toEqual(versionOne);
  });

  it("refuse proprement un fichier version 1 mal formé, sans exception", () => {
    expect(errorCodes({ ...versionOne, configurations: "cassé" })).toEqual(["import.schema"]);
    expect(errorCodes({ ...versionOne, configurations: { pc1: 42, r1: versionOne.configurations.r1 } })).toEqual(["import.schema"]);
  });

  it("refuse une version 2 sans liste de routes (champ obligatoire)", () => {
    expect(errorCodes({ ...versionOne, schemaVersion: 2 })).toEqual(["import.schema", "import.schema"]);
  });

  it("migre un fichier version 2 en ajoutant des annotations vides", () => {
    const versionTwo = {
      ...versionOne,
      schemaVersion: 2,
      configurations: Object.fromEntries(Object.entries(versionOne.configurations).map(([id, config]) => [id, { ...config, staticRoutes: [] }])),
    };
    const result = parseNfgValue(versionTwo);
    expect(result.ok && result.document.layout).toEqual({ ...versionOne.layout, annotations: [] });
  });

  it("refuse une version 3 sans liste d'annotations", () => {
    const migrated = parseNfgValue(versionOne);
    if (!migrated.ok) throw new Error("migration attendue");
    const { annotations: _removed, ...layout } = migrated.document.layout;
    expect(errorCodes({ ...migrated.document, layout })).toEqual(["import.schema"]);
  });

  it("migre un fichier version 3 : catalogue 2, liens en cuivre et pannes vides", () => {
    const versionThree = {
      ...versionOne,
      schemaVersion: 3,
      configurations: Object.fromEntries(Object.entries(versionOne.configurations).map(([id, config]) => [id, { ...config, staticRoutes: [] }])),
      layout: { ...versionOne.layout, annotations: [] },
    };
    const result = parseNfgValue(versionThree);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(4);
    expect(result.document.models.catalog).toBe(2);
    expect(result.document.topology.links[0]?.fiber).toBeNull();
    expect(result.document.faults).toEqual([]);
  });

  it("refuse une version 4 sans liste de pannes ni propriété de fibre", () => {
    const migrated = parseNfgValue(versionOne);
    if (!migrated.ok) throw new Error("migration attendue");
    const { faults: _removed, ...withoutFaults } = migrated.document;
    expect(errorCodes(withoutFaults)).toEqual(["import.schema"]);
    const links = migrated.document.topology.links.map(({ fiber: _fiber, ...link }) => link);
    expect(errorCodes({ ...migrated.document, topology: { ...migrated.document.topology, links } })).toEqual(["import.schema"]);
  });

  it("refuse des routes statiques sur un PC dans un fichier importé", () => {
    let doc = projectWith(["pc1", "PC"], ["r1", "R-200"]);
    doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "r1" }));
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.10", prefixLength: 24 } }));
    const pc1 = doc.configurations["pc1"];
    if (!pc1) throw new Error("configuration attendue");
    const tampered = {
      ...doc,
      configurations: {
        ...doc.configurations,
        pc1: { ...pc1, staticRoutes: [{ destination: "10.0.0.0", prefixLength: 8, nextHop: "192.168.1.1" }] },
      },
    };
    expect(errorCodes(tampered)).toEqual(["config.routes-not-supported"]);
  });
});
