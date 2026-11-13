import { describe, expect, it } from "vitest";
import { PDF_LINE_CHARS, textPdf, winAnsi, wrapLines } from "./pdf";

const ascii = (bytes: Uint8Array) => Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");

describe("générateur PDF texte", () => {
  it("encode en WinAnsi, remplace les symboles hors de la table et reste en ASCII dans le fichier", () => {
    expect(winAnsi("Été")).toEqual([0xc9, 0x74, 0xe9]);
    expect(winAnsi("œ – €")).toEqual([0x9c, 0x20, 0x96, 0x20, 0x80]);
    expect(String.fromCharCode(...winAnsi("A → B ✓ ✕ ⊘ 1 000"))).toBe("A -> B OK X (x) 1 000");
    expect(winAnsi("漢")).toEqual([0x3f]);
    const file = ascii(textPdf("Bilans (été)", ["Pertes : 24,974 dB", "Chemin OLT1 pon1 → ONT1"]));
    expect(Array.from(file).every((character) => character.charCodeAt(0) < 0x80)).toBe(true);
    expect(file).toContain("(Bilans \\(\\351t\\351\\)) Tj");
    expect(file).toContain("(Chemin OLT1 pon1 -> ONT1) Tj");
  });

  it("produit une table de références croisées dont chaque décalage pointe sur son objet", () => {
    const file = ascii(textPdf("Titre", Array.from({ length: 150 }, (_, index) => `Ligne ${String(index + 1)}`)));
    expect(file.startsWith("%PDF-1.4\n")).toBe(true);
    expect(file.endsWith("%%EOF\n")).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(file)?.[1]);
    expect(file.slice(startxref, startxref + 4)).toBe("xref");
    const entries = file.slice(startxref).split("\n").slice(3).filter((line) => / 00000 n $/.test(line));
    expect(entries.length).toBeGreaterThan(6);
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(file.slice(offset, offset + `${String(index + 1)} 0 obj`.length)).toBe(`${String(index + 1)} 0 obj`);
    });
    // 150 lignes de 9 points : trois pages A4.
    expect(/\/Count (\d+)/.exec(file)?.[1]).toBe("3");
    // Longueur déclarée de chaque flux = longueur réelle.
    for (const match of file.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) expect(match[2]?.length).toBe(Number(match[1]));
  });

  it("coupe les lignes trop longues aux espaces en gardant leur retrait", () => {
    const long = `  ${"mot ".repeat(40)}`.trimEnd();
    const wrapped = wrapLines([long]);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.every((line) => line.length <= PDF_LINE_CHARS && line.startsWith("  "))).toBe(true);
    expect(wrapLines(["x".repeat(PDF_LINE_CHARS + 5)]).map((line) => line.length)).toEqual([PDF_LINE_CHARS, 5]);
  });
});
