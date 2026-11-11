import { describe, expect, it } from "vitest";
import { addAnnotation, editAnnotation, moveAnnotation, removeAnnotation, type CommandResult } from "./commands.js";
import { parseNfgText, serializeNfg } from "./io.js";
import { LIMITS } from "./schema.js";
import { emptyProject, expectOk } from "./test-helpers.js";

const codes = (result: CommandResult) => (result.ok ? [] : result.errors.map((issue) => issue.code));

describe("annotations libres", () => {
  it("ajoute, modifie, déplace et retire une annotation", () => {
    let doc = expectOk(addAnnotation(emptyProject(), { id: "n1", text: "  Salle serveur  ", position: { x: 10.4, y: 20.6 } }));
    expect(doc.layout.annotations).toEqual([{ id: "n1", text: "Salle serveur", x: 10, y: 21 }]);
    doc = expectOk(editAnnotation(doc, { id: "n1", text: "Baie 2" }));
    doc = expectOk(moveAnnotation(doc, { id: "n1", position: { x: 300, y: 40 } }));
    expect(doc.layout.annotations).toEqual([{ id: "n1", text: "Baie 2", x: 300, y: 40 }]);
    doc = expectOk(removeAnnotation(doc, { id: "n1" }));
    expect(doc.layout.annotations).toEqual([]);
  });

  it("refuse un texte vide ou trop long et une annotation inconnue", () => {
    expect(codes(addAnnotation(emptyProject(), { id: "n1", text: "   ", position: { x: 0, y: 0 } }))).toEqual(["annotation.invalid-text"]);
    expect(codes(addAnnotation(emptyProject(), { id: "n1", text: "x".repeat(LIMITS.maxAnnotationLength + 1), position: { x: 0, y: 0 } }))).toEqual([
      "annotation.invalid-text",
    ]);
    expect(codes(editAnnotation(emptyProject(), { id: "absente", text: "x" }))).toEqual(["annotation.not-found"]);
    expect(codes(removeAnnotation(emptyProject(), { id: "absente" }))).toEqual(["annotation.not-found"]);
  });

  it("refuse un identifiant en double", () => {
    const doc = expectOk(addAnnotation(emptyProject(), { id: "n1", text: "A", position: { x: 0, y: 0 } }));
    expect(codes(addAnnotation(doc, { id: "n1", text: "B", position: { x: 0, y: 0 } }))).toEqual(["annotation.duplicate-id"]);
  });

  it("est exportée et réimportée à l'identique, comme du texte", () => {
    const text = 'Attention <script>alert("x")</script> & « guillemets »';
    const doc = expectOk(addAnnotation(emptyProject(), { id: "n1", text, position: { x: 5, y: 5 } }));
    const again = parseNfgText(serializeNfg(doc));
    expect(again.ok && again.document.layout.annotations[0]?.text).toBe(text);
  });
});
