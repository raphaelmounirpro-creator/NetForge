import { addFault, type CommandResult, type NfgDocument } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { fiberDbPerKm } from "./optics.js";
import { runOtdr, type OtdrTrace } from "./otdr.js";
import { ftthScenario, xgsPonScenario } from "./scenarios.js";

/*
 * Réseau FTTH de référence, branche ONT1, lancement à OLT1 pon1 vers les abonnés.
 * Distances : jarretière 2 m, transport 5 000 m, 1 000 m, distribution 800 m,
 * raccordement 150 m, jarretière 2 m : 6 954 m jusqu'au connecteur de l'ONT1.
 * Pertes à 1 550 nm : 3 connexions (lancement, ODF1 f1, PTO1 out) 1,5 dB ;
 * 7 épissures 2,1 dB ; coupleurs 1:8 et 1:4 18 dB ; fibres 0,002 + 5 × 0,3 +
 * 0,3 + 0,8 × 0,3 + 0,15 + 0,002 = 2,194 dB (0,30 dB/km de 1 530 à 1 565 nm,
 * G.652) : 23,794 dB avant l'ONT. À 1 310 nm, fibres 2,874 dB : 24,474 dB.
 */
const DIGITS = 9;
const ok = (result: CommandResult): NfgDocument => {
  if (!result.ok) throw new Error(result.errors.map((issue) => issue.code).join(", "));
  return result.document;
};
const fromOlt = (doc: NfgDocument, wavelengthNm: 1310 | 1550 = 1550, ontId = "ont1"): OtdrTrace =>
  runOtdr(doc, { point: { deviceId: "olt1", portId: "pon1" }, direction: "downstream", ontId, wavelengthNm });
const fromOnt = (doc: NfgDocument): OtdrTrace => runOtdr(doc, { point: { deviceId: "ont1", portId: "pon" }, direction: "upstream", wavelengthNm: 1550 });
const at = (trace: OtdrTrace, kind: string) => trace.events.filter((event) => event.kind === kind).map((event) => event.distanceM);

describe("OTDR : événements positionnés et pertes", () => {
  it("place chaque événement à sa distance et retrouve la perte cumulée calculée à la main, aux deux longueurs d'onde", () => {
    const trace = fromOlt(ftthScenario());
    expect([trace.outcome, trace.lengthM, trace.towards]).toEqual(["complete", 6954, { deviceId: "ont1", portId: "pon" }]);
    expect(at(trace, "connection")).toEqual([0, 2, 6952]);
    expect(at(trace, "splice")).toEqual([2, 5002, 5002, 6002, 6002, 6802, 6952]);
    expect(at(trace, "coupler")).toEqual([5002, 6002]);
    expect(at(trace, "end")).toEqual([6954]);
    expect(trace.events.at(-1)?.cumulativeDb).toBeCloseTo(23.794, DIGITS);
    expect(trace.points.at(-1)?.distanceM).toBe(6954);
    expect(trace.points.at(-1)?.levelDb).toBeCloseTo(-23.794, DIGITS);
    expect(trace.events.some((event) => event.anomaly)).toBe(false);
    expect(trace.throughSplitter).toBe(true);
    expect(fromOlt(ftthScenario(), 1310).events.at(-1)?.cumulativeDb).toBeCloseTo(24.474, DIGITS);
    expect([fiberDbPerKm("distribution", 1550), fiberDbPerKm("short", 1550), fiberDbPerKm("distribution", 1310)]).toEqual([0.3, 1, 0.4]);
  });

  it("suit la branche demandée après un coupleur, et remonte vers l'OLT depuis un abonné sans passer de coupleur en descente", () => {
    expect(fromOlt(ftthScenario(), 1550, "ont3").lengthM).toBe(6954 - 150 + 120);
    const up = fromOnt(ftthScenario());
    expect([up.outcome, up.lengthM, up.towards, up.throughSplitter]).toEqual(["complete", 6954, { deviceId: "olt1", portId: "pon1" }, false]);
    expect(at(up, "connection")).toEqual([0, 2, 6952]);
    expect(up.events.at(-1)?.cumulativeDb).toBeCloseTo(23.794, DIGITS);
  });

  it("signale une perte anormale à l'endroit du connecteur sale, sans nommer la panne", () => {
    const trace = fromOlt(ftthScenario({ dirtyPto3: true }), 1550, "ont3");
    const dirty = trace.events.find((event) => event.anomaly);
    expect(dirty).toMatchObject({ kind: "connection", distanceM: 6952 - 150 + 120, expectedMaxDb: 0.5, reflective: true });
    expect(dirty?.lossDb).toBeCloseTo(5, DIGITS);
  });

  it("localise une coupure à sa position, depuis l'OLT comme depuis l'abonné ; sans position, à la section près", () => {
    // Coupure à 2 345 m de la première extrémité de l2 (ODF1 r1) : 2 + 2 345 depuis l'OLT, 1 952 + 2 655 depuis l'ONT1.
    const cut = ok(addFault(ftthScenario(), { id: "f1", kind: "cut", target: { kind: "link", linkId: "l2" }, extraLoss: null, positionM: 2345 }));
    expect([fromOlt(cut).outcome, fromOlt(cut).lengthM, at(fromOlt(cut), "break")]).toEqual(["break", 2347, [2347]]);
    expect([fromOnt(cut).lengthM, at(fromOnt(cut), "break")]).toEqual([4607, [4607]]);
    expect(fromOlt(cut).events.at(-1)?.cumulativeDb).toBeCloseTo(0.5 + 0.002 + 0.5 + 0.3 + 2.345 * 0.3, DIGITS);
    const unknown = ok(addFault(ftthScenario(), { id: "f1", kind: "cut", target: { kind: "link", linkId: "l2" }, extraLoss: null }));
    const trace = fromOlt(unknown);
    expect([trace.outcome, trace.lengthM, trace.uncertain]).toEqual(["break", 2, { startM: 2, endM: 5002 }]);
    expect(trace.events.at(-1)).toMatchObject({ kind: "break", distanceM: null, section: { startM: 2, endM: 5002 } });
  });

  it("place une courbure à sa position avec sa perte ; sans position, la reporte en fin de section marquée incertaine", () => {
    const bent = ok(addFault(ftthScenario(), { id: "f1", kind: "bend", target: { kind: "link", linkId: "l3" }, extraLoss: 2.5, positionM: 400 }));
    const event = fromOlt(bent).events.find((item) => item.kind === "fiber-loss");
    expect(event).toMatchObject({ distanceM: 5402, lossDb: 2.5, anomaly: true });
    expect(fromOlt(bent).events.at(-1)?.cumulativeDb).toBeCloseTo(23.794 + 2.5, DIGITS);
    const unknown = ok(addFault(ftthScenario(), { id: "f1", kind: "bend", target: { kind: "link", linkId: "l3" }, extraLoss: 2.5 }));
    expect(fromOlt(unknown).uncertain).toEqual({ startM: 5002, endM: 6002 });
    expect(fromOlt(unknown).events.find((item) => item.kind === "fiber-loss")).toMatchObject({ distanceM: null, lossDb: 2.5 });
  });

  it("s'arrête sur une lecture non représentative (polissages différents) et refuse un point hors des chemins", () => {
    const mismatch = ok(addFault(ftthScenario(), { id: "f1", kind: "polish-mismatch", target: { kind: "port", deviceId: "odf1", portId: "f1" }, extraLoss: null }));
    const trace = fromOlt(mismatch);
    expect([trace.outcome, trace.lengthM, trace.events.at(-1)?.kind]).toEqual(["unmeasurable", 2, "unmeasurable"]);
    expect(runOtdr(ftthScenario(), { point: { deviceId: "odf1", portId: "f5" }, direction: "downstream", wavelengthNm: 1310 }).outcome).toBe("no-path");
    expect(runOtdr(ftthScenario(), { point: { deviceId: "absent", portId: "pon" }, direction: "downstream", wavelengthNm: 1310 }).outcome).toBe("not-a-connector");
    // XGS-PON : même instrument, même calcul (la technologie ne change pas la trace).
    expect(runOtdr(xgsPonScenario(), { point: { deviceId: "olt1", portId: "pon1" }, direction: "downstream", ontId: "ont1", wavelengthNm: 1310 }).lengthM).toBe(2304);
  });
});
