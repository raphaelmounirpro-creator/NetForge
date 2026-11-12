import { describe, expect, it } from "vitest";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { setDefaultGateway, setDhcpPool, setInterfaceDhcp, setInterfaceIpv4 } from "./commands.js";
import { formatLeaseDuration, parseDhcpPoolInput, parseLeaseDuration, poolSize } from "./dhcp.js";
import type { NfgDocument } from "./schema.js";
import { expectOk, projectWith } from "./test-helpers.js";
import { validateDocument } from "./validation.js";

const codes = (result: { ok: boolean; errors?: Array<{ code: string }> }) => result.errors?.map((issue) => issue.code);
const warnings = (result: { ok: boolean; warnings?: Array<{ code: string }> }) => result.warnings?.map((issue) => issue.code);

function session(doc: NfgDocument, deviceId: string, lines: readonly string[]): NfgDocument {
  let mode: CliMode = OPERATION_MODE;
  let current = doc;
  for (const line of lines) {
    const result = interpret(current, deviceId, mode, line);
    mode = result.mode;
    if (!result.ok) throw new Error(`refus : ${line}`);
    if (result.edit) current = expectOk(result.edit(current));
  }
  return current;
}

/** Routeur r1 (ge0 en 192.168.1.1/24, ge1 en 10.0.0.1/30), poste pc1 et switch sw1. */
function base(): NfgDocument {
  let doc = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge1", ipv4: { address: "10.0.0.1", prefixLength: 30 } }));
  return doc;
}

const POOL = { start: "192.168.1.100", end: "192.168.1.149", gateway: "192.168.1.1", leaseSeconds: 3600 };

describe("DHCP : durées de bail et plages", () => {
  it("lit une durée en secondes ou avec une unité, et l'écrit dans la plus grande unité exacte", () => {
    expect(["3600", "90s", "30m", "12h", "1d", "2j", " 1D "].map(parseLeaseDuration)).toEqual([3600, 90, 1800, 43200, 86400, 172800, 86400]);
    expect(["", "1w", "-5", "1.5h", "h"].map(parseLeaseDuration)).toEqual([null, null, null, null, null]);
    expect([86400, 43200, 1800, 90, 604800].map(formatLeaseDuration)).toEqual(["1d", "12h", "30m", "90s", "7d"]);
  });

  it("compte les adresses d'une plage, bornes comprises", () => {
    expect(poolSize(POOL)).toBe(50);
    expect(poolSize({ start: "10.0.0.5", end: "10.0.0.5" })).toBe(1);
    expect(poolSize({ start: "10.0.0.9", end: "10.0.0.5" })).toBe(0);
  });

  it("analyse une saisie de plage et signale chaque valeur invalide", () => {
    expect(parseDhcpPoolInput({ start: "192.168.1.100", end: "192.168.1.149", gateway: "192.168.1.1", lease: "1h" })).toEqual({ ok: true, pool: POOL });
    const bad = parseDhcpPoolInput({ start: "192.168.1", end: "192.168.1.149", gateway: "x", lease: "10s" });
    expect(bad.ok ? [] : bad.errors.map((issue) => issue.code)).toEqual(["ipv4.invalid-address", "ipv4.invalid-address", "dhcp.invalid-lease"]);
    const tooLong = parseDhcpPoolInput({ ...POOL, gateway: POOL.gateway, lease: "8d" });
    expect(tooLong.ok ? [] : tooLong.errors).toEqual([{ code: "dhcp.invalid-lease", severity: "error", params: { value: "8d", min: 60, max: 604800 } }]);
  });
});

describe("DHCP : configuration du client (PC)", () => {
  it("passe un PC en adressage automatique : ni adresse ni passerelle manuelles", () => {
    let doc = base();
    doc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.10", prefixLength: 24 } }));
    doc = expectOk(setDefaultGateway(doc, { deviceId: "pc1", gateway: "192.168.1.1" }));
    const automatic = expectOk(setInterfaceDhcp(doc, { deviceId: "pc1", portId: "eth0", enabled: true }));
    expect(automatic.configurations["pc1"]?.interfaces).toEqual({ eth0: { ipv4: null, dhcp: true } });
    expect(automatic.configurations["pc1"]?.defaultGateway).toBeNull();
    // Une adresse manuelle remet l'interface en adressage manuel.
    const manual = expectOk(setInterfaceIpv4(automatic, { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.20", prefixLength: 24 } }));
    expect(manual.configurations["pc1"]?.interfaces).toEqual({ eth0: { ipv4: { address: "192.168.1.20", prefixLength: 24 }, dhcp: false } });
    // Désactivé sans adresse : interface non configurée.
    expect(expectOk(setInterfaceDhcp(automatic, { deviceId: "pc1", portId: "eth0", enabled: false })).configurations["pc1"]?.interfaces).toEqual({});
  });

  it("réserve le client DHCP aux PC et refuse une passerelle manuelle en adressage automatique", () => {
    const doc = base();
    expect(codes(setInterfaceDhcp(doc, { deviceId: "r1", portId: "ge0", enabled: true }))).toEqual(["config.dhcp-client-not-supported"]);
    expect(codes(setInterfaceDhcp(doc, { deviceId: "pc1", portId: "eth9", enabled: true }))).toEqual(["config.unknown-port"]);
    const automatic = expectOk(setInterfaceDhcp(doc, { deviceId: "pc1", portId: "eth0", enabled: true }));
    expect(codes(setDefaultGateway(automatic, { deviceId: "pc1", gateway: "192.168.1.1" }))).toEqual(["config.dhcp-with-gateway"]);
  });

  it("refuse un document importé qui mêle adresse manuelle et DHCP", () => {
    const doc = base();
    const pc = doc.configurations["pc1"];
    const router = doc.configurations["r1"];
    if (!pc || !router) throw new Error("configurations attendues");
    const imported: NfgDocument = {
      ...doc,
      configurations: {
        ...doc.configurations,
        pc1: { ...pc, interfaces: { eth0: { ipv4: { address: "192.168.1.10", prefixLength: 24 }, dhcp: true } } },
        r1: { ...router, interfaces: { ...router.interfaces, ge2: { ipv4: null, dhcp: true } } },
      },
    };
    expect(validateDocument(imported).map((issue) => issue.code)).toEqual(expect.arrayContaining(["config.dhcp-with-address", "config.dhcp-client-not-supported"]));
  });
});

describe("DHCP : plages du serveur (routeur)", () => {
  it("enregistre une plage sur une interface adressée et la retire", () => {
    const doc = expectOk(setDhcpPool(base(), { deviceId: "r1", interfaceId: "ge0", pool: POOL }));
    expect(doc.configurations["r1"]?.dhcpPools).toEqual({ ge0: POOL });
    expect(validateDocument(doc)).toEqual([]);
    expect(expectOk(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0", pool: null })).configurations["r1"]?.dhcpPools).toEqual({});
  });

  it("refuse une plage hors d'un routeur, sur une interface sans adresse, inversée ou hors du réseau", () => {
    const doc = base();
    expect(codes(setDhcpPool(doc, { deviceId: "sw1", interfaceId: "ge1", pool: POOL }))).toEqual(["config.dhcp-server-not-supported"]);
    expect(codes(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge2", pool: POOL }))).toEqual(["dhcp.interface-not-addressed"]);
    expect(codes(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge9", pool: POOL }))).toEqual(["config.unknown-port"]);
    expect(codes(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0", pool: { ...POOL, start: "192.168.1.150" } }))).toEqual(["dhcp.invalid-range"]);
    // Adresse de réseau, de diffusion ou d'un autre réseau : non distribuable.
    for (const range of [{ start: "192.168.1.0" }, { end: "192.168.1.255" }, { end: "192.168.2.10" }]) {
      expect(codes(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0", pool: { ...POOL, ...range } }))).toEqual(["dhcp.range-outside-subnet"]);
    }
    expect(codes(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0", pool: { ...POOL, leaseSeconds: 30 } }))).toEqual(["dhcp.invalid-lease"]);
  });

  it("avertit d'une passerelle hors du réseau et d'une adresse manuelle comprise dans la plage", () => {
    const doc = base();
    expect(warnings(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0", pool: { ...POOL, gateway: "10.0.0.2" } }))).toEqual(["dhcp.gateway-outside-subnet"]);
    const pc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.120", prefixLength: 24 } }));
    const result = setDhcpPool(pc, { deviceId: "r1", interfaceId: "ge0", pool: POOL });
    expect(result.ok ? result.warnings : []).toEqual([
      {
        code: "dhcp.range-contains-static",
        severity: "warning",
        params: { deviceId: "r1", deviceName: "R1", portId: "ge0", address: "192.168.1.120", otherDeviceId: "pc1", otherDeviceName: "PC1", otherPortId: "eth0" },
      },
    ]);
  });

  it("accepte une plage sur une sous-interface 802.1Q", () => {
    const doc = expectOk(setInterfaceIpv4(base(), { deviceId: "r1", portId: "ge2.10", ipv4: { address: "10.10.0.1", prefixLength: 24 } }));
    const pool = { start: "10.10.0.50", end: "10.10.0.60", gateway: "10.10.0.1", leaseSeconds: 86400 };
    expect(expectOk(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge2.10", pool })).configurations["r1"]?.dhcpPools).toEqual({ "ge2.10": pool });
  });
});

describe("DHCP : console équivalente aux formulaires", () => {
  it("ipconfig dhcp donne le même document que le formulaire ; renew et release sont des demandes d'exécution", () => {
    const doc = base();
    expect(session(doc, "pc1", ["ipconfig dhcp"])).toEqual(expectOk(setInterfaceDhcp(doc, { deviceId: "pc1", portId: "eth0", enabled: true })));
    const renew = interpret(doc, "pc1", OPERATION_MODE, "ipconfig renew");
    const release = interpret(doc, "pc1", OPERATION_MODE, "ipconfig release");
    expect([renew.ok && renew.request, release.ok && release.request]).toEqual([
      { kind: "dhcp", action: "renew" },
      { kind: "dhcp", action: "release" },
    ]);
    expect(configurationCommands(session(doc, "pc1", ["ipconfig dhcp"]), "pc1")).toEqual(["ipconfig dhcp"]);
  });

  it("dhcp pool : passerelle et bail par défaut (adresse de l'interface, 1 jour), options explicites", () => {
    const doc = base();
    const defaults = session(doc, "r1", ["configure", "interface ge0", "dhcp pool 192.168.1.100 192.168.1.149"]);
    expect(defaults.configurations["r1"]?.dhcpPools).toEqual({ ge0: { ...POOL, leaseSeconds: 86400 } });
    const explicit = session(doc, "r1", ["configure", "interface ge0", "dhcp pool 192.168.1.100 192.168.1.149 lease 1h gateway 192.168.1.1"]);
    expect(explicit).toEqual(expectOk(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0", pool: POOL })));
    expect(session(explicit, "r1", ["configure", "interface ge0", "dhcp clear"]).configurations["r1"]?.dhcpPools).toEqual({});
  });

  it("explique une option inconnue, une valeur manquante et une interface sans adresse", () => {
    const iface: CliMode = { kind: "interface", portId: "ge0" };
    const error = (line: string, mode: CliMode = iface) => {
      const result = interpret(base(), "r1", mode, line);
      return result.ok ? null : (result.error ?? result.issues[0]?.code);
    };
    expect(error("dhcp pool 192.168.1.100 192.168.1.149 dns 8.8.8.8")).toMatchObject({ code: "cli.unexpected-argument", params: { word: "dns" } });
    expect(error("dhcp pool 192.168.1.100 192.168.1.149 lease")).toMatchObject({ code: "cli.missing-argument", params: { argument: "durée" } });
    expect(error("dhcp pool 192.168.1.10 192.168.1.20", { kind: "interface", portId: "ge2" })).toBe("dhcp.interface-not-addressed");
    expect(error("dhcp pool 192.168.1.100 192.168.1.149", { kind: "config" })).toMatchObject({ code: "cli.wrong-mode" });
  });

  it("réécrit les plages en commandes rejouables sur un routeur vierge", () => {
    let doc = expectOk(setInterfaceIpv4(base(), { deviceId: "r1", portId: "ge0.20", ipv4: { address: "10.20.0.1", prefixLength: 24 } }));
    doc = expectOk(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0", pool: POOL }));
    doc = expectOk(setDhcpPool(doc, { deviceId: "r1", interfaceId: "ge0.20", pool: { start: "10.20.0.10", end: "10.20.0.19", gateway: "10.20.0.1", leaseSeconds: 43200 } }));
    const lines = configurationCommands(doc, "r1");
    expect(lines).toEqual(expect.arrayContaining(["dhcp pool 192.168.1.100 192.168.1.149 gateway 192.168.1.1 lease 1h", "dhcp pool 10.20.0.10 10.20.0.19 gateway 10.20.0.1 lease 12h"]));
    const blank = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
    expect(session(blank, "r1", lines).configurations["r1"]).toEqual(doc.configurations["r1"]);
  });
});
