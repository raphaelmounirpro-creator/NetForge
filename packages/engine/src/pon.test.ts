import { addFault, disconnect, setFiber, setOntSerial, setPonAuthorization, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { analyzeOptics, fiberDbPerKm, measurePower, type OpticalPath } from "./optics.js";
import { analyzePon, type OntActivation } from "./pon.js";
import { ftthScenario, lanScenario, xgsPonScenario } from "./scenarios.js";

/*
 * Références calculées à la main pour le chemin ONT1 du scénario XGS-PON
 * (classe N1, G.9807.1 tableaux B.9.3 et B.9.4 ; pertes maximales G.671 ;
 * fibre G.652 : 0,4 dB/km de 1 310 à 1 625 nm, + 0,07 dB/km sous 1 310 nm
 * d'après la note 2 du tableau 2 ; câble court 1,0 dB/km, + 0,07 sous 1 310 nm).
 *
 *  connexions OLT1 pon1, ODF1 f1, PTO1 out, ONT1 pon       4 × 0,5 = 2,000
 *  épissures ODF1 r1, CPL1 com et o1, PTO1 in              4 × 0,3 = 1,200
 *  coupleur 1:64                                                   = 20,900 (min 16,1)
 *  fibres à 1 577 nm : 2 m court + 2 km + 300 m court + 2 m court
 *                      0,002 + 0,8 + 0,3 + 0,002                   = 1,104
 *  total descendant                                                  25,204 dB
 *  fibres à 1 270 nm : 0,00214 + 0,94 + 0,321 + 0,00214            = 1,26528
 *  total montant                                                     25,36528 dB
 */
const DOWN_LOSS = 25.204;
const UP_LOSS = 25.36528;
const DIGITS = 9;

const ok = (result: CommandResult): NfgDocument => {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
};
const pathTo = (doc: NfgDocument, ontId: string): OpticalPath => {
  const path = analyzeOptics(doc).paths.find((item) => item.ont.deviceId === ontId);
  if (!path) throw new Error(`chemin vers ${ontId} attendu`);
  return path;
};
const ont = (doc: NfgDocument, ontId: string): OntActivation => {
  const found = analyzePon(doc).onts.find((item) => item.ontId === ontId);
  if (!found) throw new Error(`ONT ${ontId} attendu`);
  return found;
};
const outcomes = (activation: OntActivation) => activation.steps.map((item) => `${item.step}:${item.outcome}`);

describe("bilan optique XGS-PON (classe N1)", () => {
  it("retrouve pertes, puissances et marges du chemin ONT1, avec les longueurs d'onde propres à XGS-PON", () => {
    const path = pathTo(xgsPonScenario(), "ont1");
    expect([path.oltTechnology, path.ontTechnology, path.fiberLengthM]).toEqual(["xgs-pon", "xgs-pon", 2304]);
    expect([path.downstream.wavelengthNm, path.upstream.wavelengthNm]).toEqual([1577, 1270]);
    expect([path.downstream.transmitterProfile, path.downstream.receiverProfile]).toEqual(["xgs-pon-n1-olt", "xgs-pon-n1-ont"]);
    expect(path.downstream.odnClass).toEqual({ id: "N1", minLossDb: 14, maxLossDb: 29 });
    expect(path.downstream.nominal.lossMaxDb).toBeCloseTo(DOWN_LOSS, DIGITS);
    expect(path.upstream.nominal.lossMaxDb).toBeCloseTo(UP_LOSS, DIGITS);
    // Descendant : +2 − 25,204 = −23,204 dBm ; seuil −28 + 1 = −27 dBm ; marge 3,796 dB ; budget 2 + 28 − 1 = 29 dB.
    expect(path.downstream.nominal.receivedMinDbm).toBeCloseTo(-23.204, DIGITS);
    expect(path.downstream.nominal.marginDb).toBeCloseTo(3.796, DIGITS);
    expect(path.downstream.availableDb).toBeCloseTo(29, DIGITS);
    // Montant : +4 − 25,36528 = −21,36528 dBm ; seuil −26 + 1 = −25 dBm ; marge 3,63472 dB ; budget 4 + 26 − 1 = 29 dB.
    expect(path.upstream.nominal.receivedMinDbm).toBeCloseTo(-21.36528, DIGITS);
    expect(path.upstream.nominal.marginDb).toBeCloseTo(3.63472, DIGITS);
    expect(path.upstream.availableDb).toBeCloseTo(29, DIGITS);
    // Surcharge : 5 − 16,1 = −11,1 dBm sous −9 dBm (ONU) ; 9 − 16,1 = −7,1 dBm sous −5 dBm (OLT).
    expect(path.downstream.nominal.overloadMarginDb).toBeCloseTo(2.1, DIGITS);
    expect(path.upstream.nominal.overloadMarginDb).toBeCloseTo(2.1, DIGITS);
    expect(path.status).toBe("ok");
  });

  it("ajoute 0,07 dB/km sous 1 310 nm seulement, et la pénalité DD40 de l'ONU au-delà de 20 km de fibre", () => {
    expect([fiberDbPerKm("distribution", 1270), fiberDbPerKm("distribution", 1310), fiberDbPerKm("distribution", 1577), fiberDbPerKm("short", 1270)].map((value) => Number(value.toFixed(9)))).toEqual([0.47, 0.4, 0.4, 1.07]);
    // GPON : le calcul se fait à 1 310 nm (longueur d'onde nominale), sans majoration.
    expect(pathTo(ftthScenario(), "ont1").upstream.nominal.lossMaxDb).toBeCloseTo(24.974, DIGITS);
    const long = ok(setFiber(xgsPonScenario(), { linkId: "l2", fiber: { length: 21_000, type: "G.652.D", cable: "distribution" } }));
    const path = pathTo(long, "ont1");
    expect([path.downstream.penaltyDb, path.upstream.penaltyDb]).toEqual([2, 1]);
    expect([pathTo(xgsPonScenario(), "ont1").downstream.penaltyDb, pathTo(ftthScenario(), "ont1").downstream.penaltyDb]).toEqual([1, 0.5]);
  });

  it("déclare incompatibles un OLT XGS-PON et un ONT GPON, dès le bilan de conception", () => {
    const path = pathTo(xgsPonScenario(), "ont3");
    expect([path.oltTechnology, path.ontTechnology]).toEqual(["xgs-pon", "gpon"]);
    expect([path.downstream.nominal.status, path.upstream.nominal.status, path.status, path.nominalStatus]).toEqual(["technology-mismatch", "technology-mismatch", "technology-mismatch", "technology-mismatch"]);
  });

  it("mesure au photomètre avec la longueur d'onde et l'émetteur de chaque technologie", () => {
    const doc = xgsPonScenario();
    const down = measurePower(doc, { direction: "downstream", point: { deviceId: "ont1", portId: "pon" } });
    expect([down.outcome, down.wavelengthNm]).toEqual(["light", 1577]);
    expect(down.powerDbm).toBeCloseTo(-23.204, DIGITS);
    const up = measurePower(doc, { direction: "upstream", point: { deviceId: "olt1", portId: "pon1" }, ontId: "ont1" });
    expect([up.outcome, up.wavelengthNm]).toEqual(["light", 1270]);
    expect(up.powerDbm).toBeCloseTo(-21.36528, DIGITS);
  });
});

describe("activation des ONT : chemin optique conforme et enregistrement sont distincts", () => {
  it("met en fonctionnement (O5) l'ONT autorisé, laisse en attente d'identifiant (O2-3) l'ONT inconnu, bloque l'ONT GPON en O1", () => {
    const doc = xgsPonScenario();
    expect(pathTo(doc, "ont2").status).toBe("ok");
    const [ont1, ont2, ont3] = ["ont1", "ont2", "ont3"].map((id) => ont(doc, id));
    expect(ont1).toMatchObject({ technology: "xgs-pon", serial: "NFGE00000001", state: "O5", onuId: 0, block: null, olt: { deviceId: "olt1", portId: "pon1" } });
    expect(outcomes(ont1 as OntActivation)).toEqual(["sync:done", "parameters:done", "serial:done", "onu-id:done", "ranging:done"]);
    // Chemin optique conforme, numéro de série non autorisé : découvert, sans identifiant d'ONU.
    expect(ont2).toMatchObject({ state: "O2-3", onuId: null, block: "not-authorized", downstream: "ok", upstream: "ok" });
    expect(outcomes(ont2 as OntActivation)).toEqual(["sync:done", "parameters:done", "serial:done", "onu-id:failed", "ranging:pending"]);
    expect(ont3).toMatchObject({ technology: "gpon", state: "O1", block: "technology-mismatch" });
    expect(outcomes(ont3 as OntActivation)[0]).toBe("sync:failed");
    const port = analyzePon(doc).ports;
    expect(port).toEqual([
      {
        oltId: "olt1",
        portId: "pon1",
        technology: "xgs-pon",
        authorizations: [
          { serial: "NFGE00000001", onuId: 0, ontId: "ont1", state: "O5" },
          { serial: "NFGE000000FF", onuId: 5, ontId: null, state: null },
        ],
        discovered: [{ serial: "NFGE00000002", ontId: "ont2", block: "not-authorized" }],
        onts: ["ont1", "ont2", "ont3"],
      },
    ]);
    // Une fois autorisé, l'ONT2 fonctionne avec l'identifiant attribué.
    expect(ont(xgsPonScenario({ authorizeOnt2: true }), "ont2")).toMatchObject({ state: "O5", onuId: 1, block: null });
  });

  it("distingue un signal descendant absent (O1) d'une salve montante non reçue par l'OLT", () => {
    // Courbure de 3,7 dB sur le transport : marge descendante 0,096 dB (faible), montante −0,06528 dB.
    const bent = ok(addFault(xgsPonScenario(), { id: "f1", kind: "bend", target: { kind: "link", linkId: "l2" }, extraLoss: 3.7 }));
    expect(pathTo(bent, "ont1").downstream.actual.status).toBe("low-margin");
    expect(ont(bent, "ont1")).toMatchObject({ state: "O2-3", block: "upstream-not-received", downstream: "low-margin", upstream: "below-sensitivity" });
    expect(outcomes(ont(bent, "ont1"))).toEqual(["sync:done", "parameters:done", "serial:failed", "onu-id:pending", "ranging:pending"]);
    // Fibre coupée : plus de signal descendant, l'ONT reste dans l'état initial.
    const cut = ok(addFault(xgsPonScenario(), { id: "f1", kind: "cut", target: { kind: "link", linkId: "l2" }, extraLoss: null }));
    expect(ont(cut, "ont1")).toMatchObject({ state: "O1", block: "no-downstream", downstream: "cut" });
    expect(analyzePon(cut).ports[0]?.authorizations[0]).toEqual({ serial: "NFGE00000001", onuId: 0, ontId: "ont1", state: "O1" });
  });

  it("nomme les états GPON (O3 en attente d'identifiant) et met les trois ONT du réseau de référence en fonctionnement", () => {
    const doc = ftthScenario();
    expect(["ont1", "ont2", "ont3"].map((id) => [ont(doc, id).state, ont(doc, id).onuId])).toEqual([
      ["O5", 0],
      ["O5", 1],
      ["O5", 2],
    ]);
    const revoked = ok(setPonAuthorization(doc, { deviceId: "olt1", portId: "pon1", serial: "NFGE00000002", present: false }));
    expect(ont(revoked, "ont2")).toMatchObject({ state: "O3", block: "not-authorized" });
    // Connecteur sale de PTO3 (+4,5 dB) : marge négative dans les deux sens, aucun signal descendant exploitable.
    expect(ont(ftthScenario({ dirtyPto3: true }), "ont3")).toMatchObject({ state: "O1", block: "no-downstream", downstream: "below-sensitivity" });
  });

  it("refuse l'enregistrement de deux ONT au même numéro, retrouve un ONT remplacé par son nouveau numéro, signale un ONT isolé", () => {
    const twin = ok(setOntSerial(xgsPonScenario({ authorizeOnt2: true }), { deviceId: "ont2", serial: "NFGE00000001" }));
    expect(["ont1", "ont2"].map((id) => [ont(twin, id).state, ont(twin, id).block])).toEqual([
      ["O2-3", "duplicate-serial"],
      ["O2-3", "duplicate-serial"],
    ]);
    // ONT changé : nouveau numéro, l'ancienne autorisation ne le reconnaît plus.
    const replaced = ok(setOntSerial(xgsPonScenario(), { deviceId: "ont1", serial: "ABCD00000001" }));
    expect(ont(replaced, "ont1")).toMatchObject({ state: "O2-3", block: "not-authorized" });
    expect(analyzePon(replaced).ports[0]?.authorizations[0]).toMatchObject({ serial: "NFGE00000001", ontId: null, state: null });
    // Jarretière de l'ONT1 débranchée : aucun OLT ne l'atteint.
    const isolated = ok(disconnect(xgsPonScenario(), { linkId: "l6" }));
    expect(ont(isolated, "ont1")).toMatchObject({ state: "O1", block: "no-path", olt: null, downstream: null, upstream: null });
    expect(analyzePon(isolated).ports[0]?.authorizations[0]).toMatchObject({ ontId: null, state: null });
  });

  it("ne donne aucun port ni aucun ONT à un projet sans réseau optique", () => {
    expect(analyzePon(lanScenario())).toEqual({ onts: [], ports: [] });
  });
});
