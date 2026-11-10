import { error, ISSUE_CODES, warning } from "@netforge/project";
import { describe, expect, it } from "vitest";
import { fr } from "./fr";
import { fill, formatIssue } from "./index";

describe("textes des problèmes métier", () => {
  it("fournit un texte français pour chaque code", () => {
    for (const code of ISSUE_CODES) {
      expect(fr.issues[code], code).toBeTruthy();
    }
  });

  it("remplit les paramètres et traduit la raison", () => {
    const text = formatIssue(
      error("ipv4.unassignable", { address: "192.168.1.0", deviceName: "PC1", portId: "eth0", reason: "network-address" }),
    );
    expect(text).toBe("192.168.1.0 ne peut pas être attribuée à PC1 eth0 : c'est l'adresse du réseau.");
  });

  it("convertit la taille limite en mégaoctets", () => {
    expect(formatIssue(error("import.too-large", { maxBytes: 5 * 1024 * 1024 }))).toBe("Fichier trop volumineux (limite : 5 Mo).");
  });

  it("laisse visible un paramètre manquant plutôt que d'inventer une valeur", () => {
    expect(fill("{a} et {b}", { a: 1 })).toBe("1 et {b}");
    expect(formatIssue(warning("gateway.without-address", { deviceName: "PC2" }))).toContain("PC2");
  });
});
