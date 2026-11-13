import { analyzeOptics, ftthScenario, xgsPonScenario } from "@netforge/engine";
import { describe, expect, it } from "vitest";
import { budgetCsv, budgetReportLines } from "./exportBudget";

/*
 * Valeurs de référence (bilan calculé à la main, optics.test.ts) : chemin ONT1,
 * pertes 13,6 à 24,974 dB, puissance reçue −23,474 dBm, marge 3,026 dB en
 * descendant ; chemin ONT3 : 24,944 dB, marge 3,056 dB, −1,444 dB avec le
 * connecteur sale (+4,5 dB).
 */
const rows = (csv: string) => csv.trimEnd().split("\r\n").map((line) => line.split(";"));

describe("export des bilans en CSV", () => {
  it("écrit une ligne par chemin et par sens, avec virgule décimale et les mêmes valeurs que le bilan", () => {
    const doc = ftthScenario();
    const [header, ...data] = rows(budgetCsv(doc, analyzeOptics(doc), false));
    expect(header?.slice(0, 4)).toEqual(["Chemin", "OLT", "Port OLT", "ONT"]);
    expect(header).toContain("Perte des pannes (dB)");
    expect(data).toHaveLength(6);
    const column = (name: string) => header?.indexOf(name) ?? -1;
    const ont1Down = data[0] ?? [];
    expect([ont1Down[0], ont1Down[column("Sens")], ont1Down[column("Longueur d'onde (nm)")], ont1Down[column("Classe")]]).toEqual(["OLT1 pon1 → ONT1", "descendant", "1490", "B+"]);
    expect([ont1Down[column("Pertes min (dB)")], ont1Down[column("Pertes max (dB)")], ont1Down[column("Puissance reçue pire cas (dBm)")], ont1Down[column("Marge (dB)")], ont1Down[column("État")]]).toEqual([
      "13,600",
      "24,974",
      "-23,474",
      "3,026",
      "Conforme",
    ]);
    expect(data[1]?.[column("Sens")]).toBe("montant");
  });

  it("en exercice, n'exporte que le bilan de conception, sans colonne de panne ; le formateur voit la panne", () => {
    const doc = ftthScenario({ dirtyPto3: true });
    const report = analyzeOptics(doc);
    const [exerciseHeader, ...exercise] = rows(budgetCsv(doc, report, true));
    expect(exerciseHeader).not.toContain("Perte des pannes (dB)");
    const margin = exerciseHeader?.indexOf("Marge (dB)") ?? -1;
    expect(exercise[4]?.[margin]).toBe("3,056");
    const [trainerHeader, ...trainer] = rows(budgetCsv(doc, report, false));
    expect([trainer[4]?.[trainerHeader?.indexOf("Perte des pannes (dB)") ?? -1], trainer[4]?.[trainerHeader?.indexOf("Marge (dB)") ?? -1], trainer[4]?.at(-1)]).toEqual(["4,500", "-1,444", "Signal trop faible"]);
  });

  it("laisse vides les puissances d'un chemin bloqué (technologies incompatibles)", () => {
    const doc = xgsPonScenario();
    const [header, ...data] = rows(budgetCsv(doc, analyzeOptics(doc), false));
    const mismatch = data.find((row) => row[0] === "OLT1 pon1 → ONT3");
    expect([mismatch?.[header?.indexOf("Marge (dB)") ?? -1], mismatch?.at(-1)]).toEqual(["", "Technologies PON incompatibles"]);
  });
});

describe("rapport PDF des bilans (texte)", () => {
  it("reprend chaque chemin, ses deux sens et ses contributions avec le cumul affiché", () => {
    const doc = ftthScenario();
    const lines = budgetReportLines(doc, analyzeOptics(doc), false, "13 novembre 2026");
    expect(lines[0]).toBe("Édité le 13 novembre 2026 avec NetForge · 3 chemin(s) · bilan avec les pannes injectées");
    expect(lines).toContain("Chemin OLT1 pon1 → ONT1 · GPON · état : ✓ Conforme");
    // Cumul au coupleur 1:8 : 0,5 + 0,002 + 0,5 + 0,3 + 2 + 0,3 + 10,6 = 14,202 dB (colonne de panne vide).
    expect(lines.find((line) => line.includes("Coupleur CPL1 1:8"))).toMatch(/10,600\s+14,202$/);
    expect(lines.find((line) => line.includes("Connexion ONT1 pon"))).toMatch(/24,974$/);
    expect(lines.filter((line) => line.startsWith("  Descendant"))).toHaveLength(3);
  });
});
