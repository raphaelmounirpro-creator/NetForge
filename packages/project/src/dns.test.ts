import { describe, expect, it } from "vitest";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { setDnsEnabled, setDnsRecord, setDnsServer, setInterfaceDhcp, setInterfaceIpv4 } from "./commands.js";
import { DNS_MAX_RECORDS, isDnsAddress, normalizeDnsName, parseDnsRecordInput } from "./dns.js";
import { parseNfgValue, serializeNfg } from "./io.js";
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

function refusal(doc: NfgDocument, deviceId: string, mode: CliMode, line: string) {
  const result = interpret(doc, deviceId, mode, line);
  return result.ok ? null : (result.error?.code ?? result.issues.map((issue) => issue.code).join(","));
}

/** Routeur r1 (ge0 en 192.168.1.1/24), poste pc1 et switch sw1. */
function base(): NfgDocument {
  const doc = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
  return expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
}

const CONFIG_MODE: CliMode = { kind: "config" };

describe("DNS : noms et adresses", () => {
  it("met un nom sous forme canonique : casse ignorée, point final retiré", () => {
    expect(["Srv.Lab", " www.lab. ", "a", "1srv.lab", "db-01.site.lab", `${"a".repeat(63)}.lab`].map(normalizeDnsName)).toEqual([
      "srv.lab",
      "www.lab",
      "a",
      "1srv.lab",
      "db-01.site.lab",
      `${"a".repeat(63)}.lab`,
    ]);
  });

  it("refuse les labels vides, trop longs, à tiret en bord, les caractères hors ASCII et les noms en forme d'adresse", () => {
    const refused = ["", ".", "srv..lab", "-srv.lab", "srv-.lab", "srv_1.lab", "café.lab", "srv lab", `${"a".repeat(64)}.lab`, "10.0.0.1", "10.0.0", "srv.123", "constructor"];
    expect(refused.map(normalizeDnsName)).toEqual(refused.map(() => null));
    // 253 caractères au plus (255 octets une fois encodé).
    const long = `${Array.from({ length: 4 }, () => "a".repeat(62)).join(".")}.ab`;
    expect(long.length).toBe(254);
    expect(normalizeDnsName(long)).toBeNull();
    expect(normalizeDnsName(long.slice(2))).not.toBeNull();
  });

  it("n'accepte comme adresse publiée ou comme serveur qu'une adresse d'hôte attribuable", () => {
    expect(["192.168.1.10", "10.0.0.53"].map(isDnsAddress)).toEqual([true, true]);
    expect(["0.0.0.0", "127.0.0.1", "255.255.255.255", "224.0.0.1", "192.168.1", "srv.lab"].map(isDnsAddress)).toEqual([false, false, false, false, false, false]);
  });

  it("signale chaque valeur invalide d'une saisie d'enregistrement", () => {
    expect(parseDnsRecordInput(" WWW.Lab ", " 192.168.1.80 ")).toEqual({ ok: true, name: "www.lab", address: "192.168.1.80" });
    const bad = parseDnsRecordInput("www_lab", "127.0.0.1");
    expect(bad.ok ? [] : bad.errors.map((issue) => issue.code)).toEqual(["dns.invalid-name", "dns.invalid-address"]);
  });
});

describe("DNS : résolveur du poste", () => {
  it("enregistre puis retire le serveur DNS d'un PC, y compris en adressage automatique", () => {
    const automatic = expectOk(setInterfaceDhcp(base(), { deviceId: "pc1", portId: "eth0", enabled: true }));
    const configured = expectOk(setDnsServer(automatic, { deviceId: "pc1", server: " 192.168.1.1 " }));
    expect(configured.configurations["pc1"]?.dnsServer).toBe("192.168.1.1");
    expect(validateDocument(configured)).toEqual([]);
    expect(expectOk(setDnsServer(configured, { deviceId: "pc1", server: "" })).configurations["pc1"]?.dnsServer).toBeNull();
    expect(expectOk(setDnsServer(configured, { deviceId: "pc1", server: null })).configurations["pc1"]?.dnsServer).toBeNull();
  });

  it("réserve le résolveur aux PC et refuse une adresse non attribuable", () => {
    const doc = base();
    expect(codes(setDnsServer(doc, { deviceId: "r1", server: "192.168.1.1" }))).toEqual(["dns.client-not-supported"]);
    expect(codes(setDnsServer(doc, { deviceId: "pc1", server: "127.0.0.1" }))).toEqual(["dns.invalid-address"]);
    expect(codes(setDnsServer(doc, { deviceId: "absent", server: "192.168.1.1" }))).toEqual(["device.not-found"]);
  });
});

describe("DNS : service d'un routeur", () => {
  it("active le service sans nom, ajoute, remplace et retire des enregistrements A", () => {
    const enabled = expectOk(setDnsEnabled(base(), { deviceId: "r1", enabled: true }));
    expect(enabled.configurations["r1"]?.dnsRecords).toEqual({});
    const added = expectOk(setDnsRecord(enabled, { deviceId: "r1", name: "WWW.lab", address: "192.168.1.80" }));
    const replaced = expectOk(setDnsRecord(added, { deviceId: "r1", name: "www.lab", address: "192.168.1.81" }));
    expect(replaced.configurations["r1"]?.dnsRecords).toEqual({ "www.lab": "192.168.1.81" });
    expect(validateDocument(replaced)).toEqual([]);
    expect(expectOk(setDnsRecord(replaced, { deviceId: "r1", name: "www.lab.", address: null })).configurations["r1"]?.dnsRecords).toEqual({});
  });

  it("active le service dès le premier enregistrement ; le désactiver retire ses noms", () => {
    const added = expectOk(setDnsRecord(base(), { deviceId: "r1", name: "srv.lab", address: "192.168.1.10" }));
    expect(added.configurations["r1"]?.dnsRecords).toEqual({ "srv.lab": "192.168.1.10" });
    expect(expectOk(setDnsEnabled(added, { deviceId: "r1", enabled: true })).configurations["r1"]?.dnsRecords).toEqual({ "srv.lab": "192.168.1.10" });
    expect(expectOk(setDnsEnabled(added, { deviceId: "r1", enabled: false })).configurations["r1"]?.dnsRecords).toBeNull();
  });

  it("refuse un service hors routeur, un nom ou une adresse invalide, un retrait sans enregistrement et un dépassement", () => {
    const doc = base();
    expect(codes(setDnsEnabled(doc, { deviceId: "sw1", enabled: true }))).toEqual(["dns.server-not-supported"]);
    expect(codes(setDnsRecord(doc, { deviceId: "pc1", name: "srv.lab", address: "192.168.1.10" }))).toEqual(["dns.server-not-supported"]);
    expect(codes(setDnsRecord(doc, { deviceId: "r1", name: "srv lab", address: "192.168.1.10" }))).toEqual(["dns.invalid-name"]);
    expect(codes(setDnsRecord(doc, { deviceId: "r1", name: "srv.lab", address: "192.168.1.255.1" }))).toEqual(["dns.invalid-address"]);
    expect(codes(setDnsRecord(doc, { deviceId: "r1", name: "constructor.lab", address: null }))).toEqual(["dns.record-not-found"]);
    let full = doc;
    for (let index = 0; index < DNS_MAX_RECORDS; index += 1) {
      full = expectOk(setDnsRecord(full, { deviceId: "r1", name: `h${String(index)}.lab`, address: "192.168.1.10" }));
    }
    expect(codes(setDnsRecord(full, { deviceId: "r1", name: "encore.lab", address: "192.168.1.10" }))).toEqual(["dns.too-many-records"]);
    // Remplacer un nom existant reste possible à la limite.
    expect(setDnsRecord(full, { deviceId: "r1", name: "h0.lab", address: "192.168.1.11" }).ok).toBe(true);
  });

  it("refuse un document importé qui place le service ou le résolveur sur le mauvais équipement", () => {
    const doc = base();
    const pc = doc.configurations["pc1"];
    const sw = doc.configurations["sw1"];
    if (!pc || !sw) throw new Error("configurations attendues");
    const imported: NfgDocument = {
      ...doc,
      configurations: { ...doc.configurations, pc1: { ...pc, dnsRecords: {} }, sw1: { ...sw, dnsServer: "192.168.1.1" } },
    };
    expect(validateDocument(imported).map((issue) => issue.code)).toEqual(expect.arrayContaining(["dns.server-not-supported", "dns.client-not-supported"]));
    // Adresse non attribuable dans un fichier : détectée par la validation, nom non canonique : refusé à l'import.
    const r1 = doc.configurations["r1"];
    if (!r1) throw new Error("configuration attendue");
    const loopback: NfgDocument = { ...doc, configurations: { ...doc.configurations, r1: { ...r1, dnsRecords: { "srv.lab": "127.0.0.1" } } } };
    expect(validateDocument(loopback).map((issue) => issue.code)).toContain("dns.invalid-address");
    const raw = JSON.parse(serializeNfg(doc)) as { configurations: Record<string, Record<string, unknown>> };
    raw.configurations["r1"] = { ...raw.configurations["r1"], dnsRecords: { "SRV.lab": "192.168.1.10" } };
    const parsed = parseNfgValue(raw);
    expect(parsed.ok ? [] : parsed.errors.map((issue) => issue.code)).toEqual(["import.schema"]);
  });
});

describe("DNS : console équivalente aux formulaires", () => {
  it("ipconfig dns et ipconfig dns clear donnent les mêmes documents que le formulaire", () => {
    const doc = base();
    const viaConsole = session(doc, "pc1", ["ipconfig dns 192.168.1.1"]);
    expect(viaConsole).toEqual(expectOk(setDnsServer(doc, { deviceId: "pc1", server: "192.168.1.1" })));
    expect(session(viaConsole, "pc1", ["ipconfig dns clear"])).toEqual(expectOk(setDnsServer(viaConsole, { deviceId: "pc1", server: null })));
    expect(refusal(doc, "pc1", OPERATION_MODE, "ipconfig dns 127.0.0.1")).toBe("dns.invalid-address");
    expect(refusal(doc, "pc1", OPERATION_MODE, "ipconfig dns")).toBe("cli.missing-argument");
    // « ipconfig d » : dhcp ou dns.
    expect(refusal(doc, "pc1", OPERATION_MODE, "ipconfig d")).toBe("cli.ambiguous");
  });

  it("nslookup et ping par nom sont des demandes d'exécution ; un nom invalide est refusé par nslookup", () => {
    const doc = base();
    const lookup = interpret(doc, "pc1", OPERATION_MODE, "nslookup WWW.Lab.");
    expect(lookup.ok && lookup.request).toEqual({ kind: "nslookup", name: "www.lab" });
    const ping = interpret(doc, "pc1", OPERATION_MODE, "ping www.lab -n 2");
    expect(ping.ok && ping.request).toEqual({ kind: "ping", destination: "www.lab", count: 2 });
    expect(refusal(doc, "pc1", OPERATION_MODE, "nslookup 192.168.1.80")).toBe("dns.invalid-name");
    expect(refusal(doc, "r1", OPERATION_MODE, "nslookup www.lab")).toBe("cli.unknown-command");
  });

  it("dns enable, record, delete et disable donnent les mêmes documents que les formulaires", () => {
    const doc = base();
    const enabled = session(doc, "r1", ["configure", "dns enable"]);
    expect(enabled).toEqual(expectOk(setDnsEnabled(doc, { deviceId: "r1", enabled: true })));
    const recorded = session(enabled, "r1", ["configure", "dns record WWW.lab 192.168.1.80"]);
    expect(recorded).toEqual(expectOk(setDnsRecord(enabled, { deviceId: "r1", name: "www.lab", address: "192.168.1.80" })));
    const deleted = session(recorded, "r1", ["configure", "dns delete www.lab"]);
    expect(deleted).toEqual(expectOk(setDnsRecord(recorded, { deviceId: "r1", name: "www.lab", address: null })));
    expect(session(recorded, "r1", ["configure", "dns disable"])).toEqual(expectOk(setDnsEnabled(recorded, { deviceId: "r1", enabled: false })));
    const show = interpret(doc, "r1", OPERATION_MODE, "show dns");
    expect(show.ok && show.request).toEqual({ kind: "show-dns" });
  });

  it("explique les erreurs de saisie et de mode", () => {
    const doc = base();
    expect(refusal(doc, "r1", CONFIG_MODE, "dns record www.lab")).toBe("cli.missing-argument");
    expect(refusal(doc, "r1", CONFIG_MODE, "dns record www_lab 192.168.1.80")).toBe("dns.invalid-name");
    expect(refusal(doc, "r1", OPERATION_MODE, "dns enable")).toBe("cli.wrong-mode");
    expect(refusal(doc, "sw1", CONFIG_MODE, "dns enable")).toBe("cli.unknown-command");
    const missing = interpret(doc, "r1", CONFIG_MODE, "dns delete absent.lab");
    expect(missing.ok && missing.edit ? codes(missing.edit(doc)) : null).toEqual(["dns.record-not-found"]);
  });

  it("réécrit résolveur et service en commandes rejouables sur des équipements vierges", () => {
    let doc = expectOk(setInterfaceDhcp(base(), { deviceId: "pc1", portId: "eth0", enabled: true }));
    doc = expectOk(setDnsServer(doc, { deviceId: "pc1", server: "192.168.1.1" }));
    doc = expectOk(setDnsRecord(doc, { deviceId: "r1", name: "www.lab", address: "192.168.1.80" }));
    doc = expectOk(setDnsRecord(doc, { deviceId: "r1", name: "db.lab", address: "192.168.1.81" }));
    expect(configurationCommands(doc, "pc1")).toEqual(["ipconfig dhcp", "ipconfig dns 192.168.1.1"]);
    const lines = configurationCommands(doc, "r1");
    expect(lines.slice(-4)).toEqual(["dns enable", "dns record db.lab 192.168.1.81", "dns record www.lab 192.168.1.80", "end"]);
    const blank = projectWith(["r1", "R-200"], ["pc1", "PC"], ["sw1", "S-24"]);
    expect(session(blank, "r1", lines).configurations["r1"]).toEqual(doc.configurations["r1"]);
    expect(session(blank, "pc1", configurationCommands(doc, "pc1")).configurations["pc1"]).toEqual(doc.configurations["pc1"]);
    // Service activé sans nom : « dns enable » seul.
    const empty = expectOk(setDnsEnabled(base(), { deviceId: "r1", enabled: true }));
    expect(configurationCommands(empty, "r1").slice(-2)).toEqual(["dns enable", "end"]);
  });
});
