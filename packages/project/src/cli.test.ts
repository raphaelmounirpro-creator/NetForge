import { describe, expect, it } from "vitest";
import { cliPrompt, complete, configurationCommands, interpret, OPERATION_MODE, type CliMode, type CliResult } from "./cli.js";
import { addStaticRoute, connectDevices, setDefaultGateway, setInterfaceIpv4, setSwitchport, type CommandResult } from "./commands.js";
import type { NfgDocument } from "./schema.js";
import { expectOk, projectWith } from "./test-helpers.js";

function base(): NfgDocument {
  let doc = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
  doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
  return expectOk(connectDevices(doc, { linkId: "l2", aDeviceId: "r1", bDeviceId: "sw1" }));
}

/** Exécute une suite de lignes comme dans la console ; renvoie le document et le mode final. */
function session(doc: NfgDocument, deviceId: string, lines: readonly string[]): { doc: NfgDocument; mode: CliMode; last: CliResult } {
  let mode: CliMode = OPERATION_MODE;
  let current = doc;
  let last: CliResult = { ok: true, mode, edit: null, request: null };
  for (const line of lines) {
    last = interpret(current, deviceId, mode, line);
    mode = last.mode;
    if (last.ok && last.edit) current = expectOk(last.edit(current));
  }
  return { doc: current, mode, last };
}

const errorOf = (result: CliResult) => (result.ok ? null : result.error);

describe("console : mêmes commandes métier que les formulaires", () => {
  it("adresse d'interface : document identique à celui du formulaire", () => {
    const viaCli = session(base(), "r1", ["configure", "interface ge0", "address 192.168.1.1 255.255.255.0"]).doc;
    const viaForm = expectOk(setInterfaceIpv4(base(), { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
    expect(viaCli).toEqual(viaForm);
    expect(session(base(), "r1", ["configure", "interface ge0", "address 192.168.1.1/24"]).doc).toEqual(viaForm);
  });

  it("route statique : document identique à celui du formulaire", () => {
    const start = expectOk(setInterfaceIpv4(base(), { deviceId: "r1", portId: "ge1", ipv4: { address: "10.0.12.1", prefixLength: 30 } }));
    const viaCli = session(start, "r1", ["configure", "route add 10.0.2.0/24 via 10.0.12.2"]).doc;
    const viaForm = expectOk(addStaticRoute(start, { deviceId: "r1", route: { destination: "10.0.2.0", prefixLength: 24, nextHop: "10.0.12.2" } }));
    expect(viaCli).toEqual(viaForm);
    expect(session(start, "r1", ["configure", "route add 10.0.2.0 255.255.255.0 via 10.0.12.2"]).doc).toEqual(viaForm);
  });

  it("configuration IP d'un PC : document identique à celui des formulaires", () => {
    const viaCli = session(base(), "pc1", ["ipconfig set 192.168.1.10 255.255.255.0 192.168.1.1"]).doc;
    let viaForm = expectOk(setInterfaceIpv4(base(), { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.10", prefixLength: 24 } }));
    viaForm = expectOk(setDefaultGateway(viaForm, { deviceId: "pc1", gateway: "192.168.1.1" }));
    expect(viaCli).toEqual(viaForm);
    expect(session(viaCli, "pc1", ["ipconfig clear"]).doc.configurations["pc1"]).toEqual({ interfaces: {}, defaultGateway: null, staticRoutes: [], switchports: {}, stp: null, dhcpPools: {}, dnsServer: null, dnsRecords: null, ripInterfaces: {}, ospfInterfaces: {}, vrrpGroups: {} });
  });

  it("refuse avec les mêmes validations que les formulaires", () => {
    const result = interpret(base(), "r1", { kind: "interface", portId: "ge0" }, "address 192.168.1.0/24");
    expect(result.ok).toBe(true);
    const applied: CommandResult | null = result.ok && result.edit ? result.edit(base()) : null;
    expect(applied?.ok).toBe(false);
    if (applied && !applied.ok) expect(applied.errors[0]).toMatchObject({ code: "ipv4.unassignable", params: { reason: "network-address" } });
    const bad = interpret(base(), "r1", { kind: "interface", portId: "ge0" }, "address 300.1.1.1/24");
    expect(bad.ok ? [] : bad.issues.map((issue) => issue.code)).toEqual(["ipv4.invalid-address"]);
  });

  it("renomme l'équipement avec hostname", () => {
    expect(session(base(), "r1", ["configure", "hostname CORE-1"]).doc.topology.devices.find((device) => device.id === "r1")?.name).toBe("CORE-1");
  });
});

describe("console : modes, abréviations et erreurs pédagogiques", () => {
  it("passe d'un mode à l'autre et l'indique dans l'invite", () => {
    const doc = base();
    const r1 = doc.topology.devices.find((device) => device.id === "r1");
    if (!r1) throw new Error("R1 attendu");
    const modes: string[] = [];
    let mode: CliMode = OPERATION_MODE;
    for (const line of ["configure", "interface ge2", "exit", "interface ge0", "end"]) {
      mode = interpret(doc, "r1", mode, line).mode;
      modes.push(cliPrompt(r1, mode));
    }
    expect(modes).toEqual(["R1(config)>", "R1(config ge2)>", "R1(config)>", "R1(config ge0)>", "R1>"]);
  });

  it("accepte les abréviations non ambiguës", () => {
    expect(interpret(base(), "r1", OPERATION_MODE, "sh int")).toMatchObject({ ok: true, request: { kind: "show-interfaces" } });
    expect(interpret(base(), "r1", OPERATION_MODE, "conf")).toMatchObject({ ok: true, mode: { kind: "config" } });
    expect(interpret(base(), "r1", { kind: "config" }, "int GE1")).toMatchObject({ ok: true, mode: { kind: "interface", portId: "ge1" } });
  });

  it("signale une abréviation ambiguë avec les possibilités", () => {
    expect(errorOf(interpret(base(), "r1", { kind: "config" }, "e"))).toEqual({ code: "cli.ambiguous", params: { word: "e", candidates: "end, exit" } });
  });

  it("propose une correction pour une faute de frappe", () => {
    expect(errorOf(interpret(base(), "r1", OPERATION_MODE, "shwo interfaces"))).toEqual({
      code: "cli.unknown-command",
      params: { word: "shwo", suggestion: "show" },
    });
  });

  it("indique le bon mode pour une commande d'un autre mode", () => {
    expect(errorOf(interpret(base(), "r1", OPERATION_MODE, "address 10.0.0.1/24"))).toEqual({
      code: "cli.wrong-mode",
      params: { command: "address", mode: "interface" },
    });
    expect(errorOf(interpret(base(), "r1", { kind: "config" }, "configure"))).toMatchObject({ code: "cli.wrong-mode", params: { mode: "operation" } });
  });

  it("nomme l'argument manquant et la syntaxe attendue", () => {
    expect(errorOf(interpret(base(), "r1", { kind: "config" }, "route add 10.0.1.0/24"))).toMatchObject({
      code: "cli.missing-argument",
      params: { argument: "via" },
    });
    expect(errorOf(interpret(base(), "r1", { kind: "config" }, "hostname"))).toMatchObject({
      code: "cli.missing-argument",
      params: { argument: "nom", usage: "hostname <nom>" },
    });
    expect(errorOf(interpret(base(), "r1", OPERATION_MODE, "show"))).toEqual({
      code: "cli.incomplete",
      params: { command: "show", options: "arp, config, dhcp, dns, interfaces, ospf, rip, routes, vrrp" },
    });
    expect(errorOf(interpret(base(), "r1", { kind: "interface", portId: "ge0" }, "address 10.0.0.1"))).toMatchObject({
      params: { argument: "masque" },
    });
  });

  it("refuse un argument en trop et un port inexistant", () => {
    expect(errorOf(interpret(base(), "r1", OPERATION_MODE, "show routes maintenant"))).toEqual({
      code: "cli.unexpected-argument",
      params: { word: "maintenant" },
    });
    expect(errorOf(interpret(base(), "r1", { kind: "config" }, "interface ge9"))).toEqual({
      code: "cli.unknown-port",
      params: { port: "ge9", ports: "ge0, ge1, ge2, ge3" },
    });
  });

  it("adapte les commandes au type d'équipement", () => {
    expect(interpret(base(), "sw1", OPERATION_MODE, "show mac")).toMatchObject({ ok: true, request: { kind: "show-mac" } });
    expect(errorOf(interpret(base(), "sw1", OPERATION_MODE, "show routes"))).toMatchObject({ code: "cli.incomplete" });
    expect(interpret(base(), "pc1", OPERATION_MODE, "arp -a")).toMatchObject({ ok: true, request: { kind: "show-arp" } });
    expect(interpret(base(), "pc1", OPERATION_MODE, "arp -d")).toMatchObject({ ok: true, request: { kind: "clear-table", table: "arp" } });
    expect(interpret(base(), "sw1", OPERATION_MODE, "clear mac")).toMatchObject({ ok: true, request: { kind: "clear-table", table: "mac" } });
  });
});

describe("console : ping, aide et complétion", () => {
  it("analyse le ping et son nombre d'échos", () => {
    expect(interpret(base(), "pc1", OPERATION_MODE, "ping 10.0.0.1")).toMatchObject({ request: { kind: "ping", destination: "10.0.0.1", count: 4 } });
    expect(interpret(base(), "pc1", OPERATION_MODE, "ping 10.0.0.1 -n 2")).toMatchObject({ request: { kind: "ping", count: 2 } });
    expect(errorOf(interpret(base(), "pc1", OPERATION_MODE, "ping 10.0.0.1 -n 0"))).toMatchObject({ code: "cli.invalid-count" });
    expect(errorOf(interpret(base(), "pc1", OPERATION_MODE, "ping"))).toMatchObject({ code: "cli.missing-argument", params: { argument: "adresse" } });
  });

  it("donne l'aide du mode courant et l'aide contextuelle", () => {
    const help = interpret(base(), "r1", { kind: "interface", portId: "ge0" }, "?");
    const ids = help.ok && help.request?.kind === "help" ? help.request.entries.map((entry) => entry.id) : [];
    expect(ids).toEqual(expect.arrayContaining(["address", "address-clear", "exit", "end", "show-routes"]));
    expect(ids).not.toContain("configure");
    const contextual = interpret(base(), "r1", OPERATION_MODE, "show ?");
    expect(contextual.ok && contextual.request?.kind === "help" ? contextual.request.entries.map((entry) => entry.usage) : []).toEqual([
      "show interfaces",
      "show routes",
      "show arp",
      "show config",
      "show dhcp",
      "show dns",
      "show ospf",
      "show ospf database",
      "show vrrp",
      "show rip",
    ]);
  });

  it("complète le mot en cours ou liste les possibilités", () => {
    expect(complete(base(), "r1", OPERATION_MODE, "sh")).toEqual({ line: "show ", candidates: ["show"] });
    expect(complete(base(), "r1", OPERATION_MODE, "show i")).toEqual({ line: "show interfaces ", candidates: ["interfaces"] });
    expect(complete(base(), "r1", OPERATION_MODE, "c").candidates).toEqual(["clear", "cls", "configure"]);
    expect(complete(base(), "r1", { kind: "config" }, "interface g").candidates).toEqual(["ge0", "ge1", "ge2", "ge3"]);
    expect(complete(base(), "r1", { kind: "config" }, "interface ge1")).toEqual({ line: "interface ge1 ", candidates: ["ge1"] });
  });
});

describe("console : configuration réécrite en commandes", () => {
  it("rejouer « show config » sur un équipement vierge redonne la même configuration", () => {
    let doc = setInterfaceIpv4(base(), { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } });
    doc = (doc.ok ? setInterfaceIpv4(doc.document, { deviceId: "r1", portId: "ge1", ipv4: { address: "10.0.12.1", prefixLength: 30 } }) : doc);
    const configured = expectOk(
      doc.ok ? addStaticRoute(doc.document, { deviceId: "r1", route: { destination: "10.0.2.0", prefixLength: 24, nextHop: "10.0.12.2" } }) : doc,
    );
    const commands = configurationCommands(configured, "r1");
    expect(commands).toEqual([
      "configure",
      "hostname R1",
      "interface ge0",
      "address 192.168.1.1/24",
      "exit",
      "interface ge1",
      "address 10.0.12.1/30",
      "exit",
      "route add 10.0.2.0/24 via 10.0.12.2",
      "end",
    ]);
    const replayed = session(base(), "r1", commands).doc;
    expect(replayed.configurations["r1"]).toEqual(configured.configurations["r1"]);
  });

  it("réécrit la configuration d'un PC en une ligne ipconfig", () => {
    const configured = session(base(), "pc1", ["ipconfig set 192.168.1.10/24 192.168.1.1"]).doc;
    expect(configurationCommands(configured, "pc1")).toEqual(["ipconfig set 192.168.1.10 255.255.255.0 192.168.1.1"]);
  });
});

describe("console : VLAN", () => {
  it("port d'accès et trunk : documents identiques à ceux des formulaires", () => {
    const viaCli = session(base(), "sw1", ["configure", "interface ge1", "access vlan 10", "exit", "interface ge24", "trunk native 99 allowed 20,10,30-31", "end"]).doc;
    let viaForms = expectOk(setSwitchport(base(), { deviceId: "sw1", portId: "ge1", switchport: { mode: "access", vlan: 10 } }));
    viaForms = expectOk(setSwitchport(viaForms, { deviceId: "sw1", portId: "ge24", switchport: { mode: "trunk", nativeVlan: 99, allowedVlans: [10, 20, 30, 31] } }));
    expect(viaCli.configurations["sw1"]).toEqual(viaForms.configurations["sw1"]);
    // « trunk » seul : VLAN natif 1, tous les VLAN autorisés.
    const plain = session(base(), "sw1", ["configure", "interface ge2", "trunk"]).doc;
    expect(plain.configurations["sw1"]?.switchports["ge2"]).toEqual({ mode: "trunk", nativeVlan: 1, allowedVlans: "all" });
  });

  it("sous-interface de routeur : invite, adresse, document identique au formulaire", () => {
    const run = session(base(), "r1", ["configure", "interface ge0.10", "address 192.168.10.1/24"]);
    const router = base().topology.devices.find((device) => device.id === "r1");
    if (!router) throw new Error("routeur attendu");
    expect(cliPrompt(router, run.mode)).toBe("R1(config ge0.10)>");
    const viaForm = expectOk(setInterfaceIpv4(base(), { deviceId: "r1", portId: "ge0.10", ipv4: { address: "192.168.10.1", prefixLength: 24 } }));
    expect(run.doc.configurations["r1"]).toEqual(viaForm.configurations["r1"]);
  });

  it("refuse un VLAN invalide, un mot inattendu et une sous-interface sur un switch", () => {
    const badVlan = session(base(), "sw1", ["configure", "interface ge1", "access vlan 5000"]).last;
    expect(badVlan.ok ? null : badVlan.issues.map((issue) => issue.code)).toEqual(["vlan.invalid-id"]);
    expect(errorOf(session(base(), "sw1", ["configure", "interface ge1", "trunk natif 10"]).last)?.code).toBe("cli.unexpected-argument");
    expect(errorOf(session(base(), "sw1", ["configure", "interface ge1", "trunk allowed"]).last)?.code).toBe("cli.missing-argument");
    expect(errorOf(session(base(), "sw1", ["configure", "interface ge1.10"]).last)?.code).toBe("cli.unknown-port");
    expect(interpret(base(), "sw1", OPERATION_MODE, "show vlans")).toMatchObject({ ok: true, request: { kind: "show-vlans" } });
  });

  it("rejouer la configuration d'un switch et d'un routeur à sous-interfaces redonne la même configuration", () => {
    const configured = session(base(), "sw1", ["configure", "interface ge1", "access vlan 10", "exit", "interface ge24", "trunk native 99 allowed 10,20", "end"]).doc;
    const commands = configurationCommands(configured, "sw1");
    expect(commands).toEqual(["configure", "hostname SW1", "interface ge1", "access vlan 10", "exit", "interface ge24", "trunk native 99 allowed 10,20", "exit", "end"]);
    expect(session(base(), "sw1", commands).doc.configurations["sw1"]).toEqual(configured.configurations["sw1"]);

    const router = session(base(), "r1", ["configure", "interface ge0.20", "address 192.168.20.1/24", "exit", "interface ge0.10", "address 192.168.10.1/24", "end"]).doc;
    const routerCommands = configurationCommands(router, "r1");
    expect(routerCommands.slice(2, 8)).toEqual(["interface ge0.10", "address 192.168.10.1/24", "exit", "interface ge0.20", "address 192.168.20.1/24", "exit"]);
    expect(session(base(), "r1", routerCommands).doc.configurations["r1"]).toEqual(router.configurations["r1"]);
  });
});
