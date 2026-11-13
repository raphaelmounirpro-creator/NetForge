import { describe, expect, it } from "vitest";
import { setPonAuthorization, connectDevices, setDhcpPool, setDnsRecord, setInterfaceDhcp, setInterfaceIpv4, setOspfInterface, setRipInterface } from "./commands.js";
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

describe("migration du format version 1 → 16", () => {
  it("migre un fichier version 1 sans perte et ajoute des routes vides", () => {
    const result = parseNfgText(JSON.stringify(versionOne));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.schemaVersion).toBe(16);
    expect(result.document.models).toEqual({ catalog: 3 });
    expect(result.document.faults).toEqual([]);
    // Routes (v2), ports de switch, STP (v5), DHCP (v6), DNS (v7), RIP (v8) et OSPF (v9) : tous les ports en accès dans
    // le VLAN 1, aucun STP hors switch, adressage manuel conservé, aucun serveur DHCP, ni résolveur ni service DNS,
    // aucune interface RIP ni OSPF.
    expect(result.document.configurations["pc1"]).toEqual({
      ...versionOne.configurations.pc1,
      interfaces: { eth0: { ipv4: { address: "192.168.1.10", prefixLength: 24 }, dhcp: false } },
      staticRoutes: [],
      switchports: {},
      stp: null,
      dhcpPools: {},
      dnsServer: null,
      dnsRecords: null,
      ripInterfaces: {},
      ospfInterfaces: {},
      vrrpGroups: {},
      bgp: null,
      ponAuthorizations: {},
      serialNumber: null,
      ponServices: {},
    });
    expect(result.document.configurations["r1"]).toEqual({
      ...versionOne.configurations.r1,
      interfaces: { ge0: { ipv4: { address: "192.168.1.1", prefixLength: 24 }, dhcp: false } },
      staticRoutes: [],
      switchports: {},
      stp: null,
      dhcpPools: {},
      dnsServer: null,
      dnsRecords: null,
      ripInterfaces: {},
      ospfInterfaces: {},
      vrrpGroups: {},
      bgp: null,
      ponAuthorizations: {},
      serialNumber: null,
      ponServices: {},
    });
    // Tous les liens d'une version antérieure sont en cuivre : aucune propriété de fibre ; aucune implantation (v16).
    expect(result.document.topology).toEqual({
      devices: versionOne.topology.devices.map((device) => ({ ...device, location: null })),
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
    expect(result.document.schemaVersion).toBe(16);
    expect(result.document.models.catalog).toBe(3);
    expect(result.document.topology.links[0]?.fiber).toBeNull();
    expect(result.document.faults).toEqual([]);
  });

  it("migre un fichier version 4 en ajoutant des ports de switch vides (VLAN 1 partout)", () => {
    const migrated = parseNfgValue(versionOne);
    if (!migrated.ok) throw new Error("migration attendue");
    const versionFour = {
      ...migrated.document,
      schemaVersion: 4,
      configurations: Object.fromEntries(Object.entries(migrated.document.configurations).map(([id, { switchports: _ports, stp: _stp, ...config }]) => [id, config])),
    };
    const result = parseNfgValue(versionFour);
    expect(result.ok && result.document).toEqual(migrated.document);
  });

  it("donne à un switch d'un fichier version 4 STP désactivé : une boucle existante reste un cas d'étude", () => {
    const versionFour = {
      ...versionOne,
      schemaVersion: 4,
      models: { catalog: 2 },
      topology: { devices: [...versionOne.topology.devices, { id: "sw1", model: "S-24", name: "SW1" }], links: versionOne.topology.links.map((link) => ({ ...link, fiber: null })) },
      configurations: {
        pc1: { ...versionOne.configurations.pc1, staticRoutes: [] },
        r1: { ...versionOne.configurations.r1, staticRoutes: [] },
        sw1: { interfaces: {}, defaultGateway: null, staticRoutes: [] },
      },
      layout: { ...versionOne.layout, devices: { ...versionOne.layout.devices, sw1: { x: 100, y: 100 } }, annotations: [] },
      faults: [],
    };
    const result = parseNfgValue(versionFour);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.document.configurations["sw1"]?.stp).toEqual({ enabled: false, priority: 32768 });
    expect(result.document.configurations["r1"]?.stp).toBeNull();
  });

  it("migre les anciens fichiers v5 en conservant VLAN, STP, adresses et routes sans activer DHCP", () => {
    const current = expectOk(setInterfaceIpv4(projectWith(["pc1", "PC"]), { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.10", prefixLength: 24 } }));
    const old = { ...current, schemaVersion: 5, configurations: Object.fromEntries(Object.entries(current.configurations).map(([id, { dhcpPools: _pools, dnsServer: _server, dnsRecords: _records, ...config }]) => [id, { ...config, interfaces: Object.fromEntries(Object.entries(config.interfaces).map(([port, { dhcp: _dhcp, ...value }]) => [port, value])) }])) };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
    expect(old.schemaVersion).toBe(5);
  });

  it("migre les anciens fichiers v6 en conservant DHCP sans activer de résolveur ni de service DNS", () => {
    let current = expectOk(setInterfaceDhcp(projectWith(["pc1", "PC"], ["r1", "R-200"]), { deviceId: "pc1", portId: "eth0", enabled: true }));
    current = expectOk(setInterfaceIpv4(current, { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
    current = expectOk(setDhcpPool(current, { deviceId: "r1", interfaceId: "ge0", pool: { start: "192.168.1.100", end: "192.168.1.110", gateway: "192.168.1.1", leaseSeconds: 3600 } }));
    const old = { ...current, schemaVersion: 6, configurations: Object.fromEntries(Object.entries(current.configurations).map(([id, { dnsServer: _server, dnsRecords: _records, ...config }]) => [id, config])) };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
    // Un fichier v7 doit porter les deux champs DNS : deux manques par équipement.
    expect(errorCodes({ ...old, schemaVersion: 7 })).toEqual(Array.from({ length: 4 }, () => "import.schema"));
  });

  it("migre les anciens fichiers v7 en conservant DNS sans faire participer de routeur à RIP", () => {
    let current = expectOk(setInterfaceIpv4(projectWith(["pc1", "PC"], ["r1", "R-200"]), { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
    current = expectOk(setDnsRecord(current, { deviceId: "r1", name: "srv.lab", address: "192.168.1.10" }));
    const old = {
      ...current,
      schemaVersion: 7,
      configurations: Object.fromEntries(Object.entries(current.configurations).map(([id, { ripInterfaces: _rip, ospfInterfaces: _ospf, vrrpGroups: _vrrp, bgp: _bgp, ...config }]) => [id, config])),
    };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
  });

  it("migre les anciens fichiers v8 en conservant RIP sans faire participer de routeur à OSPF", () => {
    let current = expectOk(setInterfaceIpv4(projectWith(["pc1", "PC"], ["r1", "R-200"]), { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
    current = expectOk(setRipInterface(current, { deviceId: "r1", interfaceId: "ge0", mode: "active" }));
    const old = { ...current, schemaVersion: 8, configurations: Object.fromEntries(Object.entries(current.configurations).map(([id, { ospfInterfaces: _ospf, vrrpGroups: _vrrp, bgp: _bgp, ...config }]) => [id, config])) };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
    expect(result.ok && result.document.configurations["r1"]?.ripInterfaces).toEqual({ ge0: "active" });
    // Un fichier v9 doit porter la table OSPF de chaque configuration.
    expect(errorCodes({ ...old, schemaVersion: 9 })).toEqual(["import.schema", "import.schema"]);
  });

  it("migre les anciens fichiers v12 : catalogue 3, numéro de série NetForge par ONT dans l'ordre des équipements, aucun ONT autorisé", () => {
    const current = projectWith(["olt1", "OLT-16"], ["ont1", "ONT-1G"], ["pc1", "PC"], ["ont2", "ONT-1G"]);
    const old = {
      ...current,
      schemaVersion: 12,
      models: { catalog: 2 },
      configurations: Object.fromEntries(Object.entries(current.configurations).map(([id, { ponAuthorizations: _pon, serialNumber: _serial, ...config }]) => [id, config])),
    };
    const result = parseNfgValue(old);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.models.catalog).toBe(3);
    expect(Object.fromEntries(Object.entries(result.document.configurations).map(([id, config]) => [id, config.serialNumber]))).toEqual({ olt1: null, ont1: "NFGE00000001", pc1: null, ont2: "NFGE00000002" });
    expect(result.document.configurations["olt1"]?.ponAuthorizations).toEqual({});
    // Un fichier v13 doit porter les deux champs PON de chaque configuration.
    expect(errorCodes({ ...old, schemaVersion: 13, models: { catalog: 3 } })).toContain("import.schema");
  });

  it("migre les anciens fichiers v13 : aucun profil de service, aucun service souscrit", () => {
    let current = projectWith(["olt1", "OLT-16"], ["ont1", "ONT-1G"]);
    current = expectOk(setPonAuthorization(current, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true }));
    const old = {
      ...current,
      schemaVersion: 13,
      configurations: Object.fromEntries(
        Object.entries(current.configurations).map(([id, { ponServices: _services, ponAuthorizations, ...config }]) => [
          id,
          { ...config, ponAuthorizations: Object.fromEntries(Object.entries(ponAuthorizations).map(([port, entries]) => [port, entries.map(({ services: _offer, ...entry }) => entry)])) },
        ]),
      ),
    };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
    expect(result.ok && result.document.configurations["olt1"]?.ponAuthorizations["pon1"]).toEqual([{ serial: "NFGE00000001", onuId: 0, services: [] }]);
  });

  it("migre les anciens fichiers v11 sans faire participer de routeur à BGP", () => {
    const current = expectOk(setInterfaceIpv4(projectWith(["pc1", "PC"], ["r1", "R-200"]), { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.2", prefixLength: 24 } }));
    const old = { ...current, schemaVersion: 11, configurations: Object.fromEntries(Object.entries(current.configurations).map(([id, { bgp: _bgp, ...config }]) => [id, config])) };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
    // Un fichier v12 doit porter le champ BGP de chaque configuration.
    expect(errorCodes({ ...old, schemaVersion: 12 })).toEqual(["import.schema", "import.schema"]);
  });

  it("migre les anciens fichiers v10 en plaçant les interfaces OSPF dans la dorsale", () => {
    let current = expectOk(setInterfaceIpv4(projectWith(["pc1", "PC"], ["r1", "R-200"]), { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.2", prefixLength: 24 } }));
    current = expectOk(setOspfInterface(current, { deviceId: "r1", interfaceId: "ge0", ospf: { mode: "active", cost: 20, priority: 1, area: "0.0.0.0" } }));
    const r1 = current.configurations["r1"];
    if (!r1) throw new Error("configuration attendue");
    const old = { ...current, schemaVersion: 10, configurations: { ...current.configurations, r1: { ...r1, ospfInterfaces: { ge0: { mode: "active", cost: 20, priority: 1 } } } } };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
    // Un fichier v11 doit porter la zone de chaque interface OSPF.
    expect(errorCodes({ ...old, schemaVersion: 11 })).toEqual(["import.schema"]);
  });

  it("migre les anciens fichiers v9 en conservant OSPF sans groupe VRRP", () => {
    let current = expectOk(setInterfaceIpv4(projectWith(["pc1", "PC"], ["r1", "R-200"]), { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.2", prefixLength: 24 } }));
    current = expectOk(setOspfInterface(current, { deviceId: "r1", interfaceId: "ge0", ospf: { mode: "passive", cost: 10, priority: 1, area: "0.0.0.0" } }));
    const old = { ...current, schemaVersion: 9, configurations: Object.fromEntries(Object.entries(current.configurations).map(([id, { vrrpGroups: _vrrp, bgp: _bgp, ...config }]) => [id, config])) };
    const result = parseNfgValue(old);
    expect(result.ok && result.document).toEqual(current);
    // Un fichier v10 doit porter la table VRRP de chaque configuration.
    expect(errorCodes({ ...old, schemaVersion: 10 })).toEqual(["import.schema", "import.schema"]);
  });

  it("refuse une version courante sans table de ports de switch", () => {
    const migrated = parseNfgValue(versionOne);
    if (!migrated.ok) throw new Error("migration attendue");
    const configurations = Object.fromEntries(Object.entries(migrated.document.configurations).map(([id, { switchports: _ports, ...config }]) => [id, config]));
    expect(errorCodes({ ...migrated.document, configurations })).toEqual(["import.schema", "import.schema"]);
    const withoutStp = Object.fromEntries(Object.entries(migrated.document.configurations).map(([id, { stp: _stp, ...config }]) => [id, config]));
    expect(errorCodes({ ...migrated.document, configurations: withoutStp })).toEqual(["import.schema", "import.schema"]);
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
