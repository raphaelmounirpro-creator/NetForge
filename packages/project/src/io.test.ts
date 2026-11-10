import { describe, expect, it } from "vitest";
import { connectDevices, setDefaultGateway, setInterfaceIpv4 } from "./commands.js";
import { exportFileName, parseNfgText, serializeNfg } from "./io.js";
import { LIMITS } from "./schema.js";
import { expectOk, projectWith } from "./test-helpers.js";

function sampleProject() {
  let doc = projectWith(["pc1", "PC"], ["sw1", "S-24"], ["r1", "R-200"]);
  doc = expectOk(connectDevices(doc, { linkId: "l1", aDeviceId: "pc1", bDeviceId: "sw1" }));
  doc = expectOk(connectDevices(doc, { linkId: "l2", aDeviceId: "r1", bDeviceId: "sw1" }));
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "pc1", portId: "eth0", ipv4: { address: "192.168.1.10", prefixLength: 24 } }));
  doc = expectOk(setInterfaceIpv4(doc, { deviceId: "r1", portId: "ge0", ipv4: { address: "192.168.1.1", prefixLength: 24 } }));
  return expectOk(setDefaultGateway(doc, { deviceId: "pc1", gateway: "192.168.1.1" }));
}

const errorCodes = (text: string) => {
  const result = parseNfgText(text);
  return result.ok ? [] : result.errors.map((issue) => issue.code);
};

describe("export puis import .nfg.json", () => {
  it("restitue exactement le projet (aller-retour sans perte)", () => {
    const doc = sampleProject();
    const result = parseNfgText(serializeNfg(doc));
    expect(result.ok && result.document).toEqual(doc);
  });

  it("produit un nom de fichier sûr", () => {
    const doc = { ...sampleProject(), metadata: { ...sampleProject().metadata, name: "Fibre · Immeuble Été" } };
    expect(exportFileName(doc)).toBe("fibre-immeuble-ete.nfg.json");
  });
});

describe("import refusé avec un diagnostic clair", () => {
  it("refuse un texte qui n'est pas du JSON", () => {
    expect(errorCodes("{ pas du json")).toEqual(["import.invalid-json"]);
  });

  it("refuse un JSON étranger à NetForge", () => {
    expect(errorCodes(JSON.stringify({ name: "autre logiciel" }))).toEqual(["import.not-netforge"]);
  });

  it("refuse une version future non prise en charge", () => {
    const future = { ...sampleProject(), schemaVersion: 99 };
    expect(errorCodes(JSON.stringify(future))).toEqual(["import.future-version"]);
  });

  it("refuse une version absente ou invalide", () => {
    const { schemaVersion: _omitted, ...withoutVersion } = sampleProject();
    expect(errorCodes(JSON.stringify(withoutVersion))).toEqual(["import.unsupported-version"]);
  });

  it("refuse un champ inconnu (champs autorisés explicitement)", () => {
    const doc = { ...sampleProject(), script: "alert(1)" };
    expect(errorCodes(JSON.stringify(doc))).toEqual(["import.schema"]);
  });

  it("refuse un lien vers un équipement inexistant (intégrité des références)", () => {
    const doc = sampleProject();
    const broken = {
      ...doc,
      topology: { ...doc.topology, links: [{ id: "l9", endpoints: [{ deviceId: "fantome", portId: "eth0" }, { deviceId: "sw1", portId: "ge5" }] }] },
    };
    expect(errorCodes(JSON.stringify(broken))).toContain("link.unknown-device");
  });

  it("refuse une clé réservée de JavaScript (pollution de prototype)", () => {
    const doc = sampleProject();
    const text = serializeNfg(doc).replace('"configurations": {', '"configurations": {\n    "__proto__": { "interfaces": {}, "defaultGateway": null },');
    expect(errorCodes(text)).toEqual(["import.forbidden-key"]);
    expect(({} as Record<string, unknown>)["interfaces"]).toBeUndefined();
  });

  it("refuse une structure trop profonde", () => {
    let nested: unknown = {};
    for (let depth = 0; depth < LIMITS.maxJsonDepth + 5; depth += 1) nested = { nested };
    expect(errorCodes(JSON.stringify({ format: "netforge-project", nested }))).toEqual(["import.too-deep"]);
  });

  it("refuse un fichier trop volumineux", () => {
    expect(errorCodes(" ".repeat(LIMITS.maxImportBytes + 1))).toEqual(["import.too-large"]);
  });

  it("conserve les avertissements d'un projet de dépannage valide", () => {
    let doc = sampleProject();
    doc = expectOk(setDefaultGateway(doc, { deviceId: "pc1", gateway: "10.9.9.9" }));
    const result = parseNfgText(serializeNfg(doc));
    expect(result.ok && result.warnings.map((issue) => issue.code)).toEqual(["gateway.outside-subnet"]);
  });
});
