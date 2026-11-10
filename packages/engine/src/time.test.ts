import { describe, expect, it } from "vitest";
import {
  MAX_SIM_TIME,
  assertSimTime,
  fromMicroseconds,
  fromMilliseconds,
  fromSeconds,
  isSimTime,
  toMilliseconds,
  toSeconds,
} from "./time.js";

describe("temps simulé (nanosecondes entières)", () => {
  it("convertit les unités usuelles en nanosecondes", () => {
    expect(fromMicroseconds(5)).toBe(5_000);
    expect(fromMilliseconds(1)).toBe(1_000_000);
    expect(fromSeconds(300)).toBe(300_000_000_000);
  });

  it("arrondit à la nanoseconde la plus proche sans dérive flottante", () => {
    // 0,1 s * 1e9 vaut 100000000.00000001 en virgule flottante.
    expect(fromSeconds(0.1)).toBe(100_000_000);
    // Sérialisation de 64 octets à 1 Gb/s : 512 ns.
    expect(fromSeconds((64 * 8) / 1e9)).toBe(512);
  });

  it("reconvertit pour l'affichage", () => {
    expect(toMilliseconds(1_500_000)).toBe(1.5);
    expect(toSeconds(2_000_000_000)).toBe(2);
  });

  it("refuse les valeurs négatives, non finies ou hors de la plage sûre", () => {
    expect(() => fromSeconds(-1)).toThrow(RangeError);
    expect(() => fromSeconds(Number.NaN)).toThrow(RangeError);
    expect(() => fromSeconds(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    // 200 jours dépassent la limite documentée de l'horloge virtuelle (~104 jours).
    expect(() => fromSeconds(200 * 24 * 3600)).toThrow(/entre 0 et/);
  });

  it("valide la plage des instants", () => {
    expect(isSimTime(0)).toBe(true);
    expect(isSimTime(MAX_SIM_TIME)).toBe(true);
    expect(isSimTime(MAX_SIM_TIME + 1)).toBe(false);
    expect(isSimTime(1.5)).toBe(false);
    expect(() => assertSimTime(-5, "instant de départ")).toThrow(/instant de départ invalide/);
  });
});
