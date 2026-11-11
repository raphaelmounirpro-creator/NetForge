import { addDevice, addFault, connectPorts, disconnect, setFiber, type CommandResult, type FaultTarget, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { analyzeOptics, inspectConnector, measurePower, type OpticalPath } from "./optics.js";
import { ftthScenario, lanScenario, ScenarioBuilder } from "./scenarios.js";
import { codes, ping, settle, start } from "./test-support/helpers.js";

/*
 * Références calculées à la main (valeurs maximales vérifiées : connexion
 * 0,5 dB ; épissure 0,3 dB ; câble de distribution 0,4 dB/km ; câble court
 * (jarretière, raccordement) 1,0 dB/km ; coupleur 1:8 10,6 dB (min 8,2) ; 1:4 7,4 dB (min 5,4) ;
 * GPON B+ : OLT +1,5/+5 dBm, sensibilité −28 ; ONT +0,5/+5 dBm, sensibilité −27 ;
 * surcharge −8 ; pénalité 0,5 dB par sens).
 *
 * Chemin ONT1 du scénario FTTH, sens descendant :
 *  connexions OLT1 pon1, ODF1 f1, PTO1 out, ONT1 pon  4 × 0,5  = 2,000
 *  épissures ODF1 r1, CPL1 com/o1, CPL2 com/o1,
 *            PBO1 in1, PTO1 in                       7 × 0,3  = 2,100
 *  coupleurs 1:8 + 1:4                         10,6 + 7,4     = 18,000
 *  fibres 2 m (court) + 5 km + 1 km + 800 m
 *         + 150 m (court) + 2 m (court)
 *                         0,002+2+0,4+0,32+0,15+0,002        = 2,874
 *  total                                                        24,974 dB
 */
const ONT1_LOSS = 24.974;
const ONT2_LOSS = 24.974 - 0.15 + 0.06; // raccordement de 60 m
const ONT3_LOSS = 24.974 - 0.15 + 0.12; // raccordement de 120 m
const MIN_LOSS = 8.2 + 5.4; // seuls les coupleurs ont un minimum spécifié

const DIGITS = 9;
const pathTo = (doc: NfgDocument, ontId: string): OpticalPath => {
  const path = analyzeOptics(doc).paths.find((item) => item.ont.deviceId === ontId);
  if (!path) throw new Error(`chemin vers ${ontId} attendu`);
  return path;
};
const ok = (result: CommandResult): NfgDocument => {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
};
const port = (deviceId: string, portId: string): FaultTarget => ({ kind: "port", deviceId, portId });
const cable = (linkId: string): FaultTarget => ({ kind: "link", linkId });

describe("bilan optique : chemin calculé à la main", () => {
  it("retrouve la perte, la puissance reçue et les marges du chemin ONT1 dans les deux sens", () => {
    const path = pathTo(ftthScenario(), "ont1");
    expect(path.downstream.wavelengthNm).toBe(1490);
    expect(path.upstream.wavelengthNm).toBe(1310);
    expect(path.downstream.nominal.lossMaxDb).toBeCloseTo(ONT1_LOSS, DIGITS);
    expect(path.downstream.nominal.lossMinDb).toBeCloseTo(MIN_LOSS, DIGITS);
    // Descendant : 1,5 − 24,974 = −23,474 dBm ; seuil −27 + 0,5 = −26,5 dBm ; marge 3,026 dB.
    expect(path.downstream.nominal.receivedMinDbm).toBeCloseTo(-23.474, DIGITS);
    expect(path.downstream.nominal.marginDb).toBeCloseTo(3.026, DIGITS);
    // Surcharge : 5 − 13,6 = −8,6 dBm, soit 0,6 dB sous −8 dBm.
    expect(path.downstream.nominal.receivedMaxDbm).toBeCloseTo(-8.6, DIGITS);
    expect(path.downstream.nominal.overloadMarginDb).toBeCloseTo(0.6, DIGITS);
    // Montant : 0,5 − 24,974 = −24,474 dBm ; seuil −28 + 0,5 = −27,5 dBm ; marge 3,026 dB.
    expect(path.upstream.nominal.receivedMinDbm).toBeCloseTo(-24.474, DIGITS);
    expect(path.upstream.nominal.marginDb).toBeCloseTo(3.026, DIGITS);
    expect(path.downstream.availableDb).toBeCloseTo(28, DIGITS);
    expect(path.upstream.availableDb).toBeCloseTo(28, DIGITS);
    expect(path.status).toBe("ok");
  });

  it("détaille la contribution de chaque composant, dans l'ordre de traversée de chaque sens", () => {
    const path = pathTo(ftthScenario(), "ont1");
    const maxima = path.downstream.contributions.map((item) => Math.round(item.maxDb * 1000) / 1000);
    expect(maxima).toEqual([0.5, 0.002, 0.5, 0.3, 2, 0.3, 10.6, 0.3, 0.4, 0.3, 7.4, 0.3, 0.32, 0.3, 0.15, 0.3, 0.5, 0.002, 0.5]);
    expect(path.upstream.contributions.map((item) => item.index)).toEqual(path.downstream.contributions.map((item) => item.index).reverse());
    expect(path.downstream.contributions.every((item) => item.faultDb === 0)).toBe(true);
  });

  it("compte chaque connexion appariée et chaque épissure une seule fois", () => {
    const path = pathTo(ftthScenario(), "ont1");
    const count = (kind: string) => path.elements.filter((item) => item.element.kind === kind).length;
    expect([count("connection"), count("splice"), count("coupler"), count("fiber")]).toEqual([4, 7, 2, 6]);
    const keys = path.elements.map(({ element }) =>
      element.kind === "fiber" ? `fibre:${element.linkId}` : element.kind === "coupler" ? `coupleur:${element.deviceId}` : `${element.kind}:${element.deviceId}/${element.portId}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
    // Jarretière PTO1 → ONT1 : deux connexions (une par extrémité), aucune épissure.
    expect(keys.slice(-3)).toEqual(["connection:pto1/out", "fibre:l10", "connection:ont1/pon"]);
  });
});

describe("bilan optique : cascade et branches", () => {
  it("trouve un chemin par ONT, chacun avec sa propre longueur de raccordement", () => {
    const report = analyzeOptics(ftthScenario());
    expect(report.paths.map((path) => path.ont.deviceId)).toEqual(["ont1", "ont2", "ont3"]);
    expect(report.paths.map((path) => path.downstream.nominal.lossMaxDb)).toEqual([
      expect.closeTo(ONT1_LOSS, DIGITS),
      expect.closeTo(ONT2_LOSS, DIGITS),
      expect.closeTo(ONT3_LOSS, DIGITS),
    ]);
    expect(report.unreachedOnts).toEqual([]);
    expect(report.loops).toBe(0);
  });

  it("applique la réserve d'ingénierie choisie", () => {
    // Marges : ONT1 3,026 dB, ONT2 3,116 dB, ONT3 3,056 dB.
    const report = analyzeOptics(ftthScenario(), { reserveDb: 3.04 });
    expect(report.paths.map((path) => path.status)).toEqual(["low-margin", "ok", "ok"]);
  });

  it("signale une marge faible quand le câble de transport s'allonge", () => {
    const doc = ok(setFiber(ftthScenario(), { linkId: "l2", fiber: { length: 5500, type: "G.652.D", cable: "distribution" } }));
    // +500 m = +0,2 dB : marge ONT1 2,826 dB, sous la réserve de 3 dB.
    expect(pathTo(doc, "ont1").downstream.nominal.marginDb).toBeCloseTo(2.826, DIGITS);
    expect(analyzeOptics(doc).paths.map((path) => path.status)).toEqual(["low-margin", "low-margin", "low-margin"]);
  });

  it("indique un ONT qu'aucun OLT n'atteint, tout en mesurant la sortie de la PTO", () => {
    const doc = ok(disconnect(ftthScenario(), { linkId: "l12" }));
    const report = analyzeOptics(doc);
    expect(report.unreachedOnts).toEqual(["ont3"]);
    const reading = measurePower(doc, { direction: "downstream", point: { deviceId: "pto3", portId: "out" } });
    expect(reading.outcome).toBe("light");
    expect(reading.powerDbm).toBeCloseTo(1.5 - (ONT3_LOSS - 0.502), DIGITS);
  });
});

describe("bilan optique : limites de réception", () => {
  it("signale une sensibilité insuffisante (cascade 1:64 puis 1:8)", () => {
    const doc = new ScenarioBuilder("limites", "Limites")
      .device("olt1", "OLT-16", 0, 0)
      .device("cpl1", "SPL-64", 100, 0)
      .device("cpl2", "SPL-8", 200, 0)
      .device("ont1", "ONT-1G", 300, 0)
      .link("olt1", "pon1", "cpl1", "com")
      .link("cpl1", "o1", "cpl2", "com")
      .link("cpl2", "o1", "ont1", "pon")
      .build();
    const path = pathTo(doc, "ont1");
    // 0,5 + 3 × 0,002 + 4 × 0,3 + 20,9 + 10,6 + 0,5 = 33,706 dB ; marge 1,5 − 33,706 + 26,5 = −5,706 dB.
    expect(path.downstream.nominal.lossMaxDb).toBeCloseTo(33.706, DIGITS);
    expect(path.downstream.nominal.marginDb).toBeCloseTo(-5.706, DIGITS);
    expect(path.status).toBe("below-sensitivity");
    expect(path.nominalStatus).toBe("below-sensitivity");
  });

  it("signale une surcharge quand l'ONT est raccordé directement à l'OLT", () => {
    const doc = new ScenarioBuilder("surcharge", "Surcharge")
      .device("olt1", "OLT-16", 0, 0)
      .device("ont1", "ONT-1G", 100, 0)
      .link("olt1", "pon1", "ont1", "pon")
      .build();
    const path = pathTo(doc, "ont1");
    // Pertes minimales nulles : +5 dBm reçus, 13 dB au-dessus de la surcharge (−8 dBm).
    expect(path.downstream.nominal.receivedMaxDbm).toBeCloseTo(5, DIGITS);
    expect(path.downstream.nominal.overloadMarginDb).toBeCloseTo(-13, DIGITS);
    expect(path.downstream.nominal.marginDb).toBeCloseTo(1.5 - 1.002 + 26.5, DIGITS);
    expect(path.status).toBe("overload");
  });
});

describe("pannes : perte de panne distincte de la perte nominale", () => {
  it("un connecteur sale fait passer ONT3 sous la sensibilité sans toucher les autres branches", () => {
    const doc = ftthScenario({ dirtyPto3: true });
    const report = analyzeOptics(doc);
    expect(report.paths.map((path) => [path.ont.deviceId, path.status, path.nominalStatus])).toEqual([
      ["ont1", "ok", "ok"],
      ["ont2", "ok", "ok"],
      ["ont3", "below-sensitivity", "ok"],
    ]);
    const path = pathTo(doc, "ont3");
    expect(path.downstream.nominal.lossMaxDb).toBeCloseTo(ONT3_LOSS, DIGITS);
    expect(path.downstream.actual.lossMaxDb).toBeCloseTo(ONT3_LOSS + 4.5, DIGITS);
    // Marge 3,056 − 4,5 = −1,444 dB.
    expect(path.downstream.actual.marginDb).toBeCloseTo(-1.444, DIGITS);
    const dirty = path.downstream.contributions.find((item) => item.faultDb > 0);
    expect(dirty && path.elements[dirty.index]?.element).toEqual({ kind: "connection", deviceId: "pto3", portId: "out", connector: "SC/APC" });
    expect(dirty?.maxDb).toBe(0.5);
    expect(dirty?.faultDb).toBe(4.5);
  });

  it("une courbure s'ajoute à la fibre concernée, qui garde sa perte nominale", () => {
    const doc = ok(addFault(ftthScenario(), { id: "c1", kind: "bend", target: cable("l2"), extraLoss: 2 }));
    const path = pathTo(doc, "ont1");
    const fiber = path.downstream.contributions.find((item) => path.elements[item.index]?.element.kind === "fiber" && item.faultDb > 0);
    expect(fiber?.maxDb).toBeCloseTo(2, DIGITS);
    expect(fiber?.faultDb).toBe(2);
    // Une courbure touche les trois abonnés : marge ONT1 3,026 − 2 = 1,026 dB.
    expect(path.downstream.actual.marginDb).toBeCloseTo(1.026, DIGITS);
    expect(analyzeOptics(doc).paths.every((item) => item.status === "low-margin")).toBe(true);
  });

  it("une épissure défectueuse ne pénalise que les chemins qui la traversent", () => {
    const doc = ok(addFault(ftthScenario(), { id: "e1", kind: "bad-splice", target: port("pbo1", "in2"), extraLoss: 1.5 }));
    expect(analyzeOptics(doc).paths.map((path) => path.downstream.actual.lossMaxDb - path.downstream.nominal.lossMaxDb)).toEqual([
      0,
      expect.closeTo(1.5, DIGITS),
      0,
    ]);
  });

  it("une fibre coupée prive d'éclairage tous les abonnés en aval", () => {
    const doc = ok(addFault(ftthScenario(), { id: "x1", kind: "cut", target: cable("l3"), extraLoss: null }));
    expect(analyzeOptics(doc).paths.map((path) => [path.status, path.downstream.actual.status, path.upstream.actual.status])).toEqual([
      ["cut", "cut", "cut"],
      ["cut", "cut", "cut"],
      ["cut", "cut", "cut"],
    ]);
    expect(measurePower(doc, { direction: "downstream", point: { deviceId: "ont1", portId: "pon" } }).outcome).toBe("no-light");
    // En amont de la coupure, la lumière arrive normalement.
    expect(measurePower(doc, { direction: "downstream", point: { deviceId: "odf1", portId: "f1" } })).toMatchObject({ outcome: "light", deviationDb: 0 });
  });

  it("un raccordement APC/UPC est identifié comme incompatible, sans pénalité chiffrée", () => {
    const doc = ok(addFault(ftthScenario(), { id: "p1", kind: "polish-mismatch", target: port("olt1", "pon1"), extraLoss: null }));
    expect(analyzeOptics(doc).paths.every((path) => path.status === "incompatible" && path.nominalStatus === "ok")).toBe(true);
    expect(measurePower(doc, { direction: "downstream", point: { deviceId: "ont2", portId: "pon" } })).toMatchObject({ outcome: "unstable", powerDbm: null });
    expect(inspectConnector(doc, { deviceId: "olt1", portId: "pon1" })).toMatchObject({ outcome: "inspected", endface: "clean", mating: "mismatch" });
  });
});

describe("photomètre et inspection", () => {
  const doc = ftthScenario({ dirtyPto3: true });
  const at = (deviceId: string, portId: string) => ({ deviceId, portId });

  it("mesure en descendant la lumière arrivant au port, connexion du port comprise", () => {
    // ODF1 f1 : 0,5 + 0,002 + 0,5 = 1,002 dB → 0,498 dBm, conforme.
    const odf = measurePower(doc, { direction: "downstream", point: at("odf1", "f1") });
    expect(odf).toMatchObject({ outcome: "light", source: at("olt1", "pon1"), deviationDb: 0 });
    expect(odf.powerDbm).toBeCloseTo(0.498, DIGITS);
    // Sortie de PTO3 : chemin ONT3 sans la jarretière ni la connexion de l'ONT (0,502 dB), panne comprise.
    const pto3 = measurePower(doc, { direction: "downstream", point: at("pto3", "out") });
    expect(pto3.expectedDbm).toBeCloseTo(1.5 - (ONT3_LOSS - 0.502), DIGITS);
    expect(pto3.powerDbm).toBeCloseTo(1.5 - (ONT3_LOSS - 0.502) - 4.5, DIGITS);
    expect(pto3.deviationDb).toBeCloseTo(4.5, DIGITS);
    // Branche voisine : aucun écart.
    expect(measurePower(doc, { direction: "downstream", point: at("ont2", "pon") }).deviationDb).toBe(0);
  });

  it("mesure en montant la lumière d'un ONT choisi", () => {
    // Au port de l'OLT : chemin complet, 0,5 − 24,944 − 4,5 dBm.
    const atOlt = measurePower(doc, { direction: "upstream", point: at("olt1", "pon1"), ontId: "ont3" });
    expect(atOlt).toMatchObject({ outcome: "light", wavelengthNm: 1310, source: at("ont3", "pon") });
    expect(atOlt.powerDbm).toBeCloseTo(0.5 - ONT3_LOSS - 4.5, DIGITS);
    // À la sortie de PTO3 : connexion ONT3, jarretière, connexion PTO3 (sale).
    expect(measurePower(doc, { direction: "upstream", point: at("pto3", "out"), ontId: "ont3" }).powerDbm).toBeCloseTo(0.5 - 1.002 - 4.5, DIGITS);
    expect(measurePower(doc, { direction: "upstream", point: at("pto1", "out"), ontId: "ont3" }).outcome).toBe("no-source");
  });

  it("refuse une mesure sur une entrée de câble et signale un port non éclairé", () => {
    expect(measurePower(doc, { direction: "downstream", point: at("pbo1", "out1") }).outcome).toBe("not-measurable");
    expect(measurePower(doc, { direction: "downstream", point: at("odf1", "f5") }).outcome).toBe("no-source");
  });

  it("l'inspection révèle un connecteur sale à cet endroit seulement", () => {
    expect(inspectConnector(doc, at("pto3", "out"))).toMatchObject({ outcome: "inspected", connector: "SC/APC", endface: "dirty", mating: "matched" });
    expect(inspectConnector(doc, at("ont3", "pon"))).toMatchObject({ endface: "clean" });
    expect(inspectConnector(doc, at("pto3", "in")).outcome).toBe("not-a-connector");
    expect(inspectConnector(doc, at("odf1", "f5"))).toMatchObject({ endface: "clean", mating: "not-connected" });
  });
});

describe("cohabitation avec la simulation Ethernet", () => {
  it("ignore les équipements optiques : la trace d'un LAN reste identique", () => {
    const run = (doc: NfgDocument) => {
      const sim = start(doc);
      ping(sim, "pc1", "192.168.1.11");
      return codes(settle(sim));
    };
    let mixed = lanScenario();
    mixed = ok(addDevice(mixed, { id: "a-olt", model: "OLT-16", position: { x: 0, y: 0 } }));
    mixed = ok(addDevice(mixed, { id: "a-ont", model: "ONT-1G", position: { x: 50, y: 0 } }));
    mixed = ok(connectPorts(mixed, { linkId: "f1", a: { deviceId: "a-olt", portId: "pon1" }, b: { deviceId: "a-ont", portId: "pon" } }));
    expect(run(mixed)).toEqual(run(lanScenario()));
  });
});
