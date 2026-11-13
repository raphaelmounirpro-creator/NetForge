import { describe, expect, it } from "vitest";
import { configurationCommands, interpret, OPERATION_MODE, type CliMode } from "./cli.js";
import { addDevice, removeDevice, setOntSerial, setOntServices, setPonAuthorization, setPonService } from "./commands.js";
import { parseNfgValue } from "./io.js";
import { formatPonSerial, lowestFreeOnuId, nextPonSerial, normalizePonSerial, ONU_ID_MAX, parseMbps, parseRateInput, parseServiceList, ponTechnologyOf } from "./pon.js";
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

/** OLT GPON, OLT XGS-PON, deux ONT GPON, un ONT XGS-PON et un routeur. */
function base(): NfgDocument {
  return projectWith(["olt1", "OLT-16"], ["olt2", "OLT-XGS-8"], ["ont1", "ONT-1G"], ["ont2", "ONT-1G"], ["ont3", "ONT-10G"], ["r1", "R-200"]);
}

describe("PON : numéros de série des ONT", () => {
  it("lit un numéro Vendor_ID + 8 chiffres hexadécimaux, casse et espaces tolérés", () => {
    expect(normalizePonSerial(" nfge0000a1b2 ")).toBe("NFGE0000A1B2");
    expect(["NFG100000001", "NFGE0000001", "NFGE0000000G", "NFGE000000001", ""].map(normalizePonSerial)).toEqual([null, null, null, null, null]);
    expect(formatPonSerial(1)).toBe("NFGE00000001");
    expect(formatPonSerial(0xabcdef)).toBe("NFGE00ABCDEF");
    expect(nextPonSerial(["NFGE00000001", "NFGE00000003"])).toBe("NFGE00000002");
  });

  it("donne à chaque ONT neuf le plus petit numéro NetForge libre, et aucun aux autres équipements", () => {
    const doc = base();
    const serials = Object.fromEntries(Object.entries(doc.configurations).map(([id, config]) => [id, config.serialNumber]));
    expect(serials).toEqual({ olt1: null, olt2: null, ont1: "NFGE00000001", ont2: "NFGE00000002", ont3: "NFGE00000003", r1: null });
    const without = expectOk(removeDevice(doc, { deviceId: "ont1" }));
    const again = expectOk(addDevice(without, { id: "ont4", model: "ONT-1G", position: { x: 0, y: 0 } }));
    expect(again.configurations["ont4"]?.serialNumber).toBe("NFGE00000001");
  });

  it("remplace le numéro d'un ONT ; refuse un numéro mal formé ou un autre équipement ; signale un numéro en double", () => {
    const doc = expectOk(setOntSerial(base(), { deviceId: "ont1", serial: "abcd12345678" }));
    expect(doc.configurations["ont1"]?.serialNumber).toBe("ABCD12345678");
    expect(codes(setOntSerial(doc, { deviceId: "ont1", serial: "ABCD1234" }))).toEqual(["pon.invalid-serial"]);
    expect(codes(setOntSerial(doc, { deviceId: "r1", serial: "ABCD12345678" }))).toEqual(["pon.not-ont"]);
    const twice = setOntSerial(doc, { deviceId: "ont2", serial: "ABCD12345678" });
    expect(twice.ok && twice.warnings.map((issue) => issue.code)).toEqual(["pon.duplicate-ont-serial"]);
  });

  it("donne la technologie de chaque modèle optique actif", () => {
    expect([ponTechnologyOf("OLT-16"), ponTechnologyOf("ONT-1G"), ponTechnologyOf("OLT-XGS-8"), ponTechnologyOf("ONT-10G"), ponTechnologyOf("SPL-8"), ponTechnologyOf("PC")]).toEqual([
      "gpon",
      "gpon",
      "xgs-pon",
      "xgs-pon",
      null,
      null,
    ]);
  });
});

describe("PON : ONT autorisés par port d'OLT", () => {
  it("autorise par numéro de série avec le plus petit identifiant d'ONU libre, ou un identifiant choisi ; retire", () => {
    let doc = expectOk(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon1", serial: "nfge00000002", present: true }));
    doc = expectOk(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true, onuId: 5 }));
    doc = expectOk(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE000000AA", present: true }));
    expect(doc.configurations["olt1"]?.ponAuthorizations).toEqual({
      pon1: [
        { serial: "NFGE00000002", onuId: 0, services: [] },
        { serial: "NFGE000000AA", onuId: 1, services: [] },
        { serial: "NFGE00000001", onuId: 5, services: [] },
      ],
    });
    expect(validateDocument(doc)).toEqual([]);
    doc = expectOk(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE000000AA", present: false }));
    doc = expectOk(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000002", present: false }));
    doc = expectOk(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: false }));
    // Port sans ONT autorisé : la clé disparaît (configuration identique à celle d'un OLT neuf).
    expect(doc.configurations["olt1"]?.ponAuthorizations).toEqual({});
  });

  it("borne l'identifiant d'ONU selon la technologie : 0 à 253 en GPON, 0 à 1 020 en XGS-PON", () => {
    expect(ONU_ID_MAX).toEqual({ gpon: 253, "xgs-pon": 1020 });
    expect(codes(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true, onuId: 254 }))).toEqual(["pon.invalid-onu-id"]);
    expect(setPonAuthorization(base(), { deviceId: "olt2", portId: "pon1", serial: "NFGE00000003", present: true, onuId: 1020 }).ok).toBe(true);
    expect(codes(setPonAuthorization(base(), { deviceId: "olt2", portId: "pon1", serial: "NFGE00000003", present: true, onuId: 1021 }))).toEqual(["pon.invalid-onu-id"]);
    const full = Array.from({ length: 254 }, (_, onuId) => ({ serial: formatPonSerial(onuId + 1), onuId }));
    expect(lowestFreeOnuId("gpon", full)).toBeNull();
    expect(lowestFreeOnuId("xgs-pon", full)).toBe(254);
  });

  it("refuse un équipement qui n'est pas un OLT, un port inconnu, un doublon, un identifiant pris, un retrait inconnu, un port plein", () => {
    const doc = expectOk(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true }));
    const add = (params: { deviceId?: string; portId?: string; serial?: string; present?: boolean; onuId?: number }) =>
      codes(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000002", present: true, ...params }));
    expect(add({ deviceId: "ont1" })).toEqual(["pon.not-olt"]);
    expect(add({ deviceId: "r1" })).toEqual(["pon.not-olt"]);
    expect(add({ portId: "pon17" })).toEqual(["pon.not-pon-port"]);
    expect(add({ serial: "NFGE-1" })).toEqual(["pon.invalid-serial"]);
    expect(add({ serial: "NFGE00000001" })).toEqual(["pon.duplicate-serial"]);
    expect(add({ onuId: 0 })).toEqual(["pon.duplicate-onu-id"]);
    expect(add({ present: false })).toEqual(["pon.not-authorized"]);
    let full = base();
    for (let index = 1; index <= 128; index += 1) full = expectOk(setPonAuthorization(full, { deviceId: "olt1", portId: "pon2", serial: formatPonSerial(index), present: true }));
    expect(codes(setPonAuthorization(full, { deviceId: "olt1", portId: "pon2", serial: formatPonSerial(200), present: true }))).toEqual(["pon.too-many"]);
  });

  it("refuse à l'import des autorisations hors d'un OLT ou un numéro de série hors d'un ONT", () => {
    const doc = base();
    const r1 = doc.configurations["r1"];
    if (!r1) throw new Error("configuration attendue");
    const onRouter = { ...doc, configurations: { ...doc.configurations, r1: { ...r1, ponAuthorizations: { ge0: [{ serial: "NFGE00000001", onuId: 0, services: [] }] } } } };
    const result = parseNfgValue(onRouter);
    expect(result.ok ? [] : result.errors.map((issue) => issue.code)).toEqual(["pon.not-olt"]);
    const serialOnRouter = parseNfgValue({ ...doc, configurations: { ...doc.configurations, r1: { ...r1, serialNumber: "NFGE00000009" } } });
    expect(serialOnRouter.ok ? [] : serialOnRouter.errors.map((issue) => issue.code)).toEqual(["pon.not-ont"]);
  });
});

describe("PON : console équivalente aux formulaires", () => {
  it("« ont add|delete » sur l'OLT et « serial-number » sur l'ONT produisent les mêmes documents que les formulaires", () => {
    let viaForms = expectOk(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true }));
    viaForms = expectOk(setPonAuthorization(viaForms, { deviceId: "olt1", portId: "pon2", serial: "NFGE00000002", present: true, onuId: 7 }));
    viaForms = expectOk(setOntSerial(viaForms, { deviceId: "ont3", serial: "ABCD00000042" }));
    let viaCli = session(base(), "olt1", ["configure", "ont add pon1 nfge00000001", "ont add PON2 NFGE00000002 onu-id 7", "ont add pon3 NFGE00000005", "ont delete pon3 NFGE00000005", "end"]);
    viaCli = session(viaCli, "ont3", ["configure", "serial-number ABCD00000042", "end"]);
    expect(viaCli).toEqual(viaForms);
  });

  it("signale un port inconnu, un mot-clé inattendu et un identifiant non numérique ; « show pon » est une demande d'affichage", () => {
    const config: CliMode = { kind: "config" };
    const unknown = interpret(base(), "olt1", config, "ont add pon99 NFGE00000001");
    expect(!unknown.ok && unknown.error?.code).toBe("cli.unknown-port");
    const keyword = interpret(base(), "olt1", config, "ont add pon1 NFGE00000001 id 3");
    expect(!keyword.ok && keyword.error?.code).toBe("cli.unexpected-argument");
    const id = interpret(base(), "olt1", config, "ont add pon1 NFGE00000001 onu-id x");
    expect(!id.ok && id.issues.map((issue) => issue.code)).toEqual(["pon.invalid-onu-id"]);
    for (const deviceId of ["olt1", "ont1"]) {
      const show = interpret(base(), deviceId, OPERATION_MODE, "sh pon");
      expect(show.ok && show.request).toEqual({ kind: "show-pon" });
    }
    // Le routeur n'a pas de commande PON.
    expect(interpret(base(), "r1", config, "ont add pon1 NFGE00000001").ok).toBe(false);
  });

  it("réécrit la configuration de l'OLT et de l'ONT en commandes rejouables", () => {
    let doc = expectOk(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon2", serial: "NFGE00000002", present: true, onuId: 9 }));
    doc = expectOk(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true }));
    doc = expectOk(setOntSerial(doc, { deviceId: "ont1", serial: "ABCD00000001" }));
    expect(configurationCommands(doc, "olt1")).toEqual(["configure", "hostname OLT1", "ont add pon1 NFGE00000001 onu-id 0", "ont add pon2 NFGE00000002 onu-id 9", "end"]);
    expect(configurationCommands(doc, "ont1")).toEqual(["configure", "hostname ONT1", "serial-number ABCD00000001", "end"]);
    const replayed = session(session(base(), "olt1", configurationCommands(doc, "olt1")), "ont1", configurationCommands(doc, "ont1"));
    expect(replayed.configurations).toEqual(doc.configurations);
  });
});

const INTERNET = { vlan: 100, downstream: { guaranteedKbps: 100_000, maxKbps: 1_000_000 }, upstream: { guaranteedKbps: 20_000, maxKbps: 500_000 } };
const IPTV = { vlan: 300, downstream: { guaranteedKbps: 20_000, maxKbps: 20_000 }, upstream: null };

describe("PON : profils de service et offres des ONT", () => {
  it("lit les débits en Mbit/s (virgule ou point, trois décimales) et les listes de services", () => {
    expect([parseMbps("100"), parseMbps("0,2"), parseMbps("0.125"), parseMbps("10000"), parseMbps("10000.001"), parseMbps("1.2345"), parseMbps("-1")]).toEqual([100_000, 200, 125, 10_000_000, null, null, null]);
    expect(parseRateInput("100/1000")).toEqual({ guaranteedKbps: 100_000, maxKbps: 1_000_000 });
    expect([parseRateInput("1000/100"), parseRateInput("0/0"), parseRateInput("1/2/3"), parseRateInput("100")]).toEqual([null, null, null, null]);
    expect(parseServiceList("iptv,internet,iptv")).toEqual(["internet", "iptv"]);
    expect([parseServiceList("none"), parseServiceList("internet,web")]).toEqual([[], null]);
  });

  it("définit les profils de l'OLT, l'offre de chaque ONT, et retire un service de toutes les offres avec son profil", () => {
    let doc = expectOk(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true }));
    doc = expectOk(setPonService(doc, { deviceId: "olt1", service: "internet", profile: INTERNET }));
    doc = expectOk(setPonService(doc, { deviceId: "olt1", service: "iptv", profile: IPTV }));
    doc = expectOk(setOntServices(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", services: ["iptv", "internet"] }));
    expect(doc.configurations["olt1"]?.ponAuthorizations["pon1"]?.[0]?.services).toEqual(["internet", "iptv"]);
    expect(validateDocument(doc)).toEqual([]);
    const without = expectOk(setPonService(doc, { deviceId: "olt1", service: "iptv", profile: null }));
    expect(without.configurations["olt1"]?.ponServices).toEqual({ internet: INTERNET });
    expect(without.configurations["olt1"]?.ponAuthorizations["pon1"]?.[0]?.services).toEqual(["internet"]);
  });

  it("refuse un service non défini, un ONT non autorisé, un VLAN partagé entre services, un sens montant pour l'IPTV ou absent pour Internet", () => {
    let doc = expectOk(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true }));
    doc = expectOk(setPonService(doc, { deviceId: "olt1", service: "internet", profile: INTERNET }));
    expect(codes(setOntServices(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", services: ["voip"] }))).toEqual(["pon.service-undefined"]);
    expect(codes(setOntServices(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000009", services: [] }))).toEqual(["pon.not-authorized"]);
    expect(codes(setPonService(doc, { deviceId: "olt1", service: "iptv", profile: { ...IPTV, vlan: 100 } }))).toEqual(["pon.service-duplicate-vlan"]);
    expect(codes(setPonService(doc, { deviceId: "olt1", service: "iptv", profile: { ...IPTV, upstream: IPTV.downstream } }))).toEqual(["pon.service-direction"]);
    expect(codes(setPonService(doc, { deviceId: "olt1", service: "voip", profile: { ...INTERNET, vlan: 200, upstream: null } }))).toEqual(["pon.service-direction"]);
    expect(codes(setPonService(doc, { deviceId: "olt1", service: "voip", profile: { ...INTERNET, vlan: 200, downstream: { guaranteedKbps: 9, maxKbps: 1 } } }))).toEqual(["pon.service-invalid-rate"]);
    expect(codes(setPonService(doc, { deviceId: "ont1", service: "voip", profile: INTERNET }))).toEqual(["pon.not-olt"]);
  });

  it("console : « service » et « ont services » donnent les mêmes documents que les formulaires ; configuration rejouable", () => {
    let viaForms = expectOk(setPonAuthorization(base(), { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", present: true }));
    viaForms = expectOk(setPonService(viaForms, { deviceId: "olt1", service: "internet", profile: INTERNET }));
    viaForms = expectOk(setPonService(viaForms, { deviceId: "olt1", service: "voip", profile: { vlan: 200, downstream: { guaranteedKbps: 200, maxKbps: 200 }, upstream: { guaranteedKbps: 200, maxKbps: 200 } } }));
    viaForms = expectOk(setPonService(viaForms, { deviceId: "olt1", service: "iptv", profile: IPTV }));
    viaForms = expectOk(setOntServices(viaForms, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000001", services: ["internet", "voip", "iptv"] }));
    const viaCli = session(base(), "olt1", [
      "configure",
      "ont add pon1 NFGE00000001",
      "service internet vlan 100 down 100/1000 up 20/500",
      "service voip vlan 200 down 0,2/0,2 up 0.2/0.2",
      "service iptv vlan 300 down 20/20",
      "ont services pon1 NFGE00000001 voip,iptv,internet",
      "end",
    ]);
    expect(viaCli).toEqual(viaForms);
    expect(configurationCommands(viaForms, "olt1")).toEqual([
      "configure",
      "hostname OLT1",
      "service internet vlan 100 down 100/1000 up 20/500",
      "service voip vlan 200 down 0.2/0.2 up 0.2/0.2",
      "service iptv vlan 300 down 20/20",
      "ont add pon1 NFGE00000001 onu-id 0",
      "ont services pon1 NFGE00000001 internet,voip,iptv",
      "end",
    ]);
    expect(session(base(), "olt1", configurationCommands(viaForms, "olt1")).configurations["olt1"]).toEqual(viaForms.configurations["olt1"]);
    const config: CliMode = { kind: "config" };
    const unknown = interpret(viaForms, "olt1", config, "service web vlan 400 down 1/1");
    expect(!unknown.ok && unknown.error?.code).toBe("cli.unexpected-argument");
    const iptvUp = interpret(viaForms, "olt1", config, "service iptv vlan 300 down 20/20 up 1/1");
    expect(!iptvUp.ok && iptvUp.error?.code).toBe("cli.unexpected-argument");
    const badRate = interpret(viaForms, "olt1", config, "service internet vlan 100 down 1000/100 up 1/1");
    expect(!badRate.ok && badRate.issues.map((issue) => issue.code)).toEqual(["pon.invalid-rate"]);
    const badList = interpret(viaForms, "olt1", config, "ont services pon1 NFGE00000001 web");
    expect(!badList.ok && badList.issues.map((issue) => issue.code)).toEqual(["pon.invalid-service-list"]);
    const removed = session(viaForms, "olt1", ["configure", "service voip delete", "end"]);
    expect(removed.configurations["olt1"]?.ponAuthorizations["pon1"]?.[0]?.services).toEqual(["internet", "iptv"]);
    expect(interpret(viaForms, "olt1", OPERATION_MODE, "sh bandwidth")).toMatchObject({ ok: true, request: { kind: "show-bandwidth" } });
  });
});
