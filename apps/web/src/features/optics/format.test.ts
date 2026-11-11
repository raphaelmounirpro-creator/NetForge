import { ftthScenario, measurePower } from "@netforge/engine";
import { describe, expect, it } from "vitest";
import { formatDb, formatFineDb, formatLength, measurementText } from "./format";

/** Les espaces insécables du français sont normalisés pour la comparaison. */
const plain = (text: string) => text.replace(/[\u00a0\u202f]/g, " ");

describe("affichage des grandeurs optiques", () => {
  it("affiche les dB à deux décimales et les contributions à trois, sans « −0 »", () => {
    expect(formatDb(3.116)).toBe("3,12");
    expect(plain(formatDb(-23.384))).toMatch(/^[-−]23,38$/);
    expect(formatDb(-0.001)).toBe("0,00");
    expect(formatFineDb(0.002)).toBe("0,002");
  });

  it("écrit les longueurs en mètres ou en kilomètres", () => {
    expect(formatLength(2)).toBe("2 m");
    expect(formatLength(150)).toBe("150 m");
    expect(formatLength(5000)).toBe("5 km");
    expect(plain(formatLength(1250))).toBe("1,25 km");
    expect(formatLength(0.5)).toBe("0,5 m");
  });

  it("rédige une mesure du photomètre avec le point, la puissance et l'écart", () => {
    const doc = ftthScenario({ dirtyPto3: true });
    const text = plain(measurementText(doc, measurePower(doc, { direction: "downstream", point: { deviceId: "pto3", portId: "out" } })));
    expect(text).toMatch(/^PTO3 out \(1 490 nm\) : [-−]27,44 dBm mesurés, [-−]22,94 dBm attendus, écart 4,50 dB\.$/);
  });
});
